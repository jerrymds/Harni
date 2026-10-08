import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ContextManager } from './context/contextManager.js';
import { SystemPromptBuilder } from './prompts/systemPrompt.js';
import { BaseLLMProvider } from './providers/baseProvider.js';
import { ProviderFactory } from './providers/providerFactory.js';
import { ToolRegistry } from './tools/toolRegistry.js';
import { SkillRegistry } from './skills/skillRegistry.js';
import { McpServerManager } from './mcp/mcpServerManager.js';
import { SubagentManager } from './subagents/subagentManager.js';
import { AutoTestRunner } from './testing/autoTestRunner.js';
import { GitCheckpointService } from './git/gitCheckpointService.js';
import { parseRateLimitError } from './utils/rateLimit.js';
import type { ToolExecutionContext } from './tools/baseTool.js';
import type {
  AgentMode,
  AgentStatus,
  AutoTestConfig,
  ChatMessage,
  CheckpointInfo,
  FileDiff,
  LLMProviderType,
  ServerToClientEvents,
  TaskState,
  ToolCallRequest,
  ToolResult,
  WorktreeStatusInfo,
} from '@harni/types';
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
  autoTestEnabled?: boolean;
  testCommand?: string;
  maxTestRetries?: number;
  gitCheckpointEnabled?: boolean;
  worktreeIsolationEnabled?: boolean;
  worktreeTimeoutMs?: number;
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
  autoTestRetries: number;
  autoTestConfig: AutoTestConfig;
  checkpointId?: string;
  isWorktree?: boolean;
  worktreeBranch?: string;
  subagentsEnabled: boolean;
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
  private gitCheckpointService: GitCheckpointService;
  private mcpEnabled: boolean = false;
  private mcpServers?: Record<string, McpServerConfig>;
  public autoApprove: boolean = false;
  public autoTestEnabled: boolean = true;
  public gitCheckpointEnabled: boolean = true;
  public worktreeIsolationEnabled: boolean = false;
  public worktreeTimeoutMs: number = 180000;
  public subagentsEnabled: boolean = true;
  private defaultTestCommand?: string;
  private maxTestRetries: number = 5;

  private tasksBySession = new Map<string, SessionTask>();
  private lastActiveSessionId: string = 'default';

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
    this.autoTestEnabled = config.autoTestEnabled ?? true;
    this.defaultTestCommand = config.testCommand;
    this.maxTestRetries = config.maxTestRetries ?? 5;
    this.gitCheckpointEnabled = config.gitCheckpointEnabled ?? true;
    this.worktreeIsolationEnabled = config.worktreeIsolationEnabled ?? false;
    this.worktreeTimeoutMs = config.worktreeTimeoutMs ?? 180000;
    this.subagentsEnabled = config.subagentsEnabled ?? true;

    this.gitCheckpointService = new GitCheckpointService();
    this.skillRegistry = new SkillRegistry(true);
    this.toolRegistry = new ToolRegistry(true, this.skillRegistry);
    this.mcpManager = new McpServerManager({ workspaceRoot: config.workspaceRoot });
    this.subagentManager = new SubagentManager({
      workspaceRoot: config.workspaceRoot,
      defaultProvider: this.defaultProvider,
      defaultModel: this.defaultModel,
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      maxDepth: config.maxSubagentDepth ?? 2,
      executeTerminalCommand: this.executeTerminalCommand,
    });

    this.bindSubagentEvents();

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

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public setWorkspaceRoot(newRoot: string): void {
    this.workspaceRoot = path.resolve(newRoot);
    this.mcpManager.setWorkspaceRoot(this.workspaceRoot);
    this.subagentManager.setWorkspaceRoot(this.workspaceRoot);
  }

  public getSubagentManager(): SubagentManager {
    return this.subagentManager;
  }

  public getGitCheckpointService(): GitCheckpointService {
    return this.gitCheckpointService;
  }

  private bindSubagentEvents(): void {
    this.subagentManager.on('subagent:spawned', (payload) => {
      this.emitEvent('subagent:spawned', payload);
    });
    this.subagentManager.on('subagent:status', (payload) => {
      this.emitEvent('subagent:status', payload);
    });
    this.subagentManager.on('subagent:token', (payload) => {
      this.emitEvent('subagent:token', payload);
    });
    this.subagentManager.on('subagent:tool', (payload) => {
      this.emitEvent('subagent:tool', payload);
    });
    this.subagentManager.on('subagent:completed', (payload) => {
      this.emitEvent('subagent:completed', payload);
    });
  }

  public getTaskState(sessionId?: string): TaskState | null {
    if (sessionId) {
      const task = this.tasksBySession.get(sessionId);
      return task ? { ...task.taskState } : null;
    }
    const lastSession = this.tasksBySession.get(this.lastActiveSessionId);
    if (lastSession) return { ...lastSession.taskState };
    const first = this.tasksBySession.values().next().value;
    return first ? { ...first.taskState } : null;
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
    await this.mcpManager.disconnectAll();
  }

  /**
   * Reset conversation session and context
   */
  public resetSession(sessionId?: string): void {
    if (sessionId) {
      this.cancelTask(sessionId);
      const sessionTask = this.tasksBySession.get(sessionId);
      if (sessionTask) {
        sessionTask.contextManager.clear();
        this.tasksBySession.delete(sessionId);
      }
    } else {
      this.cancelTask();
      for (const sessionTask of this.tasksBySession.values()) {
        sessionTask.contextManager.clear();
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
      contextWindow?: number;
    } = {},
  ): Promise<void> {
    const sessionId = options.sessionId || 'default';
    this.lastActiveSessionId = sessionId;

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

    const mode = options.mode ?? (sessionTask?.taskState.mode || 'code');
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

    // 0. Setup Git Worktree Isolation if enabled
    const shouldEnableWorktree =
      options.enableWorktree !== undefined
        ? options.enableWorktree
        : this.worktreeIsolationEnabled;
    let effectiveWorkspaceRoot = sessionWorkspaceRoot;
    let isWorktree = false;
    let worktreeBranch: string | undefined;

    if (shouldEnableWorktree) {
      const isGit = await this.gitCheckpointService.isGitRepo(sessionWorkspaceRoot);
      if (isGit) {
        try {
          const timeoutMs = options.worktreeTimeoutMs ?? this.worktreeTimeoutMs;
          const wt = await this.gitCheckpointService.createWorktree(
            sessionWorkspaceRoot,
            sessionId,
            undefined,
            { timeoutMs },
          );
          effectiveWorkspaceRoot = wt.worktreePath;
          isWorktree = true;
          worktreeBranch = wt.branch;
          this.emitEvent('worktree:status', {
            sessionId,
            isWorktree: true,
            worktreePath: wt.worktreePath,
            branch: wt.branch,
          });
        } catch (wtErr) {
          console.warn('[Engine] Failed to create worktree, falling back to main workspace:', wtErr);
        }
      }
    }

    const abortController = new AbortController();
    const taskId = sessionTask ? sessionTask.taskState.id : `task_${Date.now()}`;

    // 0.1 Setup Git Checkpoint Snapshot if enabled
    const shouldEnableCheckpoint =
      options.enableCheckpoint !== undefined
        ? options.enableCheckpoint
        : this.gitCheckpointEnabled;
    let checkpointId: string | undefined;

    if (shouldEnableCheckpoint) {
      try {
        const ckpt = await this.gitCheckpointService.createCheckpoint(sessionWorkspaceRoot, {
          sessionId,
          taskId,
          description: prompt.slice(0, 60),
          isWorktree,
          worktreeBranch,
          worktreePath: isWorktree ? effectiveWorkspaceRoot : undefined,
        });
        checkpointId = ckpt.id;
        this.emitEvent('checkpoint:created', { checkpoint: ckpt, sessionId });
      } catch (ckptErr) {
        console.warn('[Engine] Failed to create checkpoint:', ckptErr);
      }
    }

    if (!sessionTask) {
      sessionTask = {
        sessionId,
        workspaceRoot: effectiveWorkspaceRoot,
        mainWorkspaceRoot: sessionWorkspaceRoot,
        contextManager: new ContextManager(),
        abortController,
        pendingApproval: null,
        codeModified: false,
        autoTestRetries: 0,
        checkpointId,
        isWorktree,
        worktreeBranch,
        subagentsEnabled: effectiveSubagents,
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
          checkpointId,
          isWorktree,
          worktreeBranch,
          worktreePath: isWorktree ? effectiveWorkspaceRoot : undefined,
          messages: [],
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
      this.tasksBySession.set(sessionId, sessionTask);
    } else {
      sessionTask.workspaceRoot = effectiveWorkspaceRoot;
      sessionTask.mainWorkspaceRoot = sessionWorkspaceRoot;
      sessionTask.abortController = abortController;
      sessionTask.pendingApproval = null;
      sessionTask.codeModified = false;
      sessionTask.autoTestRetries = 0;
      sessionTask.checkpointId = checkpointId || sessionTask.checkpointId;
      sessionTask.isWorktree = isWorktree;
      sessionTask.worktreeBranch = worktreeBranch;
      sessionTask.subagentsEnabled = effectiveSubagents;
      sessionTask.autoTestConfig = {
        enabled: effectiveAutoTest,
        testCommand: effectiveTestCommand,
        maxRetries: effectiveMaxTestRetries,
      };
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

    // 0. Discover any custom workspace skills and parse .clinerules
    try {
      await this.skillRegistry.discoverWorkspaceSkills(sessionTask.workspaceRoot);
      await this.subagentManager.loadWorkspaceClinerules(sessionTask.workspaceRoot);
    } catch {
      // Safe to ignore skill/rules discovery failure
    }

    // 1. Append User Message to Context
    let userMessageContent = prompt;
    if (options.contextFiles && options.contextFiles.length > 0) {
      userMessageContent += `\n\n[Referenced files: ${options.contextFiles.join(', ')}]`;
    }

    const userMessage: ChatMessage = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: userMessageContent,
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
        anthropicOAuth: options.anthropicOAuth,
        openaiOAuth: options.openaiOAuth,
        openaiAccountId: options.openaiAccountId,
        workspaceRoot: sessionTask.workspaceRoot,
      });
    }

    // 3. Main Agent Loop
    try {
      await this.runLoop(sessionTask, provider);
    } catch (err: unknown) {
      if (sessionTask.abortController?.signal.aborted) {
        this.setStatus(sessionTask, 'cancelled');
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.setStatus(sessionTask, 'error');
        const parsedLimit = parseRateLimitError(errorMsg, model, provider.providerType);
        const errChatMsg: ChatMessage = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: parsedLimit.isRateLimit
            ? parsedLimit.formattedMessage
            : `❌ **執行發生錯誤**:\n\n${errorMsg}`,
          timestamp: Date.now(),
        };
        sessionTask.contextManager.addMessage(errChatMsg);

        if (parsedLimit.isRateLimit) {
          this.emitEvent('error', {
            code: 'RATE_LIMIT_ERROR',
            message: parsedLimit.formattedMessage,
            sessionId,
            taskId,
            details: parsedLimit,
          });
        } else {
          this.emitEvent('error', { code: 'TASK_ERROR', message: errorMsg, sessionId, taskId });
        }
      }
    } finally {
      sessionTask.abortController = null;
      sessionTask.pendingApproval = null;
      this.syncTaskState(sessionTask);
    }
  }

  /**
   * Core Agent Multi-turn execution loop
   */
  private async runLoop(sessionTask: SessionTask, provider: BaseLLMProvider): Promise<void> {
    const { sessionId } = sessionTask;

    while (
      sessionTask.taskState.currentTurn < sessionTask.taskState.maxTurns &&
      !sessionTask.abortController?.signal.aborted
    ) {
      sessionTask.taskState.currentTurn++;
      this.setStatus(sessionTask, 'thinking');

      // Build System Prompt with Skills + MCP tools + .clinerules
      const mcpDefinitions = this.mcpManager.getToolDefinitions();
      const defaultDefinitions = this.toolRegistry.getDefinitions();
      const subagentToolNames = new Set([
        'invoke_subagent',
        'send_message',
        'manage_subagents',
        'define_subagent',
      ]);
      const availableTools = sessionTask.subagentsEnabled === false
        ? defaultDefinitions.filter((t) => !subagentToolNames.has(t.name))
        : defaultDefinitions;
      const allDefinitions = [...availableTools, ...mcpDefinitions];

      let effectiveCustomInstructions = this.customInstructions;
      try {
        const rulesTarget = path.join(sessionTask.workspaceRoot, '.clinerules');
        const stats = await fs.stat(rulesTarget);
        if (stats.isDirectory()) {
          const files = await fs.readdir(rulesTarget);
          const mdFiles = files.filter((f) => f.endsWith('.md')).sort();
          const contents: string[] = [];
          for (const mdFile of mdFiles) {
            try {
              const fileContent = await fs.readFile(path.join(rulesTarget, mdFile), 'utf-8');
              if (fileContent.trim()) {
                contents.push(`=== .clinerules/${mdFile} ===\n${fileContent.trim()}`);
              }
            } catch {
              // ignore unreadable file
            }
          }
          if (contents.length > 0) {
            const combined = contents.join('\n\n');
            effectiveCustomInstructions = effectiveCustomInstructions
              ? `${effectiveCustomInstructions}\n\n${combined}`
              : combined;
          }
        } else {
          const rulesText = await fs.readFile(rulesTarget, 'utf-8');
          if (rulesText.trim()) {
            effectiveCustomInstructions = effectiveCustomInstructions
              ? `${effectiveCustomInstructions}\n\n${rulesText.trim()}`
              : rulesText.trim();
          }
        }
      } catch {
        // Safe to ignore if .clinerules does not exist
      }

      const systemPrompt = SystemPromptBuilder.build({
        workspaceRoot: sessionTask.workspaceRoot,
        mode: sessionTask.taskState.mode,
        customInstructions: effectiveCustomInstructions,
        tools: allDefinitions,
        skillsFormatted: this.skillRegistry.formatSkillsForPrompt(),
      });

      // Call LLM with streaming
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

      // Record Assistant message
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

      // If no tools were called, check Auto Test-Driven Repair before completing
      if (!result.toolCalls || result.toolCalls.length === 0) {
        if (sessionTask.codeModified && sessionTask.autoTestConfig.enabled !== false) {
          const testCmd = await AutoTestRunner.detectTestCommand(
            sessionTask.workspaceRoot,
            sessionTask.autoTestConfig.testCommand,
          );

          if (testCmd) {
            this.setStatus(sessionTask, 'testing');
            sessionTask.taskState.autoTestStatus = {
              running: true,
              command: testCmd,
              retries: sessionTask.autoTestRetries,
            };
            this.emitEvent('task:state', { ...sessionTask.taskState, sessionId });

            const testResult = await AutoTestRunner.runTest({
              command: testCmd,
              workspaceRoot: sessionTask.workspaceRoot,
              timeoutMs: sessionTask.autoTestConfig.timeoutMs,
              executeTerminalCommand: this.executeTerminalCommand,
              onData: (data) => {
                this.emitEvent('terminal:data', { data, sessionId });
              },
            });

            sessionTask.taskState.autoTestStatus = {
              running: false,
              command: testCmd,
              passed: testResult.passed,
              retries: sessionTask.autoTestRetries,
              durationMs: testResult.durationMs,
              lastError: testResult.passed ? undefined : testResult.output.slice(-1000),
            };

            this.emitEvent('test:result', {
              passed: testResult.passed,
              command: testCmd,
              output: testResult.output,
              exitCode: testResult.exitCode,
              sessionId,
              taskId: sessionTask.taskState.id,
              retries: sessionTask.autoTestRetries,
              durationMs: testResult.durationMs,
            });

            if (!testResult.passed) {
              const maxRetries = sessionTask.autoTestConfig.maxRetries ?? this.maxTestRetries;
              if (sessionTask.autoTestRetries < maxRetries) {
                sessionTask.autoTestRetries++;
                const failureObservation = AutoTestRunner.formatFailureObservation({
                  command: testCmd,
                  exitCode: testResult.exitCode,
                  rawOutput: testResult.output,
                  retries: sessionTask.autoTestRetries,
                  maxRetries,
                });

                const observationMsg: ChatMessage = {
                  id: `msg_obs_${Date.now()}`,
                  role: 'user',
                  content: failureObservation,
                  timestamp: Date.now(),
                };
                sessionTask.contextManager.addMessage(observationMsg);
                this.syncTaskState(sessionTask);

                // Re-enter loop to allow the agent to repair
                continue;
              } else {
                // Exceeded max retries: stop and report to user
                const limitMsg: ChatMessage = {
                  id: `msg_test_max_${Date.now()}`,
                  role: 'assistant',
                  content: `⚠️ **自動測試驅動修復已達重試上限 (${maxRetries} 次)**：經過多次修復嘗試，背景測試仍未通過。\n\n**最後測試指令**: \`${testCmd}\` (結束碼: ${testResult.exitCode})\n\n**錯誤摘要**:\n\`\`\`\n${AutoTestRunner.extractErrorStacktrace(testResult.output, 2000)}\n\`\`\`\n\n已停止自動重試，請檢視上方錯誤堆疊。`,
                  timestamp: Date.now(),
                };
                sessionTask.contextManager.addMessage(limitMsg);
                this.setStatus(sessionTask, 'completed');
                this.syncTaskState(sessionTask);
                break;
              }
            } else {
              // Test passed!
              sessionTask.codeModified = false;
              if (sessionTask.autoTestRetries > 0) {
                const passMsg: ChatMessage = {
                  id: `msg_test_passed_${Date.now()}`,
                  role: 'assistant',
                  content: `✅ **自動測試驅動修復成功**：背景測試全數通過！(\`${testCmd}\`)，共修復重試 ${sessionTask.autoTestRetries} 次。`,
                  timestamp: Date.now(),
                };
                sessionTask.contextManager.addMessage(passMsg);
              }
            }
          }
        }

        if (sessionTask.isWorktree) {
          this.emitEvent('worktree:status', {
            sessionId,
            isWorktree: true,
            worktreePath: sessionTask.workspaceRoot,
            branch: sessionTask.worktreeBranch,
          });
        }

        this.setStatus(sessionTask, 'completed');
        if (this.gitCheckpointEnabled) {
          const targetRoot = sessionTask.mainWorkspaceRoot || sessionTask.workspaceRoot;
          this.gitCheckpointService.pruneCheckpoints(targetRoot).catch(() => {});
        }
        break;
      }

      // Execute each tool call
      for (const toolCall of result.toolCalls) {
        if (sessionTask.abortController?.signal.aborted) break;

        const tool = this.toolRegistry.getTool(toolCall.name);
        const mcpTool = this.mcpManager.getTool(toolCall.name);
        const requiresApproval =
          (mcpTool?.requiresApproval ?? tool?.requiresApproval ?? false) && !this.autoApprove;

        let isApproved = true;
        let userFeedback: string | undefined;

        if (requiresApproval) {
          this.setStatus(sessionTask, 'waiting_approval');

          // Wait for interactive user approval via handleApproval()
          const approvalResult = await new Promise<{ approved: boolean; feedback?: string }>(
            (resolve) => {
              sessionTask.pendingApproval = {
                toolCallId: toolCall.id,
                resolve: (approved, feedback) => resolve({ approved, feedback }),
              };
            },
          );

          isApproved = approvalResult.approved;
          userFeedback = approvalResult.feedback;
          sessionTask.pendingApproval = null;
        }

        let toolResult: ToolResult;

        const subagentToolNames = new Set([
          'invoke_subagent',
          'send_message',
          'manage_subagents',
          'define_subagent',
        ]);
        if (sessionTask.subagentsEnabled === false && subagentToolNames.has(toolCall.name)) {
          toolResult = {
            toolCallId: toolCall.id,
            isError: true,
            output: `Subagent orchestration tool '${toolCall.name}' is disabled in settings. Please solve the task directly without spawning subagents.`,
            summary: `Disabled tool ${toolCall.name}`,
          };
        } else if (!isApproved) {
          toolResult = {
            toolCallId: toolCall.id,
            isError: true,
            output: `User rejected execution of tool '${toolCall.name}'. ${userFeedback ? `Feedback: ${userFeedback}` : ''}`,
            summary: `Rejected ${toolCall.name}`,
          };
        } else {
          this.setStatus(sessionTask, 'executing_tool');

          const execContext: ToolExecutionContext = {
            workspaceRoot: sessionTask.workspaceRoot,
            sessionId: sessionTask.sessionId,
            taskId: sessionTask.taskState.id,
            provider: sessionTask.taskState.provider,
            model: sessionTask.taskState.model,
            apiKey: provider.getApiKey() || this.apiKey,
            baseURL: provider.getBaseURL() || this.baseURL,
            subagentManager: this.subagentManager,
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
          };

          try {
            if (mcpTool) {
              // MCP-sourced tool: delegate to the MCP server manager.
              toolResult = await this.mcpManager.callTool(
                toolCall.name,
                toolCall.arguments as Record<string, unknown>,
              );
            } else {
              toolResult = await this.toolRegistry.executeTool(
                toolCall.name,
                toolCall.arguments,
                execContext,
              );
            }
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
          if (!toolResult.isError && (toolCall.name === 'write_to_file' || toolCall.name === 'replace_file_content')) {
            if (AutoTestRunner.isCodeFile(String(toolCall.arguments.path ?? ''))) sessionTask.codeModified = true; // Prose/asset edits (.md, .txt, images) never arm the auto test-driven repair loop
          }
        }

        // Emit tool result event
        this.emitEvent('tool:result', { ...toolResult, sessionId, taskId: sessionTask.taskState.id });

        // Cap single tool output to prevent context overflow (max 40,000 chars, approx 10k tokens)
        const MAX_TOOL_OUTPUT_CHARS = 40_000;
        let toolOutputStr =
          typeof toolResult.output === 'string'
            ? toolResult.output
            : JSON.stringify(toolResult.output);

        if (toolOutputStr.length > MAX_TOOL_OUTPUT_CHARS) {
          const truncatedSuffix =
            `\n\n...[工具輸出過長 (共 ${toolOutputStr.length.toLocaleString()} 字元)，Agent Core 已自動壓縮至安全長度以維護 Token 安全]...\n` +
            toolOutputStr.slice(-1000);
          toolOutputStr = toolOutputStr.slice(0, MAX_TOOL_OUTPUT_CHARS - 1500) + truncatedSuffix;
          if (typeof toolResult.output === 'string') {
            toolResult.output = toolOutputStr;
          }
        }

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
      this.setStatus(sessionTask, 'completed');
      this.syncTaskState(sessionTask);
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
      if (this.tasksBySession.has(targetSessionId)) {
        const task = this.tasksBySession.get(targetSessionId)!;
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

  private setStatus(sessionTask: SessionTask, status: AgentStatus): void {
    sessionTask.taskState.status = status;
    sessionTask.taskState.updatedAt = Date.now();
    this.emitEvent('task:status', {
      status,
      taskId: sessionTask.taskState.id,
      sessionId: sessionTask.sessionId,
    });
  }

  private syncTaskState(sessionTask: SessionTask): void {
    sessionTask.taskState.messages = sessionTask.contextManager.getMessages();
    sessionTask.taskState.tokenUsage = sessionTask.contextManager.getTokenUsage();
    sessionTask.taskState.updatedAt = Date.now();
    this.emitEvent('task:state', {
      ...sessionTask.taskState,
      sessionId: sessionTask.sessionId,
    });
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
