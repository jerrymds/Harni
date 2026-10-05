import { EventEmitter } from 'node:events';
import type {
  ChatMessage,
  SubagentDefinition,
  SubagentInstanceInfo,
  SubagentStatus,
} from '@harni/types';
import { ContextManager } from '../../context/contextManager.js';
import type { SubagentExecutionResult } from '../subagentTypes.js';
import { AgyProcessRunner, type AgyUsageInfo } from './agyProcessRunner.js';

export interface AgySubagentInstanceOptions {
  id: string;
  parentId: string;
  sessionId: string;
  depth: number;
  definition: SubagentDefinition;
  role: string;
  prompt: string;
  model?: string;
  workspaceRoot: string;
  conversationId?: string;
  binaryPath?: string;
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
}

export class AgySubagentInstance extends EventEmitter {
  public readonly id: string;
  public readonly parentId: string;
  public readonly sessionId: string;
  public readonly depth: number;
  public readonly definition: SubagentDefinition;
  public readonly role: string;
  public readonly prompt: string;
  public readonly model?: string;
  public readonly workspaceRoot: string;
  public readonly runnerType = 'agy';

  private conversationId?: string;
  private binaryPath?: string;
  private effort?: 'low' | 'medium' | 'high';
  private timeoutMs?: number;

  private contextManager: ContextManager;
  private abortController: AbortController | null = null;

  private status: SubagentStatus = 'pending';
  private result?: string;
  private error?: string;
  private toolCallCount = 0;
  private currentToolSummary?: string;
  private createdAt = Date.now();
  private updatedAt = Date.now();
  private completedAt?: number;
  private isLoopRunning = false;
  private lastUsage?: AgyUsageInfo;

  constructor(options: AgySubagentInstanceOptions) {
    super();
    this.id = options.id;
    this.parentId = options.parentId;
    this.sessionId = options.sessionId;
    this.depth = options.depth;
    this.definition = options.definition;
    this.role = options.role;
    this.prompt = options.prompt;
    this.model = options.model || options.definition.model;
    this.workspaceRoot = options.workspaceRoot;
    this.conversationId = options.conversationId;
    this.binaryPath = options.binaryPath || options.definition.agyOptions?.binaryPath;
    this.effort = options.effort || options.definition.agyOptions?.effort;
    this.timeoutMs = options.timeoutMs || options.definition.agyOptions?.timeoutMs;
    this.contextManager = new ContextManager();
  }

  public getInfo(): SubagentInstanceInfo {
    return {
      id: this.id,
      parentId: this.parentId,
      sessionId: this.sessionId,
      typeName: this.definition.name,
      role: this.role,
      prompt: this.prompt,
      status: this.status,
      model: this.model,
      depth: this.depth,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      completedAt: this.completedAt,
      result: this.result,
      error: this.error,
      toolCallCount: this.toolCallCount,
      runnerType: 'agy',
      conversationId: this.conversationId,
      currentToolSummary: this.currentToolSummary,
    };
  }

  public getStatus(): SubagentStatus {
    return this.status;
  }

  public getConversationId(): string | undefined {
    return this.conversationId;
  }

  public getLastUsage(): AgyUsageInfo | undefined {
    return this.lastUsage;
  }

  public getMessages(): ChatMessage[] {
    return this.contextManager.getMessages();
  }

  public abort(reason?: string): void {
    if (this.status === 'completed' || this.status === 'cancelled' || this.status === 'error') {
      return;
    }
    this.status = 'cancelled';
    this.error = reason || 'Agy Subagent execution cancelled';
    this.updatedAt = Date.now();
    this.completedAt = Date.now();
    this.abortController?.abort();
    this.emit('status', { status: this.status, error: this.error });
  }

  public async run(): Promise<SubagentExecutionResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    this.setStatus('running');

    // Add prompt message to context
    const initialUserMessage: ChatMessage = {
      id: `agy_msg_${Date.now()}`,
      role: 'user',
      content: this.prompt,
      timestamp: Date.now(),
    };
    this.contextManager.addMessage(initialUserMessage);

    this.isLoopRunning = true;

