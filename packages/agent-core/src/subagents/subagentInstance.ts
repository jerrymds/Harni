import { EventEmitter } from 'node:events';
import type {
  ChatMessage,
  FileDiagnosticsResult,
  FileDiff,
  SubagentDefinition,
  SubagentInstanceInfo,
  SubagentStatus,
  SubagentStructuredReport,
  TokenUsage,
  ToolCallRequest,
  ToolResult,
} from '@harni/types';
import { ContextManager } from '../context/contextManager.js';
import { SystemPromptBuilder } from '../prompts/systemPrompt.js';
import type {
  BaseLLMProvider,
  ProviderCompletionResult,
  StreamChunk,
} from '../providers/baseProvider.js';
import { AutoTestRunner } from '../testing/autoTestRunner.js';
import type { ToolExecutionContext } from '../tools/baseTool.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import type { McpServerManager } from '../mcp/mcpServerManager.js';
import { isRateLimitError } from '../utils/rateLimit.js';
import type { SubagentManager } from './subagentManager.js';
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
  mcpManager?: McpServerManager;
  subagentManager?: SubagentManager;
  parentSignal?: AbortSignal;
  onFileDiff?: (diff: FileDiff) => void;
  onDiagnostics?: (data: FileDiagnosticsResult) => void;
  onTerminalData?: (data: string) => void;
  onCodeModified?: () => void;
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
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  openaiAccountId?: string;
  maxRateLimitRetries?: number;
  rateLimitBaseDelayMs?: number;
  maxTokensBudget?: number;
  timeoutMs?: number;
  worktreePath?: string;
  worktreeBranch?: string;
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

export class SubagentInstance extends EventEmitter {
  public readonly id: string;
  public readonly parentId: string;
  public readonly sessionId: string;
  public readonly depth: number;
  public readonly definition: SubagentDefinition;
  public readonly role: string;
  public readonly prompt: string;
  public readonly model?: string;
  public workspaceRoot: string;

  private worktreePath?: string;
  private worktreeBranch?: string;

  private provider: BaseLLMProvider;
  private toolRegistry: ToolRegistry;
  private contextManager: ContextManager;
  private mcpManager?: McpServerManager;
  private subagentManager?: SubagentManager;
  private parentSignal?: AbortSignal;
  private onFileDiff?: (diff: FileDiff) => void;
  private onDiagnostics?: (data: FileDiagnosticsResult) => void;
  private onTerminalData?: (data: string) => void;
  private onCodeModified?: () => void;
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
  private anthropicOAuth?: boolean;
  private openaiOAuth?: boolean;
  private openaiAccountId?: string;
  private maxRateLimitRetries: number;
  private rateLimitBaseDelayMs: number;
  private maxTokensBudget?: number;
  private timeoutMs?: number;
  private structuredReport?: SubagentStructuredReport;
  private completionPromise: Promise<SubagentExecutionResult> | null = null;

