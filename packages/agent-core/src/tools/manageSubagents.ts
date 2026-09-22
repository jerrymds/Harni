import type { ToolParametersSchema, ToolResult } from '@harni/types';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';

export interface ManageSubagentsParams {
  action: 'list' | 'kill' | 'kill_all';
  subagentIds?: string[];
}

export class ManageSubagentsTool extends BaseTool<ManageSubagentsParams> {
  public readonly name = 'manage_subagents';
  public readonly description =
    'Manages active subagents: "list" to view current subagents and their states, "kill" to terminate specific subagents, or "kill_all" to terminate all subagents.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'kill', 'kill_all'],
        description: 'The management action: list, kill, or kill_all.',
      },
      subagentIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of subagent IDs to kill (required when action is "kill").',
      },
    },
    required: ['action'],
  };

  public async execute(
    params: ManageSubagentsParams,
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
      const list = context.subagentManager.manageSubagents(
        params.action,
        params.subagentIds,
        context.sessionId,
      );

      if (params.action === 'list') {
        if (list.length === 0) {
          return {
            toolCallId: '',
            output: 'No active or historical subagents found in this session.',
            summary: '0 subagents',
          };
        }

        const lines = list.map((info) => {
          return `- **ID**: \`${info.id}\` | **Role**: ${info.role} (${info.typeName}) | **Status**: ${info.status} | **Depth**: ${info.depth} | **Tool Calls**: ${info.toolCallCount || 0}`;
        });

        return {
          toolCallId: '',
          output: `Active Subagents (${list.length}):\n${lines.join('\n')}`,
          summary: `Listed ${list.length} subagent(s)`,
        };
      }

      return {
        toolCallId: '',
        output: `Action '${params.action}' applied to ${list.length} subagent(s).`,
        summary: `${params.action} applied to ${list.length} subagents`,
      };
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to manage subagents: ${errMessage}`,
        summary: `Error managing subagents`,
      };
    }
  }
}
