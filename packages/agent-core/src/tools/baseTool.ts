import type { ToolDefinition, ToolParametersSchema, ToolResult, FileDiff } from '@harni/types';
import { resolveSafePath } from '../utils/pathSecurity.js';

export interface ToolExecutionContext {
  workspaceRoot: string;
  sessionId?: string;
  taskId?: string;
  provider?: import('@harni/types').LLMProviderType;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  subagentManager?: import('../subagents/subagentManager.js').SubagentManager;
  schedulerService?: import('../scheduler/schedulerService.js').SchedulerService;
  swarmBoardService?: import('../swarm/swarmBoardService.js').SwarmBoardService;
  getSessionMessages?: () => import('@harni/types').ChatMessage[];
  resolveForkMessages?: (source: string) => import('@harni/types').ChatMessage[] | undefined;
  agentAlias?: string;
  onFileDiff?: (diff: FileDiff) => void;
  onTerminalData?: (data: string) => void;
  onDiagnostics?: (data: import('@harni/types').FileDiagnosticsResult) => void;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  depth?: number;
  parentSignal?: AbortSignal;
  onCodeModified?: () => void;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  openaiAccountId?: string;
  askQuestion?: (params: {
    question: string;
    options?: string[];
    isMultiSelect?: boolean;
    allowCustomInput?: boolean;
  }) => Promise<{ answers: string[]; customInput?: string }>;
  runContrastiveProbe?: (
    params: import('@harni/types').ContrastiveProbeParams,
  ) => Promise<import('@harni/types').ContrastiveProbeResult>;
  skipInlineDiagnostics?: boolean;
}

export abstract class BaseTool<TParams = Record<string, unknown>> {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly parameters: ToolParametersSchema;
  public abstract readonly requiresApproval: boolean;

  public abstract execute(
    params: TParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult>;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      requiresApproval: this.requiresApproval,
    };
  }

  /**
   * Safely resolves a path and prevents path traversal (including via symlinks) outside the workspaceRoot.
   */
  protected resolveSafePath(filePath: string, workspaceRoot: string): string {
    return resolveSafePath(filePath, workspaceRoot);
  }
}