    try {
      // Build effective prompt, including system instructions from definition if provided
      let effectivePrompt = this.prompt;
      if (this.definition.systemPrompt && !this.conversationId) {
        effectivePrompt = `[System Instructions]\n${this.definition.systemPrompt}\n[Role]: ${this.role}\n\n[Task]\n${this.prompt}`;
      }

      const runnerResult = await AgyProcessRunner.run({
        binaryPath: this.binaryPath,
        prompt: effectivePrompt,
        workspaceRoot: this.workspaceRoot,
        conversationId: this.conversationId,
        model: this.model,
        effort: this.effort,
        mode: this.definition.agyOptions?.mode || 'accept-edits',
        dangerouslySkipPermissions:
          this.definition.agyOptions?.dangerouslySkipPermissions !== false,
        timeoutMs: this.timeoutMs,
        signal: this.abortController.signal,
        onInit: (initData) => {
          if (initData.conversationId) {
            this.conversationId = initData.conversationId;
          }
        },
        onToken: (text, isThinking) => {
          this.emit('token', { text, isThinking: !!isThinking });
        },
        onTool: ({ toolName, summary, status }) => {
          if (status === 'start') {
            this.toolCallCount++;
            this.currentToolSummary = summary;
          } else {
            this.currentToolSummary = undefined;
          }
          this.emit('tool', { toolName, summary, status });
        },
      });

      if (runnerResult.conversationId) {
        this.conversationId = runnerResult.conversationId;
      }
      if (runnerResult.usage) {
        this.lastUsage = runnerResult.usage;
      }

      if (runnerResult.status === 'CANCELLED') {
        this.setStatus('cancelled');
        this.result = runnerResult.response;
        this.error = 'Subagent execution cancelled';
      } else if (runnerResult.status === 'ERROR') {
        this.setStatus('error');
        this.error = runnerResult.error || 'Agy process execution failed';
        this.result = runnerResult.response;
      } else {
        this.result = runnerResult.response || 'Task completed successfully.';
        this.setStatus('completed');
      }

      const assistantMessage: ChatMessage = {
        id: `agy_asst_${Date.now()}`,
        role: 'assistant',
        content: this.result || '',
        timestamp: Date.now(),
      };
      this.contextManager.addMessage(assistantMessage);
    } catch (err: unknown) {
      if (this.abortController?.signal.aborted) {
        this.setStatus('cancelled');
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.error = errorMsg;
        this.setStatus('error');
      }
    } finally {
      this.isLoopRunning = false;
      this.abortController = null;
      this.completedAt = Date.now();
    }

    const durationMs = Date.now() - startTime;
    return {
      id: this.id,
      typeName: this.definition.name,
      role: this.role,
      status: this.status,
      result: this.result || this.error || 'Agy subagent execution finished.',
      error: this.error,
      durationMs,
      toolCallCount: this.toolCallCount,
    };
  }

  public async receiveMessage(content: string): Promise<string> {
    if (this.status === 'cancelled') {
      throw new Error(`Cannot send message to cancelled subagent (${this.id})`);
    }

    const userMessage: ChatMessage = {
      id: `agy_msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    this.contextManager.addMessage(userMessage);

    if (this.isLoopRunning) {
      return 'Message delivered to running agy subagent.';
    }

    // Run next turn with existing conversationId
    this.abortController = new AbortController();
    this.setStatus('running');

    try {
      const runnerResult = await AgyProcessRunner.run({
        binaryPath: this.binaryPath,
        prompt: content,
        workspaceRoot: this.workspaceRoot,
        conversationId: this.conversationId,
        model: this.model,
        effort: this.effort,
        mode: this.definition.agyOptions?.mode || 'accept-edits',
        dangerouslySkipPermissions:
          this.definition.agyOptions?.dangerouslySkipPermissions !== false,
        timeoutMs: this.timeoutMs,
        signal: this.abortController.signal,
        onToken: (text, isThinking) => {
          this.emit('token', { text, isThinking: !!isThinking });
        },
        onTool: ({ toolName, summary, status }) => {
          if (status === 'start') {
            this.toolCallCount++;
            this.currentToolSummary = summary;
          } else {
            this.currentToolSummary = undefined;
          }
          this.emit('tool', { toolName, summary, status });
        },
      });

      if (runnerResult.conversationId) {
        this.conversationId = runnerResult.conversationId;
      }
      if (runnerResult.usage) {
        this.lastUsage = runnerResult.usage;
      }

      this.result = runnerResult.response;
      this.setStatus(runnerResult.status === 'SUCCESS' ? 'completed' : 'error');

      const asstMsg: ChatMessage = {
        id: `agy_asst_${Date.now()}`,
        role: 'assistant',
        content: this.result || '',
        timestamp: Date.now(),
      };
      this.contextManager.addMessage(asstMsg);

      return this.result || 'Turn finished.';
    } finally {
      this.isLoopRunning = false;
      this.abortController = null;
    }
  }

  private setStatus(newStatus: SubagentStatus): void {
    this.status = newStatus;
    this.updatedAt = Date.now();
    this.emit('status', { status: newStatus, error: this.error });
  }
}
