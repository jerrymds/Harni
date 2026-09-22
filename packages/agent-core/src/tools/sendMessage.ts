import type { ToolParametersSchema, ToolResult } from '@harni/types';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';

export interface SendMessageParams {
  subagentId: string;
  message: string;
}

export class SendMessageTool extends BaseTool<SendMessageParams> {
  public readonly name = 'send_message';
  public readonly description =
    'Sends an instruction, feedback, or response message to a running or idle subagent by its subagent ID.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      subagentId: {
        type: 'string',
        description: 'The unique subagent ID to send the message to.',
      },
      message: {
        type: 'string',
        description: 'The message content or feedback to send to the subagent.',
      },
    },
    required: ['subagentId', 'message'],
  };

  public async execute(
    params: SendMessageParams,
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
      const reply = await context.subagentManager.sendMessage(
        params.subagentId,
        params.message,
      );
      return {
        toolCallId: '',
        output: `Response from subagent (${params.subagentId}):\n\n${reply}`,
        summary: `Message sent to subagent ${params.subagentId}`,
      };
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to send message to subagent: ${errMessage}`,
        summary: `Error sending to ${params.subagentId}`,
      };
    }
  }
}
