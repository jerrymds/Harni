import { EventEmitter } from 'node:events';
import type {
  LLMProviderType,
  SubagentDefinition,
  SubagentInstanceInfo,
} from '@harni/types';
import { ProviderFactory } from '../providers/providerFactory.js';
import { ExecuteCommandTool } from '../tools/executeCommand.js';
import { ListFilesTool } from '../tools/listFiles.js';
import { ReadFileTool } from '../tools/readFile.js';
import { ReplaceFileContentTool } from '../tools/replaceFileContent.js';
import { SearchFilesTool } from '../tools/searchFiles.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { WriteFileTool } from '../tools/writeFile.js';
import { AgySubagentInstance } from './runners/agySubagentInstance.js';
import { SubagentInstance } from './subagentInstance.js';
import { SubagentRegistry } from './subagentRegistry.js';
import type {
  SpawnSubagentParams,
  SubagentExecutionResult,
} from './subagentTypes.js';

export type SupportedSubagentInstance = SubagentInstance | AgySubagentInstance;

export interface SubagentManagerConfig {
  workspaceRoot: string;
  defaultProvider?: LLMProviderType;
  defaultModel?: string;
  apiKey?: string;
  baseURL?: string;
  maxDepth?: number;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
}

export class SubagentManager extends EventEmitter {
  private registry: SubagentRegistry;
  private instances = new Map<string, SupportedSubagentInstance>();
  private workspaceRoot: string;
  private defaultProvider: LLMProviderType;
  private defaultModel?: string;
  private apiKey?: string;
  private baseURL?: string;
  private maxDepth: number;
  private executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;

  constructor(config: SubagentManagerConfig) {
    super();
    this.workspaceRoot = config.workspaceRoot;
    this.defaultProvider = config.defaultProvider ?? 'anthropic';
    this.defaultModel = config.defaultModel;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.maxDepth = config.maxDepth ?? 2;
    this.executeTerminalCommand = config.executeTerminalCommand;
    this.registry = new SubagentRegistry(true);
  }

  public getRegistry(): SubagentRegistry {
    return this.registry;
  }

  public setWorkspaceRoot(newRoot: string): void {
    this.workspaceRoot = newRoot;
  }

  public getInstance(id: string): SupportedSubagentInstance | undefined {
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
   * Spawn and execute one or more subagents in parallel
   */
  public async spawnSubagents(
    subagents: SpawnSubagentParams[],
  ): Promise<SubagentExecutionResult[]> {
    const promises = subagents.map(async (params) => {
      const depth = params.depth ?? 1;
      if (depth > this.maxDepth) {
        throw new Error(
          `Subagent depth limit exceeded (current depth: ${depth}, max depth: ${this.maxDepth}). Orchestration recursion stopped.`,
        );
      }

      let resolvedTypeName = params.typeName;
      let definition = this.registry.get(resolvedTypeName);

      // Smart Fallback:
      // If the archetype is an internal runner archetype (e.g. 'researcher', 'coder', 'reviewer'),
      // but effective provider is 'antigravity', OR there is no Anthropic API key available:
      // automatically route to the corresponding agy archetype ('agy-researcher', 'agy-worker', 'agy-tester')
      const effectiveProvider = params.provider || this.defaultProvider;
      const hasAnthropicKey = Boolean(params.apiKey || this.apiKey || process.env.ANTHROPIC_API_KEY);

      if (
        !params.customProvider &&
        definition &&
        (!definition.runnerType || definition.runnerType === 'internal') &&
        (effectiveProvider === 'antigravity' || (!hasAnthropicKey && effectiveProvider === 'anthropic'))
      ) {
        const lower = resolvedTypeName.toLowerCase();
        if (lower === 'researcher' && this.registry.has('agy-researcher')) {
          resolvedTypeName = 'agy-researcher';
          definition = this.registry.get('agy-researcher');
        } else if (lower === 'coder' && this.registry.has('agy-worker')) {
          resolvedTypeName = 'agy-worker';
          definition = this.registry.get('agy-worker');
        } else if (lower === 'reviewer' && this.registry.has('agy-tester')) {
          resolvedTypeName = 'agy-tester';
          definition = this.registry.get('agy-tester');
        }
      }

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
      const runnerType = params.runnerType || definition.runnerType || 'internal';

      let instance: SupportedSubagentInstance;

      if (runnerType === 'agy') {
        instance = new AgySubagentInstance({
          id: subagentId,
          parentId: params.parentId,
          sessionId: params.sessionId,
          depth,
          definition,
          role: params.role || definition.role || definition.name,
          prompt: params.prompt,
          model: params.model || definition.model || this.defaultModel,
          workspaceRoot: workspace,
          conversationId: params.conversationId,
          binaryPath: params.agyOptions?.binaryPath,
          effort: params.agyOptions?.effort,
          timeoutMs: params.agyOptions?.timeoutMs,
        });
      } else {
        // Restrict tools based on definition
        const subagentToolRegistry = this.createScopedToolRegistry(definition);

        // Create provider for subagent
        const provider =
          params.customProvider ||
          ProviderFactory.create(params.provider || this.defaultProvider, {
            apiKey: params.apiKey || this.apiKey,
            baseURL: params.baseURL || this.baseURL,
            model: params.model || definition.model || this.defaultModel,
            thinkingDepth: params.thinkingDepth,
            workspaceRoot: workspace,
          });

        instance = new SubagentInstance({
          id: subagentId,
          parentId: params.parentId,
          sessionId: params.sessionId,
          depth,
          definition,
          role: params.role || definition.role || definition.name,
          prompt: params.prompt,
          model: params.model || definition.model || this.defaultModel,
          workspaceRoot: workspace,
          provider,
          toolRegistry: subagentToolRegistry,
          executeTerminalCommand: this.executeTerminalCommand,
        });
      }

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

      // Emit spawned event
      this.emit('subagent:spawned', {
        sessionId: params.sessionId,
        subagent: instance.getInfo(),
      });

      // Run instance loop
      const result = await instance.run();

      // Emit completed event
      this.emit('subagent:completed', {
        sessionId: params.sessionId,
        subagentId,
        result: result.result,
        durationMs: result.durationMs,
      });

      return result;
    });

    const settled = await Promise.allSettled(promises);
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

    return scopedRegistry;
  }
}
