import * as path from 'node:path';
import type { ToolDefinition, ToolParametersSchema, ToolResult, FileDiff } from '@harni/types';

export interface ToolExecutionContext {
  workspaceRoot: string;
  sessionId?: string;
  taskId?: string;
  provider?: import('@harni/types').LLMProviderType;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  subagentManager?: import('../subagents/subagentManager.js').SubagentManager;
  onFileDiff?: (diff: FileDiff) => void;
  onTerminalData?: (data: string) => void;
  onDiagnostics?: (data: import('@harni/types').FileDiagnosticsResult) => void;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  askQuestion?: (params: {
    question: string;
    options?: string[];
    isMultiSelect?: boolean;
    allowCustomInput?: boolean;
  }) => Promise<{ answers: string[]; customInput?: string }>;
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
   * Safely resolves a path and prevents path traversal outside the workspaceRoot.
   */
  protected resolveSafePath(filePath: string, workspaceRoot: string): string {
    const normalizedRoot = path.resolve(workspaceRoot);
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(normalizedRoot, filePath);

    // Security check: ensure resolved path is inside normalizedRoot
    const relative = path.relative(normalizedRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal denied: '${filePath}' is outside workspace root '${workspaceRoot}'`,
      );
    }

    return resolved;
  }
}
