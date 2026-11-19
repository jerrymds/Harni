import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { ContextManager } from './context/contextManager.js';
import { SystemPromptBuilder } from './prompts/systemPrompt.js';
import { BaseLLMProvider } from './providers/baseProvider.js';
import { AntigravityProvider } from './providers/antigravityProvider.js';
import { ProviderFactory } from './providers/providerFactory.js';
import { ToolRegistry } from './tools/toolRegistry.js';
import { SkillRegistry } from './skills/skillRegistry.js';
import { McpServerManager } from './mcp/mcpServerManager.js';
import { SubagentManager } from './subagents/subagentManager.js';
import { SchedulerService } from './scheduler/schedulerService.js';
import { SwarmBoardService } from './swarm/swarmBoardService.js';
import { AutoTestRunner } from './testing/autoTestRunner.js';
import { GitCheckpointService } from './git/gitCheckpointService.js';
import { ExperienceManager } from './harness/experienceManager.js';
import { ContrastiveProbeRunner } from './harness/contrastiveProbeRunner.js';
import { normalizeAgentMode } from '@harni/types';
import type { ToolExecutionContext } from './tools/baseTool.js';
import type {
  AgentMode,
  AgentStatus,
  AntigravityExecutionMode,
  AutoTestConfig,
  ChatMessage,
  FileAttachment,
  CheckpointInfo,
  ContrastiveProbeParams,
  ContrastiveProbeResult,
  FileDiff,
  GitBranchesResponse,
  GitBranchSwitchResult,
  HarnessExperience,
  LLMProviderType,
  ServerToClientEvents,
  SubagentModelTier,
  TaskState,
  TokenUsage,
  ToolCallRequest,
  ToolResult,
  WorktreeStatusInfo,
  WorkflowPlugin,
  WorkflowPluginContext,
  ToolCallMiddlewareContext,
} from '@harni/types';
import {
  WorkflowPluginManager,
  createDefaultWorkflowPlugins,
  ExperienceLearningPlugin,
  AutoTestRepairPlugin,
} from './plugins/index.js';
import type { McpServerConfig } from './mcp/mcpTypes.js';
import type { McpManagerConnectResult } from './mcp/mcpServerManager.js';

export interface AgentEngineConfig {
  workspaceRoot: string;
  defaultProvider?: LLMProviderType;
  defaultModel?: string;
  apiKey?: string;
  baseURL?: string;
  customInstructions?: string;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  mcpEnabled?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
  subagentsEnabled?: boolean;
  maxSubagentDepth?: number;
  maxSubagentConcurrent?: number;
  modelTierMap?: Partial<Record<SubagentModelTier, string>>;
  autoTestEnabled?: boolean;
  testCommand?: string;
  maxTestRetries?: number;
  gitCheckpointEnabled?: boolean;
  worktreeIsolationEnabled?: boolean;
  worktreeTimeoutMs?: number;
  experienceLearningEnabled?: boolean;
  experienceStorageDir?: string;
  dynamicHarnessEnabled?: boolean;
  antigravityMode?: AntigravityExecutionMode;
  pluginManager?: WorkflowPluginManager;
}

interface WakeupEvent {
  id: string;
  source: 'subagent' | 'schedule' | 'message';
  sourceId?: string;
  summary: string;
  payloadText: string;
  timestamp: number;
}

interface SessionTask {
  sessionId: string;
  taskState: TaskState;
  contextManager: ContextManager;
  abortController: AbortController | null;
  pendingApproval: {
    toolCallId: string;
    resolve: (approved: boolean, feedback?: string) => void;
  } | null;
  pendingQuestion?: {
    toolCallId: string;
    resolve: (answer: { answers: string[]; customInput?: string }) => void;
  } | null;
  workspaceRoot: string;
  mainWorkspaceRoot?: string;
  codeModified: boolean;
  hasModifiedCodeInTask: boolean;
  autoTestRetries: number;
  autoTestConfig: AutoTestConfig;
  checkpointId?: string;
  isWorktree?: boolean;
  worktreeBranch?: string;
  subagentsEnabled: boolean;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  openaiAccountId?: string;
  subagentTokenUsage: TokenUsage;
  cachedExperiences?: HarnessExperience[];
  successfulActions: string[];
  encounteredErrors: string[];
  modifiedFiles: Set<string>;
  testFailureDiffs: string[];
  experienceSaved?: boolean;
  pendingExperiencePromise?: Promise<void>;
  pluginStates: Map<string, unknown>;
  wakeupQueue: WakeupEvent[];
  isLoopRunning: boolean;
  lastProvider?: BaseLLMProvider;
}

export class AgentCoreEngine extends EventEmitter {
  private workspaceRoot: string;
  private defaultProvider: LLMProviderType;
  private defaultModel?: string;
  private apiKey?: string;
  private baseURL?: string;
  private customInstructions?: string;
  private executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;

  private toolRegistry: ToolRegistry;
  private skillRegistry: SkillRegistry;
  private mcpManager: McpServerManager;
  private subagentManager: SubagentManager;
  private schedulerService: SchedulerService;
  private swarmBoardService: SwarmBoardService;
  private gitCheckpointService: GitCheckpointService;
  private mcpEnabled: boolean = false;
  private mcpServers?: Record<string, McpServerConfig>;
  private pluginManager: WorkflowPluginManager;

  public autoApprove: boolean = false;

  private _autoTestEnabled: boolean = true;
  public get autoTestEnabled(): boolean {
    return (
      this._autoTestEnabled &&
      (this.pluginManager?.isPluginEnabled('harni.auto-test-repair') ?? true)
    );
  }
  public set autoTestEnabled(enabled: boolean) {
    this._autoTestEnabled = enabled;
    this.pluginManager?.setPluginEnabled('harni.auto-test-repair', enabled);
  }

  private _gitCheckpointEnabled: boolean = true;
  public get gitCheckpointEnabled(): boolean {
    return this._gitCheckpointEnabled;
  }
  public set gitCheckpointEnabled(enabled: boolean) {
    this._gitCheckpointEnabled = enabled;
    if (!enabled && !this._worktreeIsolationEnabled) {
      this.pluginManager?.setPluginEnabled('harni.git-workspace', false);
    } else if (enabled) {
      this.pluginManager?.setPluginEnabled('harni.git-workspace', true);
    }
  }

  private _worktreeIsolationEnabled: boolean = false;
  public get worktreeIsolationEnabled(): boolean {
    return this._worktreeIsolationEnabled;
  }
  public set worktreeIsolationEnabled(enabled: boolean) {
    this._worktreeIsolationEnabled = enabled;
    if (!enabled && !this._gitCheckpointEnabled) {
      this.pluginManager?.setPluginEnabled('harni.git-workspace', false);
    } else if (enabled) {
      this.pluginManager?.setPluginEnabled('harni.git-workspace', true);
    }
  }

  public worktreeTimeoutMs: number = 180000;
  public subagentsEnabled: boolean = true;
  private _dynamicHarnessEnabled: boolean = true;
  public get dynamicHarnessEnabled(): boolean {
    return this._dynamicHarnessEnabled;
  }
  public set dynamicHarnessEnabled(enabled: boolean) {
    this._dynamicHarnessEnabled = enabled;
    this.subagentManager?.setDynamicHarnessEnabled(enabled);
  }

  private _experienceLearningEnabled: boolean = false;
  public get experienceLearningEnabled(): boolean {
    return this._experienceLearningEnabled;
  }
  public set experienceLearningEnabled(enabled: boolean) {
    this._experienceLearningEnabled = enabled;
    this.pluginManager?.setPluginEnabled('harni.experience-learning', enabled);
    if (enabled && !this.experienceManager) {
      this.experienceManager = this.getExperienceManagerForRoot(this.workspaceRoot);
    }
  }
  private experienceStorageDir?: string;
  public experienceManager?: ExperienceManager;
  private experienceManagersByRoot = new Map<string, ExperienceManager>();
  private defaultTestCommand?: string;
  private maxTestRetries: number = 5;

  private tasksBySession = new Map<string, SessionTask>();
  private subagentApprovalQueues = new Map<string, Promise<void>>();
  private subagentQuestionQueues = new Map<string, Promise<void>>();
  private lastActiveSessionId: string = 'default';

  public getPluginManager(): WorkflowPluginManager {
    return this.pluginManager;
  }

  public registerPlugin(plugin: WorkflowPlugin): void {
    this.pluginManager.register(plugin);
  }

  public unregisterPlugin(pluginId: string): boolean {
    return this.pluginManager.unregister(pluginId);
  }

  public setPluginEnabled(pluginId: string, enabled: boolean): void {
    this.pluginManager.setPluginEnabled(pluginId, enabled);
    if (pluginId === 'harni.experience-learning') {
      this._experienceLearningEnabled = enabled;
      if (enabled && !this.experienceManager) {
        this.experienceManager = this.getExperienceManagerForRoot(this.workspaceRoot);
      }
    } else if (pluginId === 'harni.auto-test-repair') {
      this._autoTestEnabled = enabled;
    }
  }