  private abortController: AbortController | null = null;
  private currentToolSummary?: string;
  private codeModified = false;
  private reportedUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  private hasReportedUsage = false;

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
    this.mcpManager = options.mcpManager;
    this.subagentManager = options.subagentManager;
    this.parentSignal = options.parentSignal;
    this.onFileDiff = options.onFileDiff;
    this.onDiagnostics = options.onDiagnostics;
    this.onTerminalData = options.onTerminalData;
    this.onCodeModified = options.onCodeModified;
    this.executeTerminalCommand = options.executeTerminalCommand;
    this.requestToolApproval = options.requestToolApproval;
    this.anthropicOAuth = options.anthropicOAuth;
    this.openaiOAuth = options.openaiOAuth;
    this.openaiAccountId = options.openaiAccountId;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 2;
    this.rateLimitBaseDelayMs = options.rateLimitBaseDelayMs ?? 1000;
    this.maxTokensBudget = options.maxTokensBudget ?? options.definition.maxTokensBudget;
    this.timeoutMs = options.timeoutMs ?? options.definition.timeoutMs;
    this.worktreePath = options.worktreePath;
    this.worktreeBranch = options.worktreeBranch;
    this.askUserQuestion = options.askUserQuestion;
    this.contextManager = new ContextManager({
      maxContextTokens: 80000,
      slidingWindowTurnLimit: 20,
    });
  }

  public static parseStructuredReport(text?: string): SubagentStructuredReport | undefined {
    if (!text || typeof text !== 'string') return undefined;

    const sectionRegex = /^#{1,4}\s+(.+)$/gm;
    const matches: Array<{ title: string; index: number; length: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = sectionRegex.exec(text)) !== null) {
      matches.push({
        title: match[1].trim(),
        index: match.index,
        length: match[0].length,
      });
    }

    if (matches.length === 0) {
      return undefined;
    }

    const sections: Record<string, string> = {};
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const start = current.index + current.length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      sections[current.title.toLowerCase()] = text.slice(start, end).trim();
    }

    const parseBullets = (content?: string): string[] | undefined => {
      if (!content) return undefined;
      const items: string[] = [];
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s+/.test(trimmed)) {
          const cleaned = trimmed
            .replace(/^[-*]\s+|\d+\.\s+/, '')
            .replace(/`/g, '')
            .trim();
          if (cleaned) {
            items.push(cleaned);
          }
        }
      }
      return items.length > 0 ? items : undefined;
    };

    const findSectionContent = (keywords: string[]): string | undefined => {
      for (const [title, content] of Object.entries(sections)) {
        if (keywords.some((kw) => title.includes(kw))) {
          return content;
        }
      }
      return undefined;
    };

    const summaryContent = findSectionContent(['summary', '摘要', 'overview']);
    const modifiedContent = findSectionContent([
      'modified file',
      'modified',
      '修改檔案',
      '修改文件',
      'changed file',
      'files modified',
    ]);
    const findingsContent = findSectionContent([
      'finding',
      '發現',
      'key finding',
      '關鍵發現',
      '重要發現',
    ]);
    const verificationContent = findSectionContent([
      'verification',
      '驗證',
      'testing',
      '測試結果',
      'verify',
    ]);
    const questionsContent = findSectionContent([
      'open question',
      'question',
      '待決問題',
      '未解決問題',
      'unresolved',
    ]);

    const modifiedFiles = parseBullets(modifiedContent);
    const findings = parseBullets(findingsContent);
    const openQuestions = parseBullets(questionsContent);
    const summary = summaryContent?.trim() || undefined;
    const verification = verificationContent?.trim() || undefined;

    if (!summary && !modifiedFiles && !findings && !verification && !openQuestions) {
      return undefined;
    }

    return {
      summary,
      modifiedFiles,
      findings,
      verification,
      openQuestions,
    };
  }

  private async streamCompletionWithRetry(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: import('@harni/types').ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    onBeforeRetry?: () => void,
  ): Promise<ProviderCompletionResult> {
    let retryAttempt = 0;
    while (true) {
      try {
        return await this.provider.streamCompletion(
          messages,
          systemPrompt,
          tools,
          onChunk,
          this.abortController?.signal,
        );
      } catch (err: unknown) {
        if (this.abortController?.signal.aborted) {
          throw err;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        if (isRateLimitError(errMsg) && retryAttempt < this.maxRateLimitRetries) {
          const delayMs = this.rateLimitBaseDelayMs * Math.pow(2, retryAttempt);
          retryAttempt++;
          this.currentToolSummary = `Rate limited, retrying in ${Math.round(delayMs / 1000)}s (attempt ${retryAttempt}/${this.maxRateLimitRetries})...`;
          onBeforeRetry?.();
          await new Promise<void>((resolve, reject) => {
            if (this.abortController?.signal.aborted) {
              reject(new Error('Subagent execution cancelled'));
              return;
            }
            const timer = setTimeout(() => {
              this.abortController?.signal.removeEventListener('abort', onAbort);
              resolve();
            }, delayMs);
            const onAbort = () => {
              clearTimeout(timer);
              this.abortController?.signal.removeEventListener('abort', onAbort);
              reject(new Error('Subagent execution cancelled'));
            };
            this.abortController?.signal.addEventListener('abort', onAbort, { once: true });
          });
          continue;
        }
        throw err;
      } finally {
        this.currentToolSummary = undefined;
      }
    }
  }

  private getUsage(): TokenUsage {
    return this.hasReportedUsage
      ? { ...this.reportedUsage }
      : this.contextManager.getTokenUsage();
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
      currentToolSummary: this.currentToolSummary,
      tokenUsage: this.getUsage(),
      structuredReport: this.structuredReport,
      worktreePath: this.worktreePath,
      worktreeBranch: this.worktreeBranch,
    };
  }

  public setWorktreeInfo(worktreePath: string, worktreeBranch: string): void {
    this.worktreePath = worktreePath;
    this.worktreeBranch = worktreeBranch;
    this.updatedAt = Date.now();
  }

  public setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
    this.updatedAt = Date.now();
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
    this.currentToolSummary = undefined;
    this.status = 'cancelled';
    this.error = reason || 'Subagent execution cancelled';
    this.updatedAt = Date.now();
    this.completedAt = Date.now();
    this.abortController?.abort();
    this.emit('status', { status: this.status, error: this.error });
  }

  public async run(): Promise<SubagentExecutionResult> {
    if (this.completionPromise) {
      return this.completionPromise;
    }
    if (this.contextManager.getMessages().length === 0) {
      const initialUserMessage: ChatMessage = {
        id: `sub_msg_${Date.now()}`,
        role: 'user',
        content: this.prompt,
        timestamp: Date.now(),
      };
      this.contextManager.addMessage(initialUserMessage);
    }
    this.completionPromise = this.runLoop().finally(() => {
      this.completionPromise = null;
    });
    return this.completionPromise;
  }

  public async waitForCompletion(): Promise<SubagentExecutionResult> {
    if (this.completionPromise) {
      return await this.completionPromise;
    }
    return {
      id: this.id,
      typeName: this.definition.name,
      role: this.role,
      status: this.status,
      result: this.result || this.error || 'Subagent execution finished.',
      error: this.error,
      durationMs: this.completedAt ? this.completedAt - this.createdAt : Date.now() - this.createdAt,
      toolCallCount: this.toolCallCount,
      tokenUsage: this.getUsage(),
      codeModified: this.codeModified,
      structuredReport: this.structuredReport,
      worktreePath: this.worktreePath,
      worktreeBranch: this.worktreeBranch,
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
      const res = await this.runLoop();
      return res.result;
    }

    return 'Message delivered to running subagent.';
  }

  private async runLoop(): Promise<SubagentExecutionResult> {
    const startTime = Date.now();
    if (this.status === 'cancelled') {
      return {
        id: this.id,
        typeName: this.definition.name,
        role: this.role,
        status: 'cancelled',
        result: this.result || this.error || 'Subagent execution cancelled',
        error: this.error,
        durationMs: 0,
        toolCallCount: 0,
        tokenUsage: this.getUsage(),
        codeModified: false,
        structuredReport: this.structuredReport,
      };
    }

    if (this.parentSignal?.aborted) {
      this.abort('Parent task cancelled');
      return {
        id: this.id,
        typeName: this.definition.name,
        role: this.role,
        status: 'cancelled',
        result: 'Parent task cancelled',
        error: 'Parent task cancelled',
        durationMs: 0,
        toolCallCount: 0,
        tokenUsage: this.getUsage(),
        codeModified: false,
        structuredReport: this.structuredReport,
      };
    }

    this.abortController = new AbortController();
    this.setStatus('running');

    let timeoutTimer: NodeJS.Timeout | null = null;
    let timedOut = false;
    const effectiveTimeoutMs = this.timeoutMs;
    if (effectiveTimeoutMs && effectiveTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        this.error = `Subagent execution timed out after ${effectiveTimeoutMs}ms`;
        this.abortController?.abort();
      }, effectiveTimeoutMs);
    }

    const onParentAbort = () => {
      this.abort('Parent task cancelled');
    };
    this.parentSignal?.addEventListener('abort', onParentAbort, { once: true });

    const maxTurns = this.definition.maxTurns ?? 15;
    let turn = 0;
    this.isLoopRunning = true;

    try {
      while (turn < maxTurns && !this.abortController?.signal.aborted) {
        turn++;

        let toolDefs = this.toolRegistry.getDefinitions();
        if (this.definition.enableMcpTools && this.mcpManager) {
          let mcpDefs = this.mcpManager.getToolDefinitions();
          if (this.definition.enableWriteTools === false) {
            mcpDefs = mcpDefs.filter((d) => this.mcpManager!.isToolAllowedForReadOnly(d.name));
          }
          toolDefs = [...toolDefs, ...mcpDefs];
        }

        const baseSystemPrompt = this.definition.systemPrompt;
        const systemPrompt = SystemPromptBuilder.build({
          workspaceRoot: this.workspaceRoot,
          mode: 'custom',
          customInstructions: `${baseSystemPrompt}\n\n[Role]: ${this.role}\n[Subagent Depth]: ${this.depth}`,
          tools: toolDefs,
          isSubagent: true,
        });

        let turnHasUsageChunk = false;
        const result = await this.streamCompletionWithRetry(
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
              this.currentToolSummary = `Subagent calling ${chunk.name}`;
              this.emit('tool', {
                toolName: chunk.name,
                summary: `Subagent called ${chunk.name}`,
                status: 'start',
              });
            } else if (chunk.type === 'usage' && chunk.usage) {
              turnHasUsageChunk = true;
              this.hasReportedUsage = true;
              this.reportedUsage.promptTokens += chunk.usage.promptTokens || 0;
              this.reportedUsage.completionTokens += chunk.usage.completionTokens || 0;
              this.reportedUsage.totalTokens =
                this.reportedUsage.promptTokens + this.reportedUsage.completionTokens;
              if (chunk.usage.cacheReadTokens) {
                this.reportedUsage.cacheReadTokens =
                  (this.reportedUsage.cacheReadTokens || 0) + chunk.usage.cacheReadTokens;
              }
              if (chunk.usage.cacheWriteTokens) {
                this.reportedUsage.cacheWriteTokens =
                  (this.reportedUsage.cacheWriteTokens || 0) + chunk.usage.cacheWriteTokens;
              }
            }
          },
          () => {
            this.emit('tool', {
              toolName: 'RateLimitRetry',
              summary: this.currentToolSummary || 'Rate limited, retrying...',
              status: 'running',
            });
          },
        );

        if (!turnHasUsageChunk && result.usage) {
          this.hasReportedUsage = true;
          this.reportedUsage.promptTokens += result.usage.promptTokens || 0;
          this.reportedUsage.completionTokens += result.usage.completionTokens || 0;
          this.reportedUsage.totalTokens =
            this.reportedUsage.promptTokens + this.reportedUsage.completionTokens;
          if (result.usage.cacheReadTokens) {
            this.reportedUsage.cacheReadTokens =
              (this.reportedUsage.cacheReadTokens || 0) + result.usage.cacheReadTokens;
          }
          if (result.usage.cacheWriteTokens) {
            this.reportedUsage.cacheWriteTokens =
              (this.reportedUsage.cacheWriteTokens || 0) + result.usage.cacheWriteTokens;
          }
        }

        if (
          this.maxTokensBudget &&
          this.maxTokensBudget > 0 &&
          this.getUsage().totalTokens >= this.maxTokensBudget
        ) {
          break;
        }

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
          this.currentToolSummary = undefined;
          this.result = result.text || 'Task completed successfully.';
          this.structuredReport = SubagentInstance.parseStructuredReport(this.result);
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
            sessionId: this.sessionId,
            taskId: this.id,
            depth: this.depth,
            subagentManager: this.subagentManager,
            model: this.model,
            parentSignal: this.abortController?.signal,
            onFileDiff: this.onFileDiff,
            onDiagnostics: this.onDiagnostics,
            onTerminalData: this.onTerminalData,
            onCodeModified: this.onCodeModified,
            anthropicOAuth: this.anthropicOAuth,
            openaiOAuth: this.openaiOAuth,
            openaiAccountId: this.openaiAccountId,
            askQuestion: this.askUserQuestion
              ? async (qParams) => {
                  const prevStatus = this.status;
                  this.setStatus('waiting_for_input');
                  try {
                    return await this.askUserQuestion!(
                      this.sessionId,
                      {
                        ...qParams,
                        subagentId: this.id,
                        subagentRole: this.role,
                      },
                      this.abortController?.signal,
                    );
                  } finally {
                    if (this.status === 'waiting_for_input') {
                      this.setStatus(prevStatus === 'waiting_for_input' ? 'running' : prevStatus);
                    }
                  }
                }
              : undefined,
          };

          const mcpTool = this.definition.enableMcpTools
            ? this.mcpManager?.getTool(toolCall.name)
            : undefined;

          let toolResult: ToolResult;

          // A2 Check: If read-only subagent and calling non-allowed MCP tool
          if (
            this.definition.enableWriteTools === false &&
            mcpTool &&
            this.mcpManager &&
            !this.mcpManager.isToolAllowedForReadOnly(toolCall.name)
          ) {
            toolResult = {
              toolCallId: toolCall.id,
              isError: true,
              output: 'Tool not permitted for read-only subagent',
              summary: `Permission denied: ${toolCall.name}`,
            };
            this.emit('tool', {
              toolName: toolCall.name,
              summary: `Permission denied: ${toolCall.name}`,
              status: 'error',
            });
          } else {
            // A1 Check: Approval check
            const requiresApproval = mcpTool
              ? (this.mcpManager?.getToolRequiresApproval(toolCall.name) ?? false)
              : (this.toolRegistry.getTool(toolCall.name)?.requiresApproval ?? false);

            let isApproved = true;
            let rejectReason: string | undefined;

            if (requiresApproval) {
              if (!this.requestToolApproval) {
                isApproved = false;
                rejectReason = `User rejected execution of tool '${toolCall.name}'.`;
              } else {
                const approvalRes = await this.requestToolApproval(
                  this.sessionId,
                  {
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: (toolCall.arguments || {}) as Record<string, unknown>,
                    requiresApproval: true,
                    subagentId: this.id,
                    subagentRole: this.role,
                  },
                  this.abortController?.signal,
                );
                if (!approvalRes.approved) {
                  isApproved = false;
                  rejectReason = `User rejected execution of tool '${toolCall.name}'. ${approvalRes.feedback ? 'Feedback: ' + approvalRes.feedback : ''}`.trim();
                }
              }
            }

            if (!isApproved) {
              toolResult = {
                toolCallId: toolCall.id,
                isError: true,
                output: rejectReason || `User rejected execution of tool '${toolCall.name}'.`,
                summary: `Rejected ${toolCall.name}`,
              };
              this.emit('tool', {
                toolName: toolCall.name,
                summary: `Rejected ${toolCall.name}`,
                status: 'error',
              });
            } else {
              try {
                if (mcpTool && this.mcpManager) {
                  toolResult = await this.mcpManager.callTool(
                    toolCall.name,
                    (toolCall.arguments || {}) as Record<string, unknown>,
                  );
                } else {
                  toolResult = await this.toolRegistry.executeTool(
                    toolCall.name,
                    toolCall.arguments,
                    execContext,
                  );
                }
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
              } finally {
                this.currentToolSummary = undefined;
              }
            }
          }

          toolResult.toolCallId = toolCall.id;

          // Check code modification
          if (!toolResult.isError) {
            const resolvedName = this.toolRegistry.resolveToolName(toolCall.name);
            if (resolvedName === 'write_to_file' || resolvedName === 'replace_file_content') {
              const targetPath = String(
                (toolCall.arguments as Record<string, unknown>)?.path ??
                  (toolCall.arguments as Record<string, unknown>)?.TargetFile ??
                  (toolCall.arguments as Record<string, unknown>)?.AbsolutePath ??
                  '',
              );
              if (AutoTestRunner.isCodeFile(targetPath)) {
                this.codeModified = true;
                this.onCodeModified?.();
              }
            }
          }

          // Truncation check
          const MAX_SUBAGENT_TOOL_OUTPUT_CHARS = 30_000;
          let toolOutputStr =
            typeof toolResult.output === 'string'
              ? toolResult.output
              : JSON.stringify(toolResult.output);

          if (toolOutputStr.length > MAX_SUBAGENT_TOOL_OUTPUT_CHARS) {
            const truncatedSuffix =
              `\n\n...[Subagent 工具輸出過長 (共 ${toolOutputStr.length.toLocaleString()} 字元)，已自動壓縮至安全長度以維護 Token 安全]...\n` +
              toolOutputStr.slice(-1000);
            toolOutputStr = toolOutputStr.slice(0, 28_000) + truncatedSuffix;
            if (typeof toolResult.output === 'string') {
              toolResult.output = toolOutputStr;
            }
          }

          const toolMsg: ChatMessage = {
            id: `sub_tool_${Date.now()}`,
            role: 'tool',
            name: toolCall.name,
            content: toolOutputStr,
            toolCallId: toolCall.id,
            toolResult,
            timestamp: Date.now(),
          };
          this.contextManager.addMessage(toolMsg);
        }
      }

      // A8 & P2-3: Reached maxTurns or maxTokensBudget summary call
      const hitTokenBudget =
        this.maxTokensBudget &&
        this.maxTokensBudget > 0 &&
        this.getUsage().totalTokens >= this.maxTokensBudget;
      const hitTurnLimit = turn >= maxTurns;

      if (
        (hitTurnLimit || hitTokenBudget) &&
        !this.abortController?.signal.aborted &&
        this.status === 'running'
      ) {
        const fallback = hitTokenBudget
          ? `Subagent reached token budget limit (${this.maxTokensBudget}) without a final report.`
          : `Subagent reached maximum turn limit (${maxTurns}) without a final report.`;
        try {
          const limitMsg: ChatMessage = {
            id: `sub_limit_${Date.now()}`,
            role: 'user',
            content: hitTokenBudget
              ? 'You have reached your token budget limit. Do not call any more tools. Provide your concise final report now: summarize what was completed, what remains, and key findings.'
              : 'You have reached the maximum turn limit. Do not call any more tools. Provide your final report now: summarize what was completed, what remains, and key findings.',
            timestamp: Date.now(),
          };
          this.contextManager.addMessage(limitMsg);

          const baseSystemPrompt = this.definition.systemPrompt;
          const systemPrompt = SystemPromptBuilder.build({
            workspaceRoot: this.workspaceRoot,
            mode: 'custom',
            customInstructions: `${baseSystemPrompt}\n\n[Role]: ${this.role}\n[Subagent Depth]: ${this.depth}`,
            tools: [],
            isSubagent: true,
          });

          let summaryTurnUsageChunk = false;
          const summaryResult = await this.streamCompletionWithRetry(
            this.contextManager.getMessages(),
            systemPrompt,
            [],
            (chunk) => {
              if (this.abortController?.signal.aborted) return;
              if (chunk.type === 'token') {
                this.emit('token', { text: chunk.content, isThinking: false });
              } else if (chunk.type === 'thinking') {
                this.emit('token', { text: chunk.thought, isThinking: true });
              } else if (chunk.type === 'usage' && chunk.usage) {
                summaryTurnUsageChunk = true;
                this.hasReportedUsage = true;
                this.reportedUsage.promptTokens += chunk.usage.promptTokens || 0;
                this.reportedUsage.completionTokens += chunk.usage.completionTokens || 0;
                this.reportedUsage.totalTokens =
                  this.reportedUsage.promptTokens + this.reportedUsage.completionTokens;
                if (chunk.usage.cacheReadTokens) {
                  this.reportedUsage.cacheReadTokens =
                    (this.reportedUsage.cacheReadTokens || 0) + chunk.usage.cacheReadTokens;
                }
                if (chunk.usage.cacheWriteTokens) {
                  this.reportedUsage.cacheWriteTokens =
                    (this.reportedUsage.cacheWriteTokens || 0) + chunk.usage.cacheWriteTokens;
                }
              }
            },
            () => {
              this.emit('tool', {
                toolName: 'RateLimitRetry',
                summary: this.currentToolSummary || 'Rate limited, retrying...',
                status: 'running',
              });
            },
          );

          if (!summaryTurnUsageChunk && summaryResult.usage) {
            this.hasReportedUsage = true;
            this.reportedUsage.promptTokens += summaryResult.usage.promptTokens || 0;
            this.reportedUsage.completionTokens += summaryResult.usage.completionTokens || 0;
            this.reportedUsage.totalTokens =
              this.reportedUsage.promptTokens + this.reportedUsage.completionTokens;
            if (summaryResult.usage.cacheReadTokens) {
              this.reportedUsage.cacheReadTokens =
                (this.reportedUsage.cacheReadTokens || 0) + summaryResult.usage.cacheReadTokens;
            }
            if (summaryResult.usage.cacheWriteTokens) {
              this.reportedUsage.cacheWriteTokens =
                (this.reportedUsage.cacheWriteTokens || 0) + summaryResult.usage.cacheWriteTokens;
            }
          }

          if (this.status === 'running') {
            this.result = summaryResult.text?.trim() || fallback;
            this.structuredReport = SubagentInstance.parseStructuredReport(this.result);
            this.setStatus('completed');
          }
        } catch {
          if (this.status === 'running') {
            this.result = fallback;
            this.structuredReport = SubagentInstance.parseStructuredReport(this.result);
            this.setStatus('completed');
          }
        }
      }
    } catch (err: unknown) {
      if (timedOut) {
        this.error = `Subagent execution timed out after ${effectiveTimeoutMs}ms`;
        this.setStatus('error');
      } else if (this.abortController?.signal.aborted) {
        this.setStatus('cancelled');
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.error = errorMsg;
        this.setStatus('error');
      }
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      this.currentToolSummary = undefined;
      this.isLoopRunning = false;
      this.abortController = null;
      this.completedAt = Date.now();
      if (onParentAbort) {
        this.parentSignal?.removeEventListener('abort', onParentAbort);
      }
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
      tokenUsage: this.getUsage(),
      codeModified: this.codeModified,
      structuredReport: this.structuredReport,
      worktreePath: this.worktreePath,
      worktreeBranch: this.worktreeBranch,
    };
  }

  private setStatus(newStatus: SubagentStatus): void {
    this.status = newStatus;
    this.updatedAt = Date.now();
    this.emit('status', { status: newStatus, error: this.error });
  }
}
