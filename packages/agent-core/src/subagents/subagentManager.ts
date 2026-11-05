import { EventEmitter } from 'node:events';
import type {
  LLMProviderType,
  SubagentDefinition,
  SubagentInstanceInfo,
  SubagentModelTier,
  ToolCallRequest,
} from '@harni/types';
import type { McpServerManager } from '../mcp/mcpServerManager.js';
import { ProviderFactory } from '../providers/providerFactory.js';
import type { SkillRegistry } from '../skills/skillRegistry.js';
import type { GitCheckpointService } from '../git/gitCheckpointService.js';
import { AskQuestionTool } from '../tools/askQuestion.js';
import { DefineSubagentTool } from '../tools/defineSubagent.js';
import { ExecuteCommandTool } from '../tools/executeCommand.js';
import { InvokeSubagentTool } from '../tools/invokeSubagent.js';
import { ListFilesTool } from '../tools/listFiles.js';
import { ManageSubagentsTool } from '../tools/manageSubagents.js';
import { ReadFileTool } from '../tools/readFile.js';
import { ReplaceFileContentTool } from '../tools/replaceFileContent.js';
import { SearchFilesTool } from '../tools/searchFiles.js';
import { SendMessageTool } from '../tools/sendMessage.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { UseSkillTool } from '../tools/useSkill.js';
import { WriteFileTool } from '../tools/writeFile.js';
import { SubagentInstance } from './subagentInstance.js';
import { SubagentRegistry } from './subagentRegistry.js';
import type {
  SpawnSubagentParams,
  SubagentExecutionResult,
} from './subagentTypes.js';

export interface SubagentManagerConfig {
  workspaceRoot: string;
  defaultProvider?: LLMProviderType;
  defaultModel?: string;
  apiKey?: string;
  baseURL?: string;
  maxDepth?: number;
  maxConcurrent?: number;
  maxRateLimitRetries?: number;
  rateLimitBaseDelayMs?: number;
  modelTierMap?: Partial<Record<SubagentModelTier, string>>;
  gitCheckpointService?: GitCheckpointService;
  mcpManager?: McpServerManager;
  skillRegistry?: SkillRegistry;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  requestToolApproval?: (
    sessionId: string,
    request: ToolCallRequest & { subagentId: string; subagentRole: string },
    signal?: AbortSignal,
  ) => Promise<{ approved: boolean; feedback?: string }>;
  askUserQuestion?: (
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
  ) => Promise<{ answers: string[]; customInput?: string }>;
}

export class SubagentManager extends EventEmitter {
  private registry: SubagentRegistry;
  private instances = new Map<string, SubagentInstance>();
  private executionPromises = new Map<string, Promise<SubagentExecutionResult>>();
  private workspaceRoot: string;
  private defaultProvider: LLMProviderType;
  private defaultModel?: string;
  private apiKey?: string;
  private baseURL?: string;
  private maxDepth: number;
  private maxConcurrent: number;
  private maxRateLimitRetries: number;
  private rateLimitBaseDelayMs: number;
  private activeCount = 0;
  private waitingQueue: Array<() => void> = [];
  private gitCheckpointService?: GitCheckpointService;
  private mcpManager?: McpServerManager;
  private skillRegistry?: SkillRegistry;
  private executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  private requestToolApproval?: (
    sessionId: string,
    request: ToolCallRequest & { subagentId: string; subagentRole: string },
    signal?: AbortSignal,
  ) => Promise<{ approved: boolean; feedback?: string }>;
  private askUserQuestion?: (
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
  ) => Promise<{ answers: string[]; customInput?: string }>;

  constructor(config: SubagentManagerConfig) {
    super();
    this.workspaceRoot = config.workspaceRoot;
    this.defaultProvider = config.defaultProvider ?? 'anthropic';
    this.defaultModel = config.defaultModel;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.maxDepth = config.maxDepth ?? 2;
    this.maxConcurrent = config.maxConcurrent ?? 3;
    this.maxRateLimitRetries = config.maxRateLimitRetries ?? 2;
    this.rateLimitBaseDelayMs = config.rateLimitBaseDelayMs ?? 1000;
    this.gitCheckpointService = config.gitCheckpointService;
    this.mcpManager = config.mcpManager;
    this.skillRegistry = config.skillRegistry;
    this.executeTerminalCommand = config.executeTerminalCommand;
    this.requestToolApproval = config.requestToolApproval;
    this.askUserQuestion = config.askUserQuestion;
    this.registry = new SubagentRegistry(true);
    if (config.modelTierMap) {
      this.registry.setModelTierMap(config.modelTierMap);
    }
  }