  constructor(config: AgentEngineConfig) {
    super();
    this.workspaceRoot = config.workspaceRoot;
    this.defaultProvider = config.defaultProvider ?? 'anthropic';
    this.defaultModel = config.defaultModel;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.customInstructions = config.customInstructions;
    this.executeTerminalCommand = config.executeTerminalCommand;
    this.mcpEnabled = config.mcpEnabled ?? false;
    this.mcpServers = config.mcpServers;
    this._autoTestEnabled = config.autoTestEnabled ?? true;
    this.defaultTestCommand = config.testCommand;
    this.maxTestRetries = config.maxTestRetries ?? 5;
    this._gitCheckpointEnabled = config.gitCheckpointEnabled ?? true;
    this._worktreeIsolationEnabled = config.worktreeIsolationEnabled ?? false;
    this.worktreeTimeoutMs = config.worktreeTimeoutMs ?? 180000;
    this.subagentsEnabled = config.subagentsEnabled ?? true;
    this.dynamicHarnessEnabled = config.dynamicHarnessEnabled ?? true;
    this._experienceLearningEnabled = config.experienceLearningEnabled ?? false;
    this.experienceStorageDir = config.experienceStorageDir;

    this.gitCheckpointService = new GitCheckpointService();
    this.skillRegistry = new SkillRegistry(true);
    this.toolRegistry = new ToolRegistry(true, this.skillRegistry);
    this.mcpManager = new McpServerManager({ workspaceRoot: config.workspaceRoot });
    this.schedulerService = new SchedulerService();
    this.swarmBoardService = new SwarmBoardService();

    this.pluginManager = config.pluginManager ?? new WorkflowPluginManager();

    this.subagentManager = new SubagentManager({
      workspaceRoot: config.workspaceRoot,
      defaultProvider: this.defaultProvider,
      defaultModel: this.defaultModel,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      maxDepth: config.maxSubagentDepth ?? 2,
      maxConcurrent: config.maxSubagentConcurrent,
      modelTierMap: config.modelTierMap,
      dynamicHarnessEnabled: this.dynamicHarnessEnabled,
      antigravityMode: config.antigravityMode,
      executeTerminalCommand: this.executeTerminalCommand,
      mcpManager: this.mcpManager,
      skillRegistry: this.skillRegistry,
      gitCheckpointService: this.gitCheckpointService,
      pluginManager: this.pluginManager,
      requestToolApproval: (sessionId, request, signal) =>
        this.handleSubagentToolApproval(sessionId, request, signal),
      askUserQuestion: (sessionId, params, signal) =>
        this.handleSubagentAskQuestion(sessionId, params, signal),
      getExperiencesForPrompt: async (query, wsRoot, sessionId) => {
        if (!this.experienceLearningEnabled) return [];
        const sessionTask = sessionId ? this.tasksBySession.get(sessionId) : undefined;
        const targetRoot =
          sessionTask?.mainWorkspaceRoot ??
          wsRoot ??
          this.workspaceRoot;
        const mgr =
          this.getExperienceManagerForRoot(targetRoot) ??
          this.experienceManager;
        if (!mgr) return [];
        return await mgr.searchExperiences({ query, limit: 3 });
      },
    });

    if (!config.pluginManager) {
      const defaultPlugins = createDefaultWorkflowPlugins({
        gitCheckpointService: this.gitCheckpointService,
        skillRegistry: this.skillRegistry,
        subagentManager: this.subagentManager,
        workspaceRoot: this.workspaceRoot,
        storageDir: this.experienceStorageDir,
        getDefaultWorktreeEnabled: () => this.worktreeIsolationEnabled,
        getDefaultCheckpointEnabled: () => this.gitCheckpointEnabled,
        getWorktreeTimeoutMs: () => this.worktreeTimeoutMs,
        getExperienceLearningEnabled: () => this.experienceLearningEnabled,
        getDefaultAutoTestEnabled: () => this.autoTestEnabled,
        getDefaultTestCommand: () => this.defaultTestCommand,
        getDefaultMaxTestRetries: () => this.maxTestRetries,
        executeTerminalCommand: this.executeTerminalCommand,
        getBaseCustomInstructions: () => this.customInstructions,
        experienceManagersByRoot: this.experienceManagersByRoot,
      });
      for (const p of defaultPlugins) {
        this.pluginManager.register(p);
      }
      this.pluginManager.setPluginEnabled(
        'harni.experience-learning',
        this.experienceLearningEnabled,
      );
    }

    if (this.experienceLearningEnabled) {
      this.experienceManager = this.getExperienceManagerForRoot(this.workspaceRoot);
    }

    this.bindSubagentEvents();
    this.bindSchedulerEvents();
    this.bindSwarmEvents();

    if (this.gitCheckpointEnabled) {
      this.gitCheckpointService.pruneStaleBranches(this.workspaceRoot).catch((err) => {
        console.warn('[Engine] Initial stale branch prune non-fatal error:', err);
      });
    }
  }

  // Type-safe event emission
  public emitEvent<K extends keyof ServerToClientEvents & string>(
    event: K,
    payload: ServerToClientEvents[K],
  ): boolean {
    return this.emit(event, payload);
  }

  public getStatus(sessionId?: string): AgentStatus {
    if (sessionId) {
      return this.tasksBySession.get(sessionId)?.taskState.status ?? 'idle';
    }
    const lastSession = this.tasksBySession.get(this.lastActiveSessionId);
    if (lastSession) return lastSession.taskState.status;
    for (const task of this.tasksBySession.values()) {
      if (task.taskState.status !== 'idle' && task.taskState.status !== 'completed') {
        return task.taskState.status;
      }
    }
    return 'idle';
  }

