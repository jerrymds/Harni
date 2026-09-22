import { EventEmitter } from 'node:events';
import type {
  ChatMessage,
  SubagentDefinition,
  SubagentInstanceInfo,
  SubagentStatus,
  ToolResult,
} from '@harni/types';
import { ContextManager } from '../context/contextManager.js';
import { SystemPromptBuilder } from '../prompts/systemPrompt.js';
import type { BaseLLMProvider } from '../providers/baseProvider.js';
import type { ToolExecutionContext } from '../tools/baseTool.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import type { SubagentExecutionResult } from './subagentTypes.js';

export interface SubagentInstanceOptions {
  id: string;
  parentId: string;
  sessionId: string;
  depth: number;
  definition: SubagentDefinition;
  role: string;
  prompt: string;
  model?: string;
  workspaceRoot: string;
  provider: BaseLLMProvider;
  toolRegistry: ToolRegistry;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
}

export class SubagentInstance extends EventEmitter {
  public readonly id: string;
  public readonly parentId: string;
  public readonly sessionId: string;
  public readonly depth: number;
  public readonly definition: SubagentDefinition;
  public readonly role: string;
  public readonly prompt: string;
  public readonly model?: string;
  public readonly workspaceRoot: string;

  private provider: BaseLLMProvider;
  private toolRegistry: ToolRegistry;
  private contextManager: ContextManager;
  private abortController: AbortController | null = null;
  private executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;

  private status: SubagentStatus = 'pending';
  private result?: string;
  private error?: string;
  private toolCallCount = 0;
  private createdAt = Date.now();
  private updatedAt = Date.now();
  private completedAt?: number;
  private isLoopRunning = false;

  constructor(options: SubagentInstanceOptions) {
    super();
    this.id = options.id;
    this.parentId = options.parentId;
    this.sessionId = options.sessionId;
    this.depth = options.depth;
    this.definition = options.definition;
    this.role = options.role;
    this.prompt = options.prompt;
    this.model = options.model;
    this.workspaceRoot = options.workspaceRoot;
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.executeTerminalCommand = options.executeTerminalCommand;
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
    };
  }

  public getStatus(): SubagentStatus {
    return this.status;
  }

  public getMessages(): ChatMessage[] {
    return this.contextManager.getMessages();
  }

  public abort(reason?: string): void {
    if (this.status === 'completed' || this.status === 'cancelled' || this.status === 'error') {
      return;
    }
    this.status = 'cancelled';
    this.error = reason || 'Subagent execution cancelled';
    this.updatedAt = Date.now();
    this.completedAt = Date.now();
    this.abortController?.abort();
    this.emit('status', { status: this.status, error: this.error });
  }

  public async run(): Promise<SubagentExecutionResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    this.setStatus('running');

    // Add initial prompt to isolated context
    const initialUserMessage: ChatMessage = {
      id: `sub_msg_${Date.now()}`,
      role: 'user',
      content: this.prompt,
      timestamp: Date.now(),
    };
    this.contextManager.addMessage(initialUserMessage);

    const maxTurns = this.definition.maxTurns ?? 15;
    let turn = 0;
    this.isLoopRunning = true;

    try {
      while (turn < maxTurns && !this.abortController?.signal.aborted) {
        turn++;

        const toolDefs = this.toolRegistry.getDefinitions();
        const baseSystemPrompt = this.definition.systemPrompt;
        const systemPrompt = SystemPromptBuilder.build({
          workspaceRoot: this.workspaceRoot,
          mode: 'custom',
          customInstructions: `${baseSystemPrompt}\n\n[Role]: ${this.role}\n[Subagent Depth]: ${this.depth}`,
          tools: toolDefs,
        });

        const result = await this.provider.streamCompletion(
          this.contextManager.getMessages(),
          systemPrompt,
          toolDefs,
          (chunk) => {
            if (this.abortController?.signal.aborted) return;
            if (chunk.type === 'token') {
              this.emit('token', { text: chunk.content, isThinking: false });
            } else if (chunk.type === 'thinking') {
              this.emit('token', { text: chunk.thought, isThinking: true });
            } else if (chunk.type === 'tool_call') {
              this.emit('tool', {
                toolName: chunk.name,
                summary: `Subagent called ${chunk.name}`,
                status: 'start',
              });
            }
          },
          this.abortController?.signal,
        );

        const assistantMessage: ChatMessage = {
          id: `sub_asst_${Date.now()}`,
          role: 'assistant',
          content: result.text,
          thinking: result.thinking,
          toolCalls: result.toolCalls,
          timestamp: Date.now(),
        };
        this.contextManager.addMessage(assistantMessage);

        if (!result.toolCalls || result.toolCalls.length === 0) {
          // Finished execution
          this.result = result.text || 'Task completed successfully.';
          this.setStatus('completed');
          break;
        }

        // Execute tool calls
        for (const toolCall of result.toolCalls) {
          if (this.abortController?.signal.aborted) break;
          this.toolCallCount++;

          const execContext: ToolExecutionContext = {
            workspaceRoot: this.workspaceRoot,
            executeTerminalCommand: this.executeTerminalCommand,
          };

          let toolResult: ToolResult;
          try {
            toolResult = await this.toolRegistry.executeTool(
              toolCall.name,
              toolCall.arguments,
              execContext,
            );
            this.emit('tool', {
              toolName: toolCall.name,
              summary: toolResult.summary || `Finished ${toolCall.name}`,
              status: toolResult.isError ? 'error' : 'complete',
            });
          } catch (err: unknown) {
            const errStr = err instanceof Error ? err.message : String(err);
            toolResult = {
              toolCallId: toolCall.id,
              isError: true,
              output: `Subagent tool error (${toolCall.name}): ${errStr}`,
              summary: `Failed ${toolCall.name}`,
            };
            this.emit('tool', {
              toolName: toolCall.name,
              summary: `Error: ${errStr}`,
              status: 'error',
            });
          }

          toolResult.toolCallId = toolCall.id;

          const toolMsg: ChatMessage = {
            id: `sub_tool_${Date.now()}`,
            role: 'tool',
            name: toolCall.name,
            content:
              typeof toolResult.output === 'string'
                ? toolResult.output
                : JSON.stringify(toolResult.output),
            toolCallId: toolCall.id,
            toolResult,
            timestamp: Date.now(),
          };
          this.contextManager.addMessage(toolMsg);
        }
      }

      if (turn >= maxTurns && this.status !== 'completed') {
        const msgs = this.contextManager.getMessages();
        this.result =
          msgs[msgs.length - 1]?.content ||
          `Subagent reached maximum turn limit (${maxTurns}).`;
        this.setStatus('completed');
      }
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
      result: this.result || this.error || 'Subagent execution finished.',
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
      id: `sub_msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    this.contextManager.addMessage(userMessage);

    if (!this.isLoopRunning) {
      const res = await this.run();
      return res.result;
    }

    return 'Message delivered to running subagent.';
  }

  private setStatus(newStatus: SubagentStatus): void {
    this.status = newStatus;
    this.updatedAt = Date.now();
    this.emit('status', { status: newStatus, error: this.error });
  }
}