  public getRegistry(): SubagentRegistry {
    return this.registry;
  }

  public setModelTierMap(map: Partial<Record<SubagentModelTier, string>>): void {
    this.registry.setModelTierMap(map);
  }

  public getModelTierMap(): Partial<Record<SubagentModelTier, string>> {
    return this.registry.getModelTierMap();
  }

  public setWorkspaceRoot(newRoot: string): void {
    this.workspaceRoot = newRoot;
  }

  public setMaxConcurrent(max: number): void {
    if (max > 0) {
      this.maxConcurrent = max;
      this.processQueue();
    }
  }

  public getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  private async acquireConcurrencySlot(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const proceed = () => {
        if (settled) return;
        settled = true;
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        this.activeCount++;
        resolve(true);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        const idx = this.waitingQueue.indexOf(proceed);
        if (idx !== -1) {
          this.waitingQueue.splice(idx, 1);
        }
        signal?.removeEventListener('abort', onAbort);
        resolve(false);
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.waitingQueue.push(proceed);
    });
  }

  private releaseConcurrencySlot(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.processQueue();
  }

  private processQueue(): void {
    while (this.activeCount < this.maxConcurrent && this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift();
      if (next) {
        next();
      }
    }
  }

  public getInstance(id: string): SubagentInstance | undefined {
    return this.instances.get(id);
  }

  public getInstancesBySession(sessionId: string): SubagentInstanceInfo[] {
    const list: SubagentInstanceInfo[] = [];
    for (const inst of this.instances.values()) {
      if (inst.sessionId === sessionId) {
        list.push(inst.getInfo());
      }
    }
    return list;
  }

  public getAllInstances(): SubagentInstanceInfo[] {
    return Array.from(this.instances.values()).map((inst) => inst.getInfo());
  }

  public defineSubagent(definition: SubagentDefinition): void {
    this.registry.register(definition);
  }

  public async loadWorkspaceClinerules(workspaceRoot?: string): Promise<number> {
    const root = workspaceRoot || this.workspaceRoot;
    return await this.registry.loadFromWorkspace(root);
  }

  /**
   * Spawn and execute one or more subagents in parallel with concurrency limit
   */
  public async spawnSubagents(
    subagents: SpawnSubagentParams[],
  ): Promise<SubagentExecutionResult[]> {
    // 1. Create instances and emit subagent:spawned immediately so UI sees all pending subagents
    type CreatedItem =
      | { ok: true; instance: SubagentInstance; params: SpawnSubagentParams; subagentId: string }
      | { ok: false; error: Error; params: SpawnSubagentParams };

    const created: CreatedItem[] = subagents.map((params) => {
      const depth = params.depth ?? 1;
      if (depth > this.maxDepth) {
        return {
          ok: false,
          error: new Error(
            `Subagent depth limit exceeded (current depth: ${depth}, max depth: ${this.maxDepth}). Orchestration recursion stopped.`,
          ),
          params,
        };
      }

      let resolvedTypeName = params.typeName;
      let definition = this.registry.get(resolvedTypeName);

      if (!definition) {
        definition =
          this.registry.get('self') ||
          {
            name: resolvedTypeName,
            description: `Dynamic subagent ${resolvedTypeName}`,
            role: params.role,
            systemPrompt: `You are a specialized subagent for ${params.role}. Complete the assigned task.`,
            maxTurns: 15,
          };
      }

      const subagentId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const workspace = params.workspaceRoot || this.workspaceRoot;

      // Restrict tools based on definition
      const subagentToolRegistry = this.createScopedToolRegistry(definition);

      const effectiveProvider = params.provider || this.defaultProvider;
      const resolvedModel = this.registry.resolveModel({
        explicitModel: params.model,
        definition,
        provider: effectiveProvider,
        parentModel: params.parentModel || this.defaultModel,
      });

      // Create provider for subagent
      const provider =
        params.customProvider ||
        ProviderFactory.create(effectiveProvider, {
          apiKey: params.apiKey || this.apiKey,
          baseURL: params.baseURL || this.baseURL,
          model: resolvedModel,
          thinkingDepth: params.thinkingDepth,
          workspaceRoot: workspace,
          anthropicOAuth: params.anthropicOAuth,
          openaiOAuth: params.openaiOAuth,
          openaiAccountId: params.openaiAccountId,
        });

      const instance = new SubagentInstance({
        id: subagentId,
        parentId: params.parentId,
        sessionId: params.sessionId,
        depth,
        definition,
        role: params.role || definition.role || definition.name,
        prompt: params.prompt,
        model: resolvedModel,
        workspaceRoot: workspace,
        provider,
        toolRegistry: subagentToolRegistry,
        mcpManager: this.mcpManager,
        subagentManager: this,
        parentSignal: params.parentSignal,
        onFileDiff: params.onFileDiff,
        onDiagnostics: params.onDiagnostics,
        onTerminalData: params.onTerminalData,
        onCodeModified: params.onCodeModified,
        executeTerminalCommand: this.executeTerminalCommand,
        requestToolApproval: this.requestToolApproval,
        askUserQuestion: this.askUserQuestion,
        maxTokensBudget: params.maxTokensBudget ?? definition.maxTokensBudget,
        timeoutMs: params.timeoutMs ?? definition.timeoutMs,
        anthropicOAuth: params.anthropicOAuth,
        openaiOAuth: params.openaiOAuth,
        openaiAccountId: params.openaiAccountId,
        maxRateLimitRetries: this.maxRateLimitRetries,
        rateLimitBaseDelayMs: this.rateLimitBaseDelayMs,
      });

      this.instances.set(subagentId, instance);

      // Wire instance events to SubagentManager events
      instance.on('status', (payload) => {
        this.emit('subagent:status', {
          sessionId: params.sessionId,
          subagentId,
          status: payload.status,
          error: payload.error,
        });
      });

      instance.on('token', (payload) => {
        this.emit('subagent:token', {
          sessionId: params.sessionId,
          subagentId,
          text: payload.text,
          isThinking: payload.isThinking,
        });
      });

      instance.on('tool', (payload) => {
        this.emit('subagent:tool', {
          sessionId: params.sessionId,
          subagentId,
          toolName: payload.toolName,
          summary: payload.summary,
          status: payload.status,
        });
      });

      // Emit spawned event (initially in pending status)
      this.emit('subagent:spawned', {
        sessionId: params.sessionId,
        subagent: instance.getInfo(),
      });

      return { ok: true, instance, params, subagentId };
    });

    // 2. Map created instances to parallel execution promises regulated by concurrency semaphore
    const results: Promise<SubagentExecutionResult>[] = created.map((item) => {
      if (!item.ok) {
        return Promise.resolve({
          id: `failed_${Date.now()}`,
          typeName: item.params.typeName,
          role: item.params.role,
          status: 'error' as const,
          result: `Subagent failed to complete: ${item.error.message}`,
          error: item.error.message,
          durationMs: 0,
          toolCallCount: 0,
        });
      }

      const { instance, params, subagentId } = item;

      const execPromise = (async (): Promise<SubagentExecutionResult> => {
        // Check if already cancelled before acquiring semaphore slot
        if (instance.getStatus() === 'cancelled' || params.parentSignal?.aborted) {
          if (instance.getStatus() !== 'cancelled') {
            instance.abort('Parent task cancelled');
          }
          const cancelReason =
            params.parentSignal?.aborted ? 'Parent task cancelled' : (instance.getInfo().error || 'Subagent execution cancelled');
          const cancelledResult: SubagentExecutionResult = {
            id: subagentId,
            typeName: params.typeName,
            role: params.role,
            status: 'cancelled',
            result: cancelReason,
            error: cancelReason,
            durationMs: 0,
            toolCallCount: 0,
            background: params.background,
          };
          this.emit('subagent:completed', {
            sessionId: params.sessionId,
            subagentId,
            status: 'cancelled',
            result: cancelledResult.result,
            error: cancelledResult.error,
            durationMs: 0,
          });
          return cancelledResult;
        }

        // Hook abort listener to wake queue if parentSignal or instance aborts while in queue
        const queueAbort = new AbortController();
        const onParentAbort = () => queueAbort.abort();
        params.parentSignal?.addEventListener('abort', onParentAbort, { once: true });
        const onInstanceStatus = (p: { status: import('@harni/types').SubagentStatus }) => {
          if (p.status === 'cancelled') {
            queueAbort.abort();
          }
        };
        instance.on('status', onInstanceStatus);

        let slotAcquired = false;
        try {
          slotAcquired = await this.acquireConcurrencySlot(queueAbort.signal);
        } finally {
          params.parentSignal?.removeEventListener('abort', onParentAbort);
          instance.off('status', onInstanceStatus);
        }

        if (!slotAcquired || instance.getStatus() === 'cancelled' || params.parentSignal?.aborted) {
          if (slotAcquired) {
            this.releaseConcurrencySlot();
          }
          if (instance.getStatus() !== 'cancelled') {
            instance.abort(
              params.parentSignal?.aborted ? 'Parent task cancelled' : 'Subagent execution cancelled',
            );
          }
          const cancelReason =
            params.parentSignal?.aborted ? 'Parent task cancelled' : (instance.getInfo().error || 'Subagent execution cancelled');
          const cancelledResult: SubagentExecutionResult = {
            id: subagentId,
            typeName: params.typeName,
            role: params.role,
            status: 'cancelled',
            result: cancelReason,
            error: cancelReason,
            durationMs: 0,
            toolCallCount: 0,
            background: params.background,
          };
          this.emit('subagent:completed', {
            sessionId: params.sessionId,
            subagentId,
            status: 'cancelled',
            result: cancelledResult.result,
            error: cancelledResult.error,
            durationMs: 0,
          });
          return cancelledResult;
        }

        const baseWorkspace = params.workspaceRoot || this.workspaceRoot;
        let createdWorktree: { worktreePath: string; branch: string } | null = null;

        if (
          params.isolation === 'worktree' &&
          this.gitCheckpointService &&
          (await this.gitCheckpointService.isGitRepo(baseWorkspace))
        ) {
          try {
            const wt = await this.gitCheckpointService.createWorktree(baseWorkspace, subagentId);
            createdWorktree = wt;
            instance.setWorkspaceRoot(wt.worktreePath);
            instance.setWorktreeInfo(wt.worktreePath, wt.branch);
          } catch (wtErr) {
            console.warn(`[SubagentManager] Failed to create worktree for ${subagentId}:`, wtErr);
          }
        }

        try {
          // Run instance loop
          const result = await instance.run();

          if (createdWorktree) {
            result.worktreePath = createdWorktree.worktreePath;
            result.worktreeBranch = createdWorktree.branch;

            if (result.status === 'completed' && params.autoMergeWorktree !== false) {
              const mergeRes = await this.gitCheckpointService!.mergeWorktree(
                baseWorkspace,
                subagentId,
                `subagent(${params.role}): completed task ${subagentId}`,
              );
              result.worktreeMerged = mergeRes.success;
            } else if (result.status === 'cancelled' && params.autoMergeWorktree !== false) {
              await this.gitCheckpointService!.discardWorktree(baseWorkspace, subagentId);
            }
          }

          // Emit completed event
          this.emit('subagent:completed', {
            sessionId: params.sessionId,
            subagentId,
            status: result.status,
            result: result.result,
            error: result.error,
            durationMs: result.durationMs,
            tokenUsage: result.tokenUsage,
            codeModified: result.codeModified,
            structuredReport: result.structuredReport,
            worktreePath: result.worktreePath,
            worktreeBranch: result.worktreeBranch,
          });

          return result;
        } finally {
          this.releaseConcurrencySlot();
        }
      })();

      this.executionPromises.set(subagentId, execPromise);

      if (params.background === true) {
        return Promise.resolve({
          id: subagentId,
          typeName: params.typeName,
          role: params.role,
          status: instance.getStatus(),
          result: `Subagent ${subagentId} (${params.role}) started in background. Use manage_subagents action 'wait' to await completion.`,
          durationMs: 0,
          toolCallCount: 0,
          background: true,
        });
      }

      return execPromise;
    });

    const settled = await Promise.allSettled(results);
    return settled.map((s, index) => {
      if (s.status === 'fulfilled') {
        return s.value;
      }
      const param = subagents[index];
      return {
        id: `failed_${index}`,
        typeName: param.typeName,
        role: param.role,
        status: 'error',
        result: `Subagent failed to complete: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        durationMs: 0,
        toolCallCount: 0,
      };
    });
  }

  public async sendMessage(subagentId: string, message: string): Promise<string> {
    const instance = this.instances.get(subagentId);
    if (!instance) {
      throw new Error(`Subagent not found with ID: ${subagentId}`);
    }
    return await instance.receiveMessage(message);
  }

  public manageSubagents(
    action: 'list' | 'kill' | 'kill_all',
    subagentIds?: string[],
    sessionId?: string,
  ): SubagentInstanceInfo[] {
    if (action === 'list') {
      if (sessionId) {
        return this.getInstancesBySession(sessionId);
      }
      return this.getAllInstances();
    }

    if (action === 'kill') {
      const ids = subagentIds || [];
      const affected: SubagentInstanceInfo[] = [];
      for (const id of ids) {
        const inst = this.instances.get(id);
        if (inst) {
          inst.abort('Terminated by manage_subagents request');
          affected.push(inst.getInfo());
        }
      }
      return affected;
    }

    if (action === 'kill_all') {
      const affected: SubagentInstanceInfo[] = [];
      for (const inst of this.instances.values()) {
        if (!sessionId || inst.sessionId === sessionId) {
          inst.abort('Terminated by kill_all request');
          affected.push(inst.getInfo());
        }
      }
      return affected;
    }

    return [];
  }

  public killSubagent(subagentId: string, sessionId?: string): boolean {
    const affected = this.manageSubagents('kill', [subagentId], sessionId);
    return affected.length > 0;
  }

  public async waitForSubagent(subagentId: string): Promise<SubagentInstanceInfo | null> {
    const list = await this.waitForSubagents([subagentId]);
    return list[0] || null;
  }

  public async waitForSubagents(
    subagentIds?: string[],
    sessionId?: string,
  ): Promise<SubagentInstanceInfo[]> {
    let targetInstances: SubagentInstance[] = [];

    if (subagentIds && subagentIds.length > 0) {
      for (const id of subagentIds) {
        const inst = this.instances.get(id);
        if (inst) {
          targetInstances.push(inst);
        }
      }
    } else {
      for (const inst of this.instances.values()) {
        if (!sessionId || inst.sessionId === sessionId) {
          const status = inst.getStatus();
          if (
            status === 'pending' ||
            status === 'running' ||
            status === 'waiting_for_input'
          ) {
            targetInstances.push(inst);
          }
        }
      }
    }

    await Promise.allSettled(
      targetInstances.map(async (inst) => {
        const execPromise = this.executionPromises.get(inst.id);
        if (execPromise) {
          try {
            await execPromise;
          } catch {
            // ignore error since instance.getInfo() captures state
          }
        } else {
          await inst.waitForCompletion();
        }
      }),
    );

    return targetInstances.map((inst) => inst.getInfo());
  }

  public clearSessionSubagents(sessionId?: string): void {
    for (const [id, inst] of this.instances.entries()) {
      if (!sessionId || inst.sessionId === sessionId) {
        inst.abort('Session cleared');
        this.instances.delete(id);
        this.executionPromises.delete(id);
      }
    }
  }

  public abortSessionSubagents(sessionId: string): void {
    for (const inst of this.instances.values()) {
      if (inst.sessionId === sessionId) {
        inst.abort('Session aborted');
      }
    }
  }

  private createScopedToolRegistry(definition: SubagentDefinition): ToolRegistry {
    const scopedRegistry = new ToolRegistry(false);

    const allowed = definition.allowedTools
      ? new Set(definition.allowedTools.map((t: string) => t.toLowerCase()))
      : null;

    // Ask question
    if (!allowed || allowed.has('ask_question')) {
      scopedRegistry.register(new AskQuestionTool());
    }

    // Read tools
    if (!allowed || allowed.has('read_file')) {
      scopedRegistry.register(new ReadFileTool());
    }
    if (!allowed || allowed.has('list_files')) {
      scopedRegistry.register(new ListFilesTool());
    }
    if (!allowed || allowed.has('search_files')) {
      scopedRegistry.register(new SearchFilesTool());
    }

    // Write tools
    const allowWrite = definition.enableWriteTools ?? (allowed ? allowed.has('write_to_file') : true);
    if (allowWrite) {
      if (!allowed || allowed.has('write_to_file')) {
        scopedRegistry.register(new WriteFileTool());
      }
      if (!allowed || allowed.has('replace_file_content')) {
        scopedRegistry.register(new ReplaceFileContentTool());
      }
    }

    // Command execution
    if (!allowed || allowed.has('execute_command')) {
      scopedRegistry.register(new ExecuteCommandTool());
    }

    // Subagent orchestration tools
    if (definition.enableSubagentTools) {
      scopedRegistry.register(new InvokeSubagentTool());
      scopedRegistry.register(new SendMessageTool());
      scopedRegistry.register(new ManageSubagentsTool());
      scopedRegistry.register(new DefineSubagentTool());
    }

    // Skills integration
    if (this.skillRegistry && (!allowed || allowed.has('use_skill'))) {
      scopedRegistry.register(new UseSkillTool(this.skillRegistry));
    }

    return scopedRegistry;
  }
}