  private getExperienceManagerForRoot(rootPath: string): ExperienceManager | undefined {
    if (!this.experienceLearningEnabled) return undefined;
    const expPlugin = this.pluginManager?.getPlugin<ExperienceLearningPlugin>('harni.experience-learning');
    if (expPlugin) {
      return expPlugin.getExperienceManagerForRoot(rootPath);
    }
    const resolvedRoot = path.resolve(rootPath);
    let mgr = this.experienceManagersByRoot.get(resolvedRoot);
    if (mgr) {
      // Re-insert to refresh recency in Map iteration order
      this.experienceManagersByRoot.delete(resolvedRoot);
      this.experienceManagersByRoot.set(resolvedRoot, mgr);
      return mgr;
    }

    const MAX_EXPERIENCE_MANAGERS = 20;
    while (this.experienceManagersByRoot.size >= MAX_EXPERIENCE_MANAGERS) {
      let evicted = false;
      for (const [key, val] of this.experienceManagersByRoot.entries()) {
        if (val !== this.experienceManager) {
          this.experienceManagersByRoot.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        break;
      }
    }

    const hash = crypto
      .createHash('sha1')
      .update(resolvedRoot)
      .digest('hex')
      .slice(0, 12);
    const storage = path.join(
      this.experienceStorageDir || path.join(os.homedir(), '.harni', 'experiences'),
      hash,
    );
    mgr = new ExperienceManager({ storageDir: storage, maxRetained: 200 });
    this.experienceManagersByRoot.set(resolvedRoot, mgr);
    return mgr;
  }

  private createPluginContext(
    sessionTask: SessionTask,
    signal?: AbortSignal,
    provider?: BaseLLMProvider,
  ): WorkflowPluginContext {
    return {
      sessionId: sessionTask.sessionId,
      taskId: sessionTask.taskState.id,
      isSubagent: false,
      taskState: sessionTask.taskState,
      signal: signal ?? sessionTask.abortController?.signal,
      getWorkspaceRoot: () => sessionTask.workspaceRoot,
      setWorkspaceRoot: (
        newRoot: string,
        meta?: { isWorktree?: boolean; branch?: string },
      ) => {
        sessionTask.workspaceRoot = path.resolve(newRoot);
        if (meta?.isWorktree !== undefined) {
          sessionTask.isWorktree = meta.isWorktree;
        }
        if (meta?.branch !== undefined) {
          sessionTask.worktreeBranch = meta.branch;
        }
        if (sessionTask.isWorktree) {
          sessionTask.taskState.isWorktree = true;
          sessionTask.taskState.worktreePath = sessionTask.workspaceRoot;
          sessionTask.taskState.worktreeBranch = sessionTask.worktreeBranch;
        }
        this.syncTaskState(sessionTask);
      },
      getMainWorkspaceRoot: () => sessionTask.mainWorkspaceRoot || this.workspaceRoot,
      getPluginState: <T>(pluginId: string, initializer?: () => T): T => {
        let s = sessionTask.pluginStates.get(pluginId) as T;
        if (s === undefined && initializer) {
          s = initializer();
          sessionTask.pluginStates.set(pluginId, s);
        }
        return s;
      },
      setPluginState: <T>(pluginId: string, state: T): void => {
        sessionTask.pluginStates.set(pluginId, state);
      },
      addMessage: (message: ChatMessage) => {
        sessionTask.contextManager.addMessage(message);
        this.syncTaskState(sessionTask);
      },
      getMessages: () => sessionTask.contextManager.getMessages(),
      setStatus: (status: AgentStatus) => {
        this.setStatus(sessionTask, status);
      },
      syncTaskState: () => {
        this.syncTaskState(sessionTask);
      },
      emitEvent: <K extends keyof ServerToClientEvents & string>(
        event: K,
        payload: ServerToClientEvents[K],
      ) => {
        this.emitEvent(event, payload);
      },
      invokeLLM: async (prompt: string, systemPrompt?: string): Promise<string> => {
        if (!provider) {
          throw new Error('LLM Provider not initialized in plugin context');
        }
        const comp = await provider.streamCompletion(
          [
            {
              id: `msg_invoke_${Date.now()}`,
              role: 'user',
              content: prompt,
              timestamp: Date.now(),
            },
          ],
          systemPrompt ||
            'You are an expert evaluator assessing and comparing code solution candidates.',
          [],
          () => {},
          sessionTask.abortController?.signal,
        );
        return comp.text;
      },
      requestToolApproval: async (toolCall: import('@harni/types').ToolCall) => {
        if (this.autoApprove) {
          return { approved: true };
        }
        this.setStatus(sessionTask, 'waiting_approval');
        return new Promise<{ approved: boolean; feedback?: string }>((resolve) => {
          sessionTask.pendingApproval = {
            toolCallId: toolCall.id,
            resolve: (approved, feedback) => resolve({ approved, feedback }),
          };
        });
      },
      notifyCodeModified: (filePath?: string) => {
        sessionTask.codeModified = true;
        sessionTask.hasModifiedCodeInTask = true;
        if (filePath) {
          sessionTask.modifiedFiles.add(filePath);
          const expPlugin =
            this.pluginManager.getPlugin<ExperienceLearningPlugin>('harni.experience-learning');
          if (expPlugin) {
            expPlugin.recordModifiedFile(
              this.createPluginContext(sessionTask, signal, provider),
              filePath,
            );
          }
        }
        const autoTestPlugin =
          this.pluginManager.getPlugin<AutoTestRepairPlugin>('harni.auto-test-repair');
        if (autoTestPlugin) {
          autoTestPlugin.markCodeModified(
            this.createPluginContext(sessionTask, signal, provider),
            filePath,
          );
        }
      },
      notifyDiagnostics: (diag) => {
        this.emitEvent('file:diagnostics', {
          ...diag,
          sessionId: sessionTask.sessionId,
          taskId: sessionTask.taskState.id,
        });
      },
      notifyTerminalData: (data: string) => {
        this.emitEvent('terminal:data', { data, sessionId: sessionTask.sessionId });
      },
      isSubagentsEnabled: () => sessionTask.subagentsEnabled !== false,
      isMcpToolAllowedReadOnly: (toolName: string) =>
        this.mcpManager.getTool(toolName)
          ? this.mcpManager.isToolAllowedForReadOnly(toolName)
          : true,
      isReadOnlySubagentType: (typeName: string) => {
        const def = this.subagentManager.getRegistry().get(typeName);
        if (!def || def.enableWriteTools !== false) {
          return false;
        }
        const allowed = def.allowedTools?.map((t) => this.toolRegistry.resolveToolName(t)) ?? [];
        return (
          !allowed.includes('run_command') &&
          !allowed.includes('write_file') &&
          !allowed.includes('edit_file')
        );
      },
      getAutoTestConfig: () => sessionTask.autoTestConfig,
    };
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public setWorkspaceRoot(newRoot: string): void {
    this.workspaceRoot = path.resolve(newRoot);
    this.mcpManager.setWorkspaceRoot(this.workspaceRoot);
    this.subagentManager.setWorkspaceRoot(this.workspaceRoot);
    if (this.experienceLearningEnabled) {
      this.experienceManager = this.getExperienceManagerForRoot(this.workspaceRoot);
    }
  }

  public getSubagentManager(): SubagentManager {
    return this.subagentManager;
  }

  public setSubagentModelTierMap(map: Partial<Record<SubagentModelTier, string>>): void {
    this.subagentManager.setModelTierMap(map);
  }

  public getSubagentModelTierMap(): Partial<Record<SubagentModelTier, string>> {
    return this.subagentManager.getModelTierMap();
  }

  public getGitCheckpointService(): GitCheckpointService {
    return this.gitCheckpointService;
  }

  public getSchedulerService(): SchedulerService {
    return this.schedulerService;
  }

  public getSwarmBoardService(): SwarmBoardService {
    return this.swarmBoardService;
  }

  public getActiveWorktreePaths(): string[] {
    const paths = new Set<string>();
    for (const task of this.tasksBySession.values()) {
      if (task.isWorktree && task.workspaceRoot) {
        paths.add(path.resolve(task.workspaceRoot));
      }
    }
    for (const inst of this.subagentManager.getAllInstances()) {
      if (inst.worktreePath) {
        paths.add(path.resolve(inst.worktreePath));
      }
    }
    return Array.from(paths);
  }

  private bindSwarmEvents(): void {
    this.swarmBoardService.on('swarm:updated', (board) => {
      this.emitEvent('swarm:updated', board);
    });
    this.swarmBoardService.on('swarm:message', (msg: import('@harni/types').SwarmMessage) => {
      this.emitEvent('swarm:message', msg);

      const hasAll = msg.mentions.some((m) => m.toLowerCase() === 'all');
      const notifiedSubagents = new Set<string>();
      let notifyCoordinator = false;

      if (hasAll) {
        if (msg.sender !== 'coordinator') {
          notifyCoordinator = true;
        }
        for (const member of this.swarmBoardService.listMembers(msg.sessionId)) {
          if (
            member.subagentId !== msg.senderSubagentId &&
            member.status !== 'cancelled'
          ) {
            notifiedSubagents.add(member.subagentId);
          }
        }
      } else {
        for (const tag of msg.mentions) {
          if (tag.toLowerCase() === 'coordinator') {
            if (msg.sender !== 'coordinator') {
              notifyCoordinator = true;
            }
            continue;
          }
          const member = this.swarmBoardService.resolveMember(msg.sessionId, tag);
          if (
            member &&
            member.subagentId !== msg.senderSubagentId &&
            member.status !== 'cancelled'
          ) {
            notifiedSubagents.add(member.subagentId);
          }
        }
      }

      for (const subId of notifiedSubagents) {
        this.subagentManager.deliverSwarmMessage(
          subId,
          `[SWARM_BOARD @mention from ${msg.sender}]\n${msg.content}`,
        );
      }

      if (notifyCoordinator) {
        this.enqueueWakeupEvent(msg.sessionId, {
          id: `wakeup_swarm_${msg.id}`,
          source: 'message',
          sourceId: msg.sender,
          summary: `Swarm @coordinator mention from ${msg.sender}`,
          payloadText: msg.content,
          timestamp: msg.timestamp,
        });
      }
    });
  }

  private bindSchedulerEvents(): void {
    this.schedulerService.on('schedule:created', (payload) => {
      this.emitEvent('schedule:created', payload);
    });
    this.schedulerService.on('schedule:cancelled', (payload) => {
      this.emitEvent('schedule:cancelled', payload);
    });
    this.schedulerService.on('schedule:triggered', (payload) => {
      this.emitEvent('schedule:triggered', payload);
      this.enqueueWakeupEvent(payload.sessionId, {
        id: `wakeup_sched_${payload.scheduleId}_${payload.iteration}_${Date.now()}`,
        source: 'schedule',
        sourceId: payload.scheduleId,
        summary: `Scheduled trigger (${payload.scheduleId}, iteration #${payload.iteration})`,
        payloadText: payload.prompt,
        timestamp: Date.now(),
      });
    });
  }

  private bindSubagentEvents(): void {
    this.subagentManager.on('subagent:spawned', (payload) => {
      this.emitEvent('subagent:spawned', payload);
      if (payload.sessionId) {
        const sessionTask = this.tasksBySession.get(payload.sessionId);
        if (sessionTask) {
          sessionTask.taskState.subagents = this.subagentManager.getInstancesBySession(payload.sessionId);
        }
      }
    });
    this.subagentManager.on('subagent:status', (payload) => {
      this.emitEvent('subagent:status', payload);
      if (payload.sessionId) {
        this.swarmBoardService.updateMemberStatus(
          payload.sessionId,
          payload.subagentId,
          payload.status,
        );
        const sessionTask = this.tasksBySession.get(payload.sessionId);
        if (sessionTask) {
          sessionTask.taskState.subagents = this.subagentManager.getInstancesBySession(payload.sessionId);
        }
      }
    });
    this.subagentManager.on('subagent:token', (payload) => {
      this.emitEvent('subagent:token', payload);
    });
    this.subagentManager.on('subagent:tool', (payload) => {
      this.emitEvent('subagent:tool', payload);
    });
    this.subagentManager.on('subagent:completed', (payload) => {
      this.emitEvent('subagent:completed', payload);
      if (payload.sessionId) {
        this.swarmBoardService.updateMemberStatus(
          payload.sessionId,
          payload.subagentId,
          payload.status,
        );
        const sessionTask = this.tasksBySession.get(payload.sessionId);
        if (sessionTask) {
          sessionTask.taskState.subagents = this.subagentManager.getInstancesBySession(payload.sessionId);
          if (payload.codeModified) {
            sessionTask.codeModified = true;
            sessionTask.hasModifiedCodeInTask = true;
            const autoTestPlugin =
              this.pluginManager.getPlugin<AutoTestRepairPlugin>('harni.auto-test-repair');
            if (autoTestPlugin) {
              autoTestPlugin.markCodeModified(this.createPluginContext(sessionTask));
            }
          }
          if (payload.structuredReport?.modifiedFiles && Array.isArray(payload.structuredReport.modifiedFiles)) {
            const expPlugin =
              this.pluginManager.getPlugin<ExperienceLearningPlugin>('harni.experience-learning');
            for (const f of payload.structuredReport.modifiedFiles) {
              if (typeof f === 'string' && f.trim()) {
                const trimmed = f.trim();
                sessionTask.modifiedFiles.add(trimmed);
                if (expPlugin) {
                  expPlugin.recordModifiedFile(this.createPluginContext(sessionTask), trimmed);
                }
                if (AutoTestRunner.isCodeFile(trimmed)) {
                  sessionTask.codeModified = true;
                  sessionTask.hasModifiedCodeInTask = true;
                  const autoTestPlugin =
                    this.pluginManager.getPlugin<AutoTestRepairPlugin>('harni.auto-test-repair');
                  if (autoTestPlugin) {
                    autoTestPlugin.markCodeModified(
                      this.createPluginContext(sessionTask),
                      trimmed,
                    );
                  }
                }
              }
            }
          }
          if (payload.tokenUsage) {
            if (!sessionTask.subagentTokenUsage) {
              sessionTask.subagentTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            }
            sessionTask.subagentTokenUsage.promptTokens += payload.tokenUsage.promptTokens || 0;
            sessionTask.subagentTokenUsage.completionTokens += payload.tokenUsage.completionTokens || 0;
            sessionTask.subagentTokenUsage.totalTokens +=
              payload.tokenUsage.totalTokens ||
              (payload.tokenUsage.promptTokens || 0) + (payload.tokenUsage.completionTokens || 0);
            if (payload.tokenUsage.cacheReadTokens) {
              sessionTask.subagentTokenUsage.cacheReadTokens =
                (sessionTask.subagentTokenUsage.cacheReadTokens || 0) + payload.tokenUsage.cacheReadTokens;
            }
            if (payload.tokenUsage.cacheWriteTokens) {
              sessionTask.subagentTokenUsage.cacheWriteTokens =
                (sessionTask.subagentTokenUsage.cacheWriteTokens || 0) + payload.tokenUsage.cacheWriteTokens;
            }
            this.syncTaskState(sessionTask);
          }

          if (payload.background === true) {
            this.schedulerService.notifyWakeupEvent(payload.sessionId, payload.subagentId);
            const roleLabel = payload.role ? `${payload.role} (${payload.subagentId})` : payload.subagentId;
            const statusText = payload.status === 'completed' ? 'completed' : payload.status;
            const body =
              payload.status === 'completed'
                ? payload.result
                : payload.error || payload.result || `Subagent ${statusText}`;
            this.enqueueWakeupEvent(payload.sessionId, {
              id: `wakeup_sub_${payload.subagentId}_${Date.now()}`,
              source: 'subagent',
              sourceId: payload.subagentId,
              summary: `Background subagent ${roleLabel} ${statusText}`,
              payloadText: body,
              timestamp: Date.now(),
            });
          }
        }
      }
    });
  }

  public getTaskState(sessionId?: string): TaskState | null {
    if (sessionId) {
      const task = this.tasksBySession.get(sessionId);
      if (!task) return null;
      task.taskState.subagents = this.subagentManager.getInstancesBySession(task.sessionId);
      return { ...task.taskState };
    }
    const lastSession = this.tasksBySession.get(this.lastActiveSessionId);
    if (lastSession) {
      lastSession.taskState.subagents = this.subagentManager.getInstancesBySession(lastSession.sessionId);
      return { ...lastSession.taskState };
    }
    const first = this.tasksBySession.values().next().value;
    if (first) {
      first.taskState.subagents = this.subagentManager.getInstancesBySession(first.sessionId);
      return { ...first.taskState };
    }
    return null;
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  public getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  /**
   * Initialize MCP servers (spawn + handshake + tool discovery).
   * Safe to call repeatedly; only connects when MCP is enabled and configured.
   */
  public async initializeMcp(): Promise<McpManagerConnectResult> {
    if (!this.mcpEnabled || !this.mcpServers || Object.keys(this.mcpServers).length === 0) {
      await this.mcpManager.disconnectAll();
      return { connected: [], failed: [] };
    }
    return await this.mcpManager.connectAll(this.mcpServers, this.workspaceRoot);
  }

  /**
   * Hot-reload MCP server configuration (used when settings change at runtime).
   */
  public async updateMcpServers(update: {
    mcpEnabled?: boolean;
    mcpServers?: Record<string, McpServerConfig>;
    workspaceRoot?: string;
  }): Promise<McpManagerConnectResult> {
    if (update.mcpEnabled !== undefined) this.mcpEnabled = update.mcpEnabled;
    if (update.mcpServers) this.mcpServers = update.mcpServers;
    if (update.workspaceRoot) this.workspaceRoot = update.workspaceRoot;

    if (!this.mcpEnabled) {
      await this.mcpManager.disconnectAll();
      return { connected: [], failed: [] };
    }
    if (!this.mcpServers || Object.keys(this.mcpServers).length === 0) {
      await this.mcpManager.disconnectAll();
      return { connected: [], failed: [] };
    }
    return await this.mcpManager.connectAll(this.mcpServers, this.workspaceRoot);
  }

  /** Access to the MCP server manager (status, definitions, etc.). */
  public getMcpManager(): McpServerManager {
    return this.mcpManager;
  }

  /** Release engine resources: cancel tasks and shut down MCP child processes. */
  public async dispose(): Promise<void> {
    this.cancelTask();
    this.schedulerService.dispose();
    this.swarmBoardService.dispose();
    await this.pluginManager.runDispose();
    await this.mcpManager.disconnectAll();
  }

  /**
   * Reset conversation session and context
   */
  public resetSession(sessionId?: string): void {
    void this.pluginManager.runSessionReset(sessionId);
    this.subagentManager.clearSessionSubagents(sessionId);
    if (sessionId) {
      this.cancelTask(sessionId);
      this.schedulerService.cancelSessionSchedules(sessionId, true);
      this.swarmBoardService.clearSession(sessionId);
      this.subagentApprovalQueues.delete(sessionId);
      const sessionTask = this.tasksBySession.get(sessionId);
      if (sessionTask) {
        sessionTask.subagentTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        sessionTask.wakeupQueue = [];
        sessionTask.contextManager.clear();
        sessionTask.taskState.subagents = [];
        this.tasksBySession.delete(sessionId);
      }
    } else {
      this.cancelTask();
      this.swarmBoardService.clearSession();
      this.subagentApprovalQueues.clear();
      for (const sessionTask of this.tasksBySession.values()) {
        this.schedulerService.cancelSessionSchedules(sessionTask.sessionId, true);
        sessionTask.subagentTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        sessionTask.wakeupQueue = [];
        sessionTask.contextManager.clear();
        sessionTask.taskState.subagents = [];
      }
      this.tasksBySession.clear();
    }
  }

  /**
   * Start or resume an Agent task with user prompt (supports multi-turn conversation)
   */
  public async startTask(
    prompt: string,
    options: {
      sessionId?: string;
      mode?: AgentMode;
      provider?: LLMProviderType;
      model?: string;
      apiKey?: string;
      baseURL?: string;
      autoApprove?: boolean;
      thinkingDepth?: import('@harni/types').ThinkingDepth;
      resetContext?: boolean;
      contextFiles?: string[];
      attachments?: FileAttachment[];
      customProvider?: BaseLLMProvider;
      workspaceRoot?: string;
      history?: ChatMessage[];
      anthropicOAuth?: boolean;
      openaiOAuth?: boolean;
      openaiAccountId?: string;
      maxTurns?: number;
      autoTest?: boolean;
      testCommand?: string;
      maxTestRetries?: number;
      enableWorktree?: boolean;
      worktreeTimeoutMs?: number;
      enableCheckpoint?: boolean;
      subagentsEnabled?: boolean;
      antigravityMode?: AntigravityExecutionMode;
      contextWindow?: number;
    } = {},
  ): Promise<void> {
    const sessionId = options.sessionId || 'default';
    this.lastActiveSessionId = sessionId;

    if (options.antigravityMode) {
      this.subagentManager.setAntigravityMode(options.antigravityMode);
    }

    let sessionTask = this.tasksBySession.get(sessionId);
    const sessionWorkspaceRoot = options.workspaceRoot
      ? path.resolve(options.workspaceRoot)
      : (sessionTask?.mainWorkspaceRoot || sessionTask?.workspaceRoot || this.workspaceRoot);

    // If this session is already running an active task, abort previous task in this same session
    if (
      sessionTask &&
      sessionTask.taskState.status !== 'idle' &&
      sessionTask.taskState.status !== 'completed' &&
      sessionTask.taskState.status !== 'error' &&
      sessionTask.taskState.status !== 'cancelled'
    ) {
      sessionTask.abortController?.abort();
      if (sessionTask.pendingApproval) {
        sessionTask.pendingApproval.resolve(false, 'Superseded by new prompt');
        sessionTask.pendingApproval = null;
      }
    }

    if (options.autoApprove !== undefined) {
      this.autoApprove = options.autoApprove;
    }

    const mode = normalizeAgentMode(options.mode ?? sessionTask?.taskState.mode);
    const providerType = options.provider ?? (sessionTask?.taskState.provider || this.defaultProvider);
    const model = options.model ?? (sessionTask?.taskState.model || this.defaultModel || '');
    const effectiveApiKey = options.apiKey || this.apiKey;
    const effectiveBaseUrl = options.baseURL || this.baseURL;
    const effectiveMaxTurns = options.maxTurns ?? 100;
    const effectiveAutoTest = options.autoTest !== undefined ? options.autoTest : this.autoTestEnabled;
    const effectiveTestCommand = options.testCommand ?? this.defaultTestCommand;
    const effectiveMaxTestRetries = options.maxTestRetries ?? this.maxTestRetries;
    const effectiveSubagents =
      options.subagentsEnabled !== undefined
        ? options.subagentsEnabled
        : this.subagentsEnabled;

    const abortController = new AbortController();
    const taskId = sessionTask ? sessionTask.taskState.id : `task_${Date.now()}`;

    if (!sessionTask) {
      sessionTask = {
        sessionId,
        workspaceRoot: sessionWorkspaceRoot,
        mainWorkspaceRoot: sessionWorkspaceRoot,
        contextManager: new ContextManager(),
        abortController,
        pendingApproval: null,
        codeModified: false,
        hasModifiedCodeInTask: false,
        autoTestRetries: 0,
        checkpointId: undefined,
        isWorktree: false,
        worktreeBranch: undefined,
        subagentsEnabled: effectiveSubagents,
        anthropicOAuth: options.anthropicOAuth,
        openaiOAuth: options.openaiOAuth,
        openaiAccountId: options.openaiAccountId,
        subagentTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cachedExperiences: undefined,
        successfulActions: [],
        encounteredErrors: [],
        modifiedFiles: new Set<string>(),
        testFailureDiffs: [],
        experienceSaved: false,
        pluginStates: new Map<string, unknown>(),
        wakeupQueue: [],
        isLoopRunning: false,
        autoTestConfig: {
          enabled: effectiveAutoTest,
          testCommand: effectiveTestCommand,
          maxRetries: effectiveMaxTestRetries,
        },
        taskState: {
          id: taskId,
          sessionId,
          status: 'thinking',
          prompt,
          currentTurn: 0,
          maxTurns: effectiveMaxTurns,
          mode,
          provider: providerType,
          model,
          checkpointId: undefined,
          isWorktree: false,
          worktreeBranch: undefined,
          worktreePath: undefined,
          messages: [],
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          subagents: this.subagentManager.getInstancesBySession(sessionId),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
      this.tasksBySession.set(sessionId, sessionTask);
    } else {
      sessionTask.workspaceRoot = sessionWorkspaceRoot;
      sessionTask.mainWorkspaceRoot = sessionWorkspaceRoot;
      sessionTask.abortController = abortController;
      sessionTask.pendingApproval = null;
      sessionTask.codeModified = false;
      sessionTask.hasModifiedCodeInTask = false;
      sessionTask.autoTestRetries = 0;
      sessionTask.successfulActions = [];
      sessionTask.encounteredErrors = [];
      sessionTask.modifiedFiles = new Set<string>();
      sessionTask.testFailureDiffs = [];
      sessionTask.cachedExperiences = undefined;
      sessionTask.experienceSaved = false;
      sessionTask.subagentsEnabled = effectiveSubagents;
      sessionTask.anthropicOAuth = options.anthropicOAuth;
      sessionTask.openaiOAuth = options.openaiOAuth;
      sessionTask.openaiAccountId = options.openaiAccountId;
      sessionTask.pluginStates = new Map<string, unknown>();
      sessionTask.autoTestConfig = {
        enabled: effectiveAutoTest,
        testCommand: effectiveTestCommand,
        maxRetries: effectiveMaxTestRetries,
      };
    }

    if (options.resetContext) {
      await this.pluginManager.runSessionReset(sessionId);
    }

    const pluginCtx = this.createPluginContext(sessionTask, abortController.signal);
    await this.pluginManager.runTaskStart(pluginCtx, {
      ...options,
      prompt,
      enableWorktree: options.enableWorktree,
      enableCheckpoint: options.enableCheckpoint,
      worktreeTimeoutMs: options.worktreeTimeoutMs,
    });

    if (sessionTask.taskState.checkpointId) {
      sessionTask.checkpointId = sessionTask.taskState.checkpointId;
    }
    if (sessionTask.taskState.isWorktree !== undefined) {
      sessionTask.isWorktree = sessionTask.taskState.isWorktree;
    }
    if (sessionTask.taskState.worktreeBranch) {
      sessionTask.worktreeBranch = sessionTask.taskState.worktreeBranch;
    }

    if (options.contextWindow && options.contextWindow > 0) {
      sessionTask.contextManager.setMaxContextTokens(options.contextWindow);
    }

    if (options.history && options.history.length > 0) {
      sessionTask.contextManager.setMessages(options.history);
      sessionTask.taskState = {
        id: taskId,
        sessionId,
        status: 'thinking',
        prompt,
        currentTurn: 0,
        maxTurns: effectiveMaxTurns,
        mode,
        provider: providerType,
        model,
        checkpointId: sessionTask.checkpointId,
        isWorktree: sessionTask.isWorktree,
        worktreeBranch: sessionTask.worktreeBranch,
        worktreePath: sessionTask.isWorktree ? sessionTask.workspaceRoot : undefined,
        messages: sessionTask.contextManager.getMessages(),
        tokenUsage: sessionTask.contextManager.getTokenUsage(),
        createdAt: sessionTask.taskState.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
    } else if (options.resetContext) {
      sessionTask.contextManager.clear();
      sessionTask.subagentTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      this.subagentManager.clearSessionSubagents(sessionId);
      sessionTask.taskState = {
        id: taskId,
        sessionId,
        status: 'thinking',
        prompt,
        currentTurn: 0,
        maxTurns: effectiveMaxTurns,
        mode,
        provider: providerType,
        model,
        checkpointId: sessionTask.checkpointId,
        isWorktree: sessionTask.isWorktree,
        worktreeBranch: sessionTask.worktreeBranch,
        worktreePath: sessionTask.isWorktree ? sessionTask.workspaceRoot : undefined,
        messages: [],
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        subagents: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      // Continue existing multi-turn conversation
      sessionTask.taskState.status = 'thinking';
      sessionTask.taskState.currentTurn = 0;
      sessionTask.taskState.maxTurns = effectiveMaxTurns;
      sessionTask.taskState.prompt = prompt;
      sessionTask.taskState.mode = mode;
      sessionTask.taskState.provider = providerType;
      sessionTask.taskState.model = model;
      sessionTask.taskState.checkpointId = sessionTask.checkpointId;
      sessionTask.taskState.isWorktree = sessionTask.isWorktree;
      sessionTask.taskState.worktreeBranch = sessionTask.worktreeBranch;
      sessionTask.taskState.worktreePath = sessionTask.isWorktree ? sessionTask.workspaceRoot : undefined;
    }

    // 1. Append User Message to Context
    let userMessageContent = prompt;
    if (options.contextFiles && options.contextFiles.length > 0) {
      userMessageContent += `\n\n[Referenced files: ${options.contextFiles.join(', ')}]`;
    }
    if (options.attachments && options.attachments.length > 0) {
      for (const att of options.attachments) {
        if (att.content) {
          userMessageContent += `\n\n[Attached file: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``;
        } else if (att.type.startsWith('image/')) {
          userMessageContent += `\n\n[Attached image: ${att.name}]`;
        } else {
          userMessageContent += `\n\n[Attached file: ${att.name} (${att.size} bytes)]`;
        }
      }
    }

    const userMessage: ChatMessage = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: userMessageContent,
      attachments: options.attachments,
      timestamp: Date.now(),
    };

    sessionTask.contextManager.addMessage(userMessage);
    this.syncTaskState(sessionTask);
    this.emitEvent('task:status', { status: 'thinking', taskId, sessionId });

    // 2. Setup Provider
    let provider: BaseLLMProvider;
    if (options.customProvider) {
      provider = options.customProvider;
    } else {
      provider = ProviderFactory.create(providerType, {
        apiKey: effectiveApiKey,
        baseURL: effectiveBaseUrl,
        model: model || undefined,
        thinkingDepth: options.thinkingDepth,
        antigravityMode: options.antigravityMode,
        anthropicOAuth: options.anthropicOAuth,
        openaiOAuth: options.openaiOAuth,
        openaiAccountId: options.openaiAccountId,
        workspaceRoot: sessionTask.workspaceRoot,
        sessionId: sessionTask.sessionId,
        requestApproval: async (req) => {
          if (this.autoApprove) {
            return { approved: true };
          }
          this.setStatus(sessionTask, 'waiting_approval');
          const toolCallRequest: ToolCallRequest = {
            id: req.toolCallId,
            name: req.name,
            arguments: req.arguments,
            requiresApproval: true,
          };
          this.emitEvent('tool:request', { ...toolCallRequest, sessionId, taskId: sessionTask.taskState.id });
          return new Promise<{ approved: boolean; feedback?: string }>((resolve) => {
            sessionTask.pendingApproval = {
              toolCallId: req.toolCallId,
              resolve: (approved, feedback) => resolve({ approved, feedback }),
            };
          });
        },
      });
    }

    // 3. Main Agent Loop
    sessionTask.lastProvider = provider;
    await this.executeSessionLoop(sessionTask, provider, abortController, pluginCtx);
  }

  /**
   * Core Agent Multi-turn execution loop
   */
  private async runLoop(sessionTask: SessionTask, provider: BaseLLMProvider): Promise<void> {
    const { sessionId } = sessionTask;
    const pluginCtx = this.createPluginContext(
      sessionTask,
      sessionTask.abortController?.signal,
      provider,
    );
    let acpIncompleteContinues = 0;

    while (
      sessionTask.taskState.currentTurn < sessionTask.taskState.maxTurns &&
      !sessionTask.abortController?.signal.aborted
    ) {
      this.drainWakeupQueue(sessionTask);
      sessionTask.taskState.currentTurn++;
      this.setStatus(sessionTask, 'thinking');

      // 1. Resolve tools through plugins
      const mcpDefinitions = this.mcpManager.getToolDefinitions();
      const defaultDefinitions = this.toolRegistry.getDefinitions();
      let allDefinitions = [...defaultDefinitions, ...mcpDefinitions];
      allDefinitions = await this.pluginManager.runResolveTools(pluginCtx, allDefinitions);

      // 2. Plugin prompt sections (driven by RulesAndSkillsPlugin, ExperienceLearningPlugin, etc.)
      const pluginSections = await this.pluginManager.runBuildSystemPrompt(pluginCtx);

      // 3. Build system prompt
      const systemPrompt = SystemPromptBuilder.build({
        workspaceRoot: sessionTask.workspaceRoot,
        mode: sessionTask.taskState.mode,
        customInstructions: this.customInstructions,
        tools: allDefinitions,
        pluginSections,
      });

      // 6. Call LLM with streaming
      const result = await provider.streamCompletion(
        sessionTask.contextManager.getMessages(),
        systemPrompt,
        allDefinitions,
        (chunk) => {
          if (sessionTask.abortController?.signal.aborted) return;
          if (chunk.type === 'token') {
            this.emitEvent('chat:token', { text: chunk.content, sessionId, taskId: sessionTask.taskState.id });
          } else if (chunk.type === 'thinking') {
            this.emitEvent('chat:thinking', { thought: chunk.thought, sessionId, taskId: sessionTask.taskState.id });
          } else if (chunk.type === 'tool_call') {
            const mcpTool = this.mcpManager.getTool(chunk.name);
            const request: ToolCallRequest = {
              id: chunk.id,
              name: chunk.name,
              arguments: chunk.arguments,
              requiresApproval:
                mcpTool?.requiresApproval ?? this.toolRegistry.getTool(chunk.name)?.requiresApproval ?? false,
            };
            this.emitEvent('tool:request', { ...request, sessionId, taskId: sessionTask.taskState.id });
          }
        },
        sessionTask.abortController?.signal,
      );

      // 7. Record Assistant message
      const assistantMessage: ChatMessage = {
        id: `msg_asst_${Date.now()}`,
        role: 'assistant',
        content: result.text,
        thinking: result.thinking,
        toolCalls: result.toolCalls,
        timestamp: Date.now(),
      };
      sessionTask.contextManager.addMessage(assistantMessage);
      this.syncTaskState(sessionTask);

      // 8. If no tools were called, drain any pending wakeup events before completion gate
      if (!result.toolCalls || result.toolCalls.length === 0) {
        if (this.drainWakeupQueue(sessionTask)) {
          continue;
        }
        const incompleteAcpTools = AntigravityProvider.extractIncompleteAcpTools(result.thinking);
        if (incompleteAcpTools.length > 0 && acpIncompleteContinues < 3) {
          acpIncompleteContinues++;
          sessionTask.contextManager.addMessage({
            id: `msg_acp_cont_${Date.now()}`,
            role: 'user',
            content: `[SYSTEM_NOTIFICATION] 偵測到 ACP 工具 (${incompleteAcpTools.join(', ')}) 處於 in_progress 狀態但回合提前結束。請確認該指令的執行結果（必要時使用 manage_task 查詢狀態），並繼續完成使用者要求的後續修改步驟，請勿僅停留在進度回報。`,
            timestamp: Date.now(),
          });
          this.syncTaskState(sessionTask);
          continue;
        }
        if (incompleteAcpTools.length === 0) {
          acpIncompleteContinues = 0;
        }
        const gateResult = await this.pluginManager.runBeforeComplete(pluginCtx);

        if (gateResult.action === 'continue_loop') {
          if (gateResult.injectedMessages) {
            for (const msg of gateResult.injectedMessages) {
              sessionTask.contextManager.addMessage(msg);
            }
          }
          this.syncTaskState(sessionTask);
          continue;
        } else if (gateResult.action === 'complete_with_messages') {
          if (gateResult.appendedMessages) {
            for (const msg of gateResult.appendedMessages) {
              sessionTask.contextManager.addMessage(msg);
            }
          }
          sessionTask.experienceSaved = true;
          this.setStatus(sessionTask, 'completed');
          this.syncTaskState(sessionTask);
          break;
        } else {
          // action === 'allow'
          if (gateResult.appendedMessages) {
            for (const msg of gateResult.appendedMessages) {
              sessionTask.contextManager.addMessage(msg);
            }
          }

          await this.pluginManager.runTaskCompleted(pluginCtx);
          this.setStatus(sessionTask, 'completed');
          break;
        }
      }

      // 9. Execute tool calls through plugin middleware pipeline
      for (const toolCall of result.toolCalls) {
        if (sessionTask.abortController?.signal.aborted) break;

        const tool = this.toolRegistry.getTool(toolCall.name);
        const mcpTool = this.mcpManager.getTool(toolCall.name);
        const canonicalToolName = this.toolRegistry.resolveToolName(toolCall.name);
        const requiresApproval =
          (mcpTool?.requiresApproval ?? tool?.requiresApproval ?? false) && !this.autoApprove;

        const mcpToolAllowedReadOnly = mcpTool
          ? this.mcpManager.isToolAllowedForReadOnly(toolCall.name)
          : true;

        const toolCtx: ToolCallMiddlewareContext = {
          toolCall,
          canonicalToolName,
          requiresApproval,
          isMcpTool: Boolean(mcpTool),
          mcpToolAllowedReadOnly,
          metadata: {},
        };

        const execContext: ToolExecutionContext = {
          workspaceRoot: sessionTask.workspaceRoot,
          sessionId: sessionTask.sessionId,
          taskId: sessionTask.taskState.id,
          depth: 0,
          provider: sessionTask.taskState.provider,
          model: sessionTask.taskState.model,
          apiKey: provider.getApiKey() || this.apiKey,
          baseURL: provider.getBaseURL() || this.baseURL,
          anthropicOAuth: sessionTask.anthropicOAuth,
          openaiOAuth: sessionTask.openaiOAuth,
          openaiAccountId: sessionTask.openaiAccountId,
          subagentManager: this.subagentManager,
          schedulerService: this.schedulerService,
          swarmBoardService: this.swarmBoardService,
          getSessionMessages: () => sessionTask.contextManager.getMessages(),
          resolveForkMessages: (source: string) =>
            this.subagentManager.resolveForkMessages(
              sessionTask.sessionId,
              source,
              () => sessionTask.contextManager.getMessages(),
            ),
          parentSignal: sessionTask.abortController?.signal,
          skipInlineDiagnostics: this.pluginManager.hasPlugin('harni.syntax-diagnostics'),
          onCodeModified: () => {
            sessionTask.codeModified = true;
            sessionTask.hasModifiedCodeInTask = true;
          },
          onFileDiff: (diff: FileDiff) => {
            this.emitEvent('file:diff', { ...diff, sessionId, taskId: sessionTask.taskState.id });
          },
          onDiagnostics: (diag) => {
            this.emitEvent('file:diagnostics', {
              ...diag,
              sessionId,
              taskId: sessionTask.taskState.id,
            });
          },
          onTerminalData: (data: string) => {
            this.emitEvent('terminal:data', { data, sessionId });
          },
          executeTerminalCommand: this.executeTerminalCommand,
          askQuestion: async (params) => {
            this.setStatus(sessionTask, 'waiting_user_input');
            this.emitEvent('question:ask', {
              toolCallId: toolCall.id,
              question: params.question,
              options: params.options,
              isMultiSelect: params.isMultiSelect,
              allowCustomInput: params.allowCustomInput ?? true,
              sessionId,
              taskId: sessionTask.taskState.id,
            });

            const answer = await new Promise<{ answers: string[]; customInput?: string }>(
              (resolve) => {
                sessionTask.pendingQuestion = {
                  toolCallId: toolCall.id,
                  resolve: (ans) => resolve(ans),
                };
              },
            );

            sessionTask.pendingQuestion = null;
            this.setStatus(sessionTask, 'executing_tool');
            return answer;
          },
          runContrastiveProbe: async (probeParams: ContrastiveProbeParams): Promise<ContrastiveProbeResult> => {
            const llmCaller = async (promptText: string): Promise<string> => {
              const comp = await provider.streamCompletion(
                [
                  {
                    id: `msg_probe_${Date.now()}`,
                    role: 'user',
                    content: promptText,
                    timestamp: Date.now(),
                  },
                ],
                'You are an expert evaluator assessing and comparing code solution candidates.',
                [],
                () => {},
                sessionTask.abortController?.signal,
              );
              return comp.text;
            };

            const probeResult = await ContrastiveProbeRunner.evaluateCandidates({
              taskDescription: probeParams.taskDescription,
              candidates: probeParams.candidates,
              llmCaller,
            });
            this.emitEvent('probe:result', {
              sessionId,
              taskId: sessionTask.taskState.id,
              result: probeResult,
            });
            return probeResult;
          },
        };

        const coreExecutor = async (): Promise<ToolResult> => {
          this.setStatus(sessionTask, 'executing_tool');
          if (mcpTool) {
            return await this.mcpManager.callTool(
              toolCall.name,
              toolCall.arguments as Record<string, unknown>,
            );
          } else {
            return await this.toolRegistry.executeTool(
              toolCall.name,
              toolCall.arguments,
              execContext,
            );
          }
        };

        let toolResult: ToolResult;
        try {
          toolResult = await this.pluginManager.executeToolWithMiddleware(
            pluginCtx,
            toolCtx,
            async () => {
              try {
                return await coreExecutor();
              } catch (toolErr: unknown) {
                const errText = toolErr instanceof Error ? toolErr.message : String(toolErr);
                return {
                  toolCallId: toolCall.id,
                  isError: true,
                  output: `工具執行失敗 (${toolCall.name}): ${errText}`,
                  summary: `Error executing ${toolCall.name}`,
                };
              }
            },
          );
        } catch (toolErr: unknown) {
          const errText = toolErr instanceof Error ? toolErr.message : String(toolErr);
          toolResult = {
            toolCallId: toolCall.id,
            isError: true,
            output: `工具執行失敗 (${toolCall.name}): ${errText}`,
            summary: `Error executing ${toolCall.name}`,
          };
        }

        toolResult.toolCallId = toolCall.id;

        // Keep sessionTask tracking in sync
        if (!toolResult.isError) {
          const toolSummary =
            toolResult.summary || `${toolCall.name} executed successfully`;
          sessionTask.successfulActions.push(toolSummary);
          if (sessionTask.successfulActions.length > 15) {
            sessionTask.successfulActions.shift();
          }

          if (
            canonicalToolName === 'write_file' ||
            canonicalToolName === 'edit_file' ||
            canonicalToolName === 'write_to_file' ||
            canonicalToolName === 'replace_file_content'
          ) {
            const targetPath = String(
              toolCall.arguments.path ??
                toolCall.arguments.TargetFile ??
                toolCall.arguments.AbsolutePath ??
                '',
            );
            if (targetPath) {
              sessionTask.modifiedFiles.add(targetPath);
            }
            if (AutoTestRunner.isCodeFile(targetPath)) {
              sessionTask.codeModified = true;
              sessionTask.hasModifiedCodeInTask = true;
            }
          }
        } else {
          const errSummary =
            toolResult.summary ||
            (typeof toolResult.output === 'string'
              ? toolResult.output.slice(0, 200)
              : `Error executing ${toolCall.name}`);
          sessionTask.encounteredErrors.push(errSummary);
          if (sessionTask.encounteredErrors.length > 5) {
            sessionTask.encounteredErrors.shift();
          }
        }

        // Emit tool result event
        this.emitEvent('tool:result', { ...toolResult, sessionId, taskId: sessionTask.taskState.id });

        const toolOutputStr =
          typeof toolResult.output === 'string'
            ? toolResult.output
            : JSON.stringify(toolResult.output);

        // Record Tool message
        const toolMsg: ChatMessage = {
          id: `msg_tool_${Date.now()}`,
          role: 'tool',
          name: toolCall.name,
          content: toolOutputStr,
          toolCallId: toolCall.id,
          toolResult,
          timestamp: Date.now(),
        };
        sessionTask.contextManager.addMessage(toolMsg);
        this.syncTaskState(sessionTask);
      }
    }

    // Check if max turns limit was reached without natural completion
    if (
      sessionTask.taskState.currentTurn >= sessionTask.taskState.maxTurns &&
      sessionTask.taskState.status !== 'completed' &&
      sessionTask.taskState.status !== 'cancelled'
    ) {
      const pauseMsg: ChatMessage = {
        id: `msg_limit_${Date.now()}`,
        role: 'assistant',
        content: `⚠️ **已達到單次執行輪數上限 (${sessionTask.taskState.maxTurns} 輪)**：為確保 Token 消耗安全與防止潛在迴圈，任務已自動暫停。\n\n*💡 若尚未完成全部工作，請直接在下方回覆「**繼續**」讓 Agent 接續執行。*`,
        timestamp: Date.now(),
      };
      sessionTask.contextManager.addMessage(pauseMsg);
      sessionTask.experienceSaved = true;
      this.setStatus(sessionTask, 'completed');
      this.syncTaskState(sessionTask);
    }

    if (sessionTask.pendingExperiencePromise) {
      try {
        await sessionTask.pendingExperiencePromise;
      } catch {
        // Safe to ignore, warning is already logged inside autoSynthesizeAndSaveExperience
      }
    }

    const expPlugin = this.pluginManager.getPlugin<ExperienceLearningPlugin>('harni.experience-learning');
    if (expPlugin) {
      await expPlugin.awaitPendingSaves(sessionId);
    }
  }

  /**
   * User approval callback for pending tool actions
   */
  public handleApproval(
    toolCallId: string,
    approved: boolean,
    feedback?: string,
    sessionId?: string,
  ): boolean {
    if (sessionId) {
      const task = this.tasksBySession.get(sessionId);
      if (task?.pendingApproval && task.pendingApproval.toolCallId === toolCallId) {
        task.pendingApproval.resolve(approved, feedback);
        task.pendingApproval = null;
        return true;
      }
    }
    for (const task of this.tasksBySession.values()) {
      if (task.pendingApproval && task.pendingApproval.toolCallId === toolCallId) {
        task.pendingApproval.resolve(approved, feedback);
        task.pendingApproval = null;
        return true;
      }
    }
    return false;
  }

  /**
   * User answer callback for pending question actions
   */
  public handleAnswerQuestion(
    toolCallId: string,
    answers: string[],
    customInput?: string,
    sessionId?: string,
  ): boolean {
    if (sessionId) {
      const task = this.tasksBySession.get(sessionId);
      if (task?.pendingQuestion && task.pendingQuestion.toolCallId === toolCallId) {
        task.pendingQuestion.resolve({ answers, customInput });
        task.pendingQuestion = null;
        return true;
      }
    }
    for (const task of this.tasksBySession.values()) {
      if (task.pendingQuestion && task.pendingQuestion.toolCallId === toolCallId) {
        task.pendingQuestion.resolve({ answers, customInput });
        task.pendingQuestion = null;
        return true;
      }
    }
    return false;
  }

  /**
   * Cancel ongoing task for a specific session or all sessions
   */
  public cancelTask(target?: string | { taskId?: string; sessionId?: string }): void {
    const targetSessionId = typeof target === 'string' ? target : target?.sessionId;
    const targetTaskId = typeof target === 'object' ? target.taskId : undefined;

    if (targetSessionId) {
      this.subagentManager.abortSessionSubagents(targetSessionId);
    } else {
      this.subagentManager.manageSubagents('kill_all');
    }

    if (targetSessionId) {
      this.schedulerService.cancelSessionSchedules(targetSessionId, false);
      if (this.tasksBySession.has(targetSessionId)) {
        const task = this.tasksBySession.get(targetSessionId)!;
        task.wakeupQueue = [];
        task.abortController?.abort();
        if (task.pendingApproval) {
          task.pendingApproval.resolve(false, 'Task cancelled by user');
          task.pendingApproval = null;
        }
        if (task.pendingQuestion) {
          task.pendingQuestion.resolve({ answers: [], customInput: 'Task cancelled by user' });
          task.pendingQuestion = null;
        }
        this.setStatus(task, 'cancelled');
      }
      return;
    }

    if (targetTaskId) {
      for (const task of this.tasksBySession.values()) {
        if (task.taskState.id === targetTaskId) {
          this.schedulerService.cancelSessionSchedules(task.sessionId, false);
          task.wakeupQueue = [];
          task.abortController?.abort();
          if (task.pendingApproval) {
            task.pendingApproval.resolve(false, 'Task cancelled by user');
            task.pendingApproval = null;
          }
          if (task.pendingQuestion) {
            task.pendingQuestion.resolve({ answers: [], customInput: 'Task cancelled by user' });
            task.pendingQuestion = null;
          }
          this.setStatus(task, 'cancelled');
          return;
        }
      }
      return;
    }

    // Only if target is completely omitted or empty do we cancel all sessions
    for (const task of this.tasksBySession.values()) {
      this.schedulerService.cancelSessionSchedules(task.sessionId, false);
      task.wakeupQueue = [];
      task.abortController?.abort();
      if (task.pendingApproval) {
        task.pendingApproval.resolve(false, 'Task cancelled by user');
        task.pendingApproval = null;
      }
      if (task.pendingQuestion) {
        task.pendingQuestion.resolve({ answers: [], customInput: 'Task cancelled by user' });
        task.pendingQuestion = null;
      }
      this.setStatus(task, 'cancelled');
    }
  }

  private enqueueWakeupEvent(sessionId: string, event: WakeupEvent): void {
    const sessionTask = this.tasksBySession.get(sessionId);
    if (!sessionTask) return;
    if (sessionTask.taskState.status === 'cancelled') return;

    sessionTask.wakeupQueue.push(event);
    this.emitEvent('wakeup:queued', {
      sessionId,
      source: event.source,
      sourceId: event.sourceId,
      summary: event.summary,
    });

    if (
      !sessionTask.isLoopRunning &&
      (sessionTask.taskState.status === 'completed' || sessionTask.taskState.status === 'idle')
    ) {
      void this.wakeSession(sessionTask);
    }
  }

  private drainWakeupQueue(sessionTask: SessionTask): boolean {
    if (sessionTask.wakeupQueue.length === 0) {
      return false;
    }

    const events = sessionTask.wakeupQueue.splice(0, sessionTask.wakeupQueue.length);
    const lines = events.map((ev, idx) => {
      const tag = ev.sourceId ? `${ev.source}:${ev.sourceId}` : ev.source;
      return `[${idx + 1}] (${tag}) ${ev.summary}\n${ev.payloadText}`;
    });

    const notifMsg: ChatMessage = {
      id: `msg_wakeup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: `[SYSTEM_NOTIFICATION — Reactive Wakeup]\n${lines.join('\n\n')}`,
      timestamp: Date.now(),
    };
    sessionTask.contextManager.addMessage(notifMsg);
    this.syncTaskState(sessionTask);
    return true;
  }

  private async wakeSession(sessionTask: SessionTask): Promise<void> {
    if (
      sessionTask.isLoopRunning ||
      sessionTask.taskState.status === 'cancelled' ||
      !sessionTask.lastProvider ||
      sessionTask.wakeupQueue.length === 0
    ) {
      return;
    }

    const { sessionId } = sessionTask;
    const taskId = sessionTask.taskState.id;
    const provider = sessionTask.lastProvider;
    const abortController = new AbortController();

    sessionTask.abortController = abortController;
    sessionTask.taskState.currentTurn = 0;
    this.setStatus(sessionTask, 'thinking');
    this.emitEvent('task:status', { status: 'thinking', taskId, sessionId });

    const pluginCtx = this.createPluginContext(sessionTask, abortController.signal, provider);
    await this.executeSessionLoop(sessionTask, provider, abortController, pluginCtx);
  }

  private async executeSessionLoop(
    sessionTask: SessionTask,
    provider: BaseLLMProvider,
    abortController: AbortController,
    pluginCtx: WorkflowPluginContext,
  ): Promise<void> {
    const { sessionId } = sessionTask;
    const taskId = sessionTask.taskState.id;

    sessionTask.isLoopRunning = true;
    try {
      await this.runLoop(sessionTask, provider);
    } catch (err: unknown) {
      if (sessionTask.abortController?.signal.aborted) {
        this.setStatus(sessionTask, 'cancelled');
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.setStatus(sessionTask, 'error');

        const errorResult = await this.pluginManager.runTaskError(pluginCtx, err);
        if (errorResult && errorResult.handled && errorResult.customMessage) {
          sessionTask.contextManager.addMessage(errorResult.customMessage);
        } else {
          const errChatMsg: ChatMessage = {
            id: `msg_err_${Date.now()}`,
            role: 'assistant',
            content: `❌ **執行發生錯誤**:\n\n${errorMsg}`,
            timestamp: Date.now(),
          };
          sessionTask.contextManager.addMessage(errChatMsg);
          this.emitEvent('error', { code: 'TASK_ERROR', message: errorMsg, sessionId, taskId });
        }
      }
    } finally {
      if (sessionTask.abortController === abortController) {
        sessionTask.isLoopRunning = false;
        sessionTask.abortController = null;
        sessionTask.pendingApproval = null;
        sessionTask.pendingQuestion = null;
      }
      this.syncTaskState(sessionTask);
      if (
        !sessionTask.isLoopRunning &&
        sessionTask.wakeupQueue.length > 0 &&
        (sessionTask.taskState.status === 'completed' || sessionTask.taskState.status === 'idle')
      ) {
        void this.wakeSession(sessionTask);
      }
    }
  }

  private async autoSynthesizeAndSaveExperience(sessionTask: SessionTask): Promise<void> {
    const expManager =
      this.getExperienceManagerForRoot(sessionTask.mainWorkspaceRoot || sessionTask.workspaceRoot) ??
      this.experienceManager;

    if (!this.experienceLearningEnabled || !expManager) {
      return;
    }
    if (!sessionTask.hasModifiedCodeInTask && sessionTask.modifiedFiles.size === 0) {
      return;
    }

    try {
      const userMessages = sessionTask.contextManager.getMessages().filter((m) => m.role === 'user');
      const lastUserMsg = userMessages[userMessages.length - 1];
      const taskDescription =
        sessionTask.taskState.prompt?.trim() || (lastUserMsg ? lastUserMsg.content : '');
      if (!taskDescription.trim()) return;

      const synthesized = expManager.synthesizeFromResolution({
        taskDescription,
        successfulActions: [...sessionTask.successfulActions],
        encounteredErrors: [...sessionTask.encounteredErrors],
        keyFiles: Array.from(sessionTask.modifiedFiles),
      });

      await expManager.saveExperience(synthesized);
    } catch (expErr) {
      console.warn('[Engine] Failed to auto-synthesize and save experience:', expErr);
    }
  }

  private setStatus(sessionTask: SessionTask, status: AgentStatus): void {
    sessionTask.taskState.status = status;
    sessionTask.taskState.updatedAt = Date.now();
    this.emitEvent('task:status', {
      status,
      taskId: sessionTask.taskState.id,
      sessionId: sessionTask.sessionId,
    });

    if (status === 'completed' && !sessionTask.experienceSaved) {
      sessionTask.experienceSaved = true;
      const expPlugin = this.pluginManager.getPlugin<ExperienceLearningPlugin>('harni.experience-learning');
      if (!expPlugin) {
        sessionTask.pendingExperiencePromise = this.autoSynthesizeAndSaveExperience(sessionTask);
      }
    }
  }

  private syncTaskState(sessionTask: SessionTask): void {
    sessionTask.taskState.messages = sessionTask.contextManager?.getMessages() || [];
    sessionTask.taskState.subagents = this.subagentManager.getInstancesBySession(sessionTask.sessionId);
    const ctxUsage = sessionTask.contextManager?.getTokenUsage() || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    const subUsage = sessionTask.subagentTokenUsage || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    sessionTask.taskState.tokenUsage = {
      promptTokens: (ctxUsage.promptTokens || 0) + (subUsage.promptTokens || 0),
      completionTokens: (ctxUsage.completionTokens || 0) + (subUsage.completionTokens || 0),
      totalTokens: (ctxUsage.totalTokens || 0) + (subUsage.totalTokens || 0),
      cacheReadTokens:
        (ctxUsage.cacheReadTokens || 0) + (subUsage.cacheReadTokens || 0) || undefined,
      cacheWriteTokens:
        (ctxUsage.cacheWriteTokens || 0) + (subUsage.cacheWriteTokens || 0) || undefined,
    };
    sessionTask.taskState.updatedAt = Date.now();
    this.emitEvent('task:state', {
      ...sessionTask.taskState,
      sessionId: sessionTask.sessionId,
    });
  }

  private async handleSubagentToolApproval(
    sessionId: string,
    request: ToolCallRequest & { subagentId: string; subagentRole: string },
    signal?: AbortSignal,
  ): Promise<{ approved: boolean; feedback?: string }> {
    if (this.autoApprove) {
      return { approved: true };
    }
    if (signal?.aborted) {
      return { approved: false, feedback: 'Subagent cancelled' };
    }

    const previousQueue = this.subagentApprovalQueues.get(sessionId) || Promise.resolve();
    let releaseQueue: () => void;
    const currentQueue = new Promise<void>((r) => {
      releaseQueue = r;
    });
    this.subagentApprovalQueues.set(
      sessionId,
      previousQueue.then(
        () => currentQueue,
        () => currentQueue,
      ),
    );

    await previousQueue;
    try {
      if (signal?.aborted) {
        return { approved: false, feedback: 'Subagent cancelled' };
      }
      const sessionTask = this.tasksBySession.get(sessionId);
      if (!sessionTask) {
        return { approved: false, feedback: 'Session not found' };
      }
      return await new Promise<{ approved: boolean; feedback?: string }>((resolve) => {
        let finished = false;
        const finish = (result: { approved: boolean; feedback?: string }) => {
          if (finished) return;
          finished = true;
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          if (sessionTask.pendingApproval?.toolCallId === request.id) {
            sessionTask.pendingApproval = null;
            this.setStatus(sessionTask, 'executing_tool');
          }
          resolve(result);
        };

        const onAbort = () => {
          finish({ approved: false, feedback: 'Subagent cancelled' });
        };

        if (signal?.aborted) {
          finish({ approved: false, feedback: 'Subagent cancelled' });
          return;
        }

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        sessionTask.pendingApproval = {
          toolCallId: request.id,
          resolve: (approved: boolean, feedback?: string) => {
            finish({ approved, feedback });
          },
        };

        this.emitEvent('tool:request', {
          ...request,
          requiresApproval: true,
          sessionId,
          taskId: sessionTask.taskState.id,
        });
        this.setStatus(sessionTask, 'waiting_approval');
      });
    } finally {
      releaseQueue!();
    }
  }

  private async handleSubagentAskQuestion(
    sessionId: string,
    params: {
      question: string;
      options?: string[];
      isMultiSelect?: boolean;
      allowCustomInput?: boolean;
      subagentId: string;
      subagentRole: string;
    },
    signal?: AbortSignal,
  ): Promise<{ answers: string[]; customInput?: string }> {
    if (signal?.aborted) {
      return { answers: [] };
    }

    const previousQueue = this.subagentQuestionQueues.get(sessionId) || Promise.resolve();
    let releaseQueue: () => void;
    const currentQueue = new Promise<void>((r) => {
      releaseQueue = r;
    });
    this.subagentQuestionQueues.set(
      sessionId,
      previousQueue.then(
        () => currentQueue,
        () => currentQueue,
      ),
    );

    await previousQueue;
    try {
      if (signal?.aborted) {
        return { answers: [] };
      }
      const sessionTask = this.tasksBySession.get(sessionId);
      if (!sessionTask) {
        return { answers: [] };
      }

      const toolCallId = `sub_q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      return await new Promise<{ answers: string[]; customInput?: string }>((resolve) => {
        let finished = false;
        const finish = (result: { answers: string[]; customInput?: string }) => {
          if (finished) return;
          finished = true;
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
          if (sessionTask.pendingQuestion?.toolCallId === toolCallId) {
            sessionTask.pendingQuestion = null;
            this.setStatus(sessionTask, 'thinking');
          }
          resolve(result);
        };

        const onAbort = () => {
          finish({ answers: [] });
        };

        if (signal?.aborted) {
          finish({ answers: [] });
          return;
        }

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        sessionTask.pendingQuestion = {
          toolCallId,
          resolve: (answer) => {
            finish(answer);
          },
        };

        this.emitEvent('question:ask', {
          toolCallId,
          question: params.question,
          options: params.options,
          isMultiSelect: params.isMultiSelect,
          allowCustomInput: params.allowCustomInput ?? true,
          sessionId,
          taskId: sessionTask.taskState.id,
          subagentId: params.subagentId,
          subagentRole: params.subagentRole,
        });
        this.setStatus(sessionTask, 'waiting_user_input');
      });
    } finally {
      releaseQueue!();
    }
  }

  /**
   * Rollback workspace to a checkpoint (One-Click Revert)
   */
  public async rollbackCheckpoint(
    sessionId?: string,
    checkpointId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const targetSession = sessionId ? this.tasksBySession.get(sessionId) : undefined;
    const targetRoot =
      targetSession?.mainWorkspaceRoot || targetSession?.workspaceRoot || this.workspaceRoot;
    const targetCkptId = checkpointId || targetSession?.checkpointId;

    const res = await this.gitCheckpointService.rollbackCheckpoint(targetRoot, targetCkptId);

    this.emitEvent('checkpoint:restored', {
      checkpointId: targetCkptId || '',
      sessionId,
      success: res.success,
      message: res.message,
    });

    if (res.success && targetSession) {
      targetSession.codeModified = false;
      targetSession.hasModifiedCodeInTask = false;
      targetSession.modifiedFiles.clear();
      if (targetSession.isWorktree) {
        targetSession.isWorktree = false;
        targetSession.workspaceRoot = targetRoot;
      }
    }

    return res;
  }

  /**
   * Merge isolated Worktree changes back into main workspace branch
   */
  public async mergeWorktree(
    sessionId: string,
    commitMessage?: string,
  ): Promise<{ success: boolean; message: string }> {
    const targetSession = this.tasksBySession.get(sessionId);
    const targetRoot = targetSession?.mainWorkspaceRoot || this.workspaceRoot;

    const res = await this.gitCheckpointService.mergeWorktree(targetRoot, sessionId, commitMessage);

    if (res.success && targetSession) {
      targetSession.isWorktree = false;
      targetSession.workspaceRoot = targetRoot;
    }

    this.emitEvent('worktree:status', {
      sessionId,
      isWorktree: false,
      merged: res.success,
    });

    return res;
  }

  /**
   * Discard isolated Worktree without touching main workspace
   */
  public async discardWorktree(
    sessionId: string,
  ): Promise<{ success: boolean; message: string }> {
    const targetSession = this.tasksBySession.get(sessionId);
    const targetRoot = targetSession?.mainWorkspaceRoot || this.workspaceRoot;

    const res = await this.gitCheckpointService.discardWorktree(targetRoot, sessionId);

    if (res.success && targetSession) {
      targetSession.codeModified = false;
      targetSession.hasModifiedCodeInTask = false;
      targetSession.modifiedFiles.clear();
      targetSession.isWorktree = false;
      targetSession.workspaceRoot = targetRoot;
    }

    this.emitEvent('worktree:status', {
      sessionId,
      isWorktree: false,
      discarded: res.success,
    });

    return res;
  }

  /**
   * List Git branches for the current workspace or custom root
   */
  public async listBranches(workspaceRoot?: string): Promise<GitBranchesResponse> {
    return this.gitCheckpointService.listBranches(workspaceRoot || this.workspaceRoot);
  }

  /**
   * Switch Git branch for current workspace or custom root
   */
  public async switchBranch(
    branchName: string,
    options?: { workspaceRoot?: string; create?: boolean },
  ): Promise<GitBranchSwitchResult> {
    const root = options?.workspaceRoot || this.workspaceRoot;
    return this.gitCheckpointService.switchBranch(root, branchName, {
      create: options?.create,
    });
  }

  /**
   * Get all checkpoints for a workspace
   */
  public getCheckpoints(workspaceRoot?: string): CheckpointInfo[] {
    return this.gitCheckpointService.getCheckpoints(workspaceRoot || this.workspaceRoot);
  }

  /**
   * Get active worktree status for a session
   */
  public getActiveWorktree(sessionId: string): WorktreeStatusInfo | null {
    return this.gitCheckpointService.getActiveWorktree(sessionId);
  }

  /**
   * Prune checkpoints and clean up stale worktree branches
   */
  public async pruneCheckpointsAndBranches(
    workspaceRoot?: string,
    maxRetained?: number,
  ): Promise<{ deletedCheckpoints: number; deletedBranches: number }> {
    const root = workspaceRoot || this.workspaceRoot;
    const deletedCheckpoints = await this.gitCheckpointService.pruneCheckpoints(root, {
      maxRetained: maxRetained ?? this.gitCheckpointService.maxRetainedCheckpoints,
    });
    const staleBranches = await this.gitCheckpointService.pruneStaleBranches(root);
    this.emitEvent('checkpoint:pruned', {
      deletedCheckpoints,
      deletedBranches: staleBranches.length,
    });
    return {
      deletedCheckpoints,
      deletedBranches: staleBranches.length,
    };
  }

  /**
   * Delete all checkpoints and git artifacts associated with a session
   */
  public async deleteSessionGitArtifacts(
    sessionId: string,
    workspaceRoot?: string,
  ): Promise<{ deletedCheckpoints: number; deletedBranches: number }> {
    const root = workspaceRoot || this.workspaceRoot;
    const { deletedCheckpoints, deletedBranches } =
      await this.gitCheckpointService.deleteSessionCheckpoints(root, sessionId);
    return {
      deletedCheckpoints,
      deletedBranches: deletedBranches.length,
    };
  }
}
