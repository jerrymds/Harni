import type { SubagentDefinition, ToolParametersSchema, ToolResult } from '@harni/types';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';

export interface DefineSubagentParams {
  name: string;
  description: string;
  systemPrompt: string;
  role?: string;
  allowedTools?: string[];
  enableWriteTools?: boolean;
  enableSubagentTools?: boolean;
  model?: string;
  maxTurns?: number;
}

export class DefineSubagentTool extends BaseTool<DefineSubagentParams> {
  public readonly name = 'define_subagent';
  public readonly description =
    'Dynamically defines a new specialized subagent archetype that can be repeatedly invoked via invoke_subagent.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Unique name for the subagent type (alphanumeric, e.g. "sql_optimizer").',
      },
      description: {
        type: 'string',
        description: 'Description of what this subagent does.',
      },
      systemPrompt: {
        type: 'string',
        description: 'System instructions for this subagent.',
      },
      role: {
        type: 'string',
        description: 'Role title, e.g. "SQL Performance Optimizer".',
      },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of allowed tool names (e.g. ["read_file", "search_files"]).',
      },
      enableWriteTools: {
        type: 'boolean',
        description: 'Whether this subagent is allowed to write or replace file contents.',
      },
      enableSubagentTools: {
        type: 'boolean',
        description: 'Whether this subagent is allowed to invoke further child subagents.',
      },
      model: {
        type: 'string',
        description: 'Specific model to use for this subagent.',
      },
      maxTurns: {
        type: 'number',
        description: 'Maximum turns for this subagent execution (default 15).',
      },
    },
    required: ['name', 'description', 'systemPrompt'],
  };

  public async execute(
    params: DefineSubagentParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!context.subagentManager) {
      return {
        toolCallId: '',
        isError: true,
        output: 'Subagent orchestration is not available in this execution context.',
        summary: 'SubagentManager not found',
      };
    }

    try {
      const def: SubagentDefinition = {
        name: params.name.trim().toLowerCase(),
        description: params.description,
        systemPrompt: params.systemPrompt,
        role: params.role || params.name,
        allowedTools: params.allowedTools,
        enableWriteTools: params.enableWriteTools,
        enableSubagentTools: params.enableSubagentTools,
        model: params.model,
        maxTurns: params.maxTurns,
      };

      context.subagentManager.defineSubagent(def);

      return {
        toolCallId: '',
        output: `Successfully defined subagent archetype '${def.name}' (${def.role}). You can now invoke it with invoke_subagent.`,
        summary: `Defined subagent '${def.name}'`,
      };
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to define subagent: ${errMessage}`,
        summary: `Error defining subagent`,
      };
    }
  }
}
