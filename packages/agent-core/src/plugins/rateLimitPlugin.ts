import {
  PluginPriority,
  type ChatMessage,
  type WorkflowPlugin,
  type WorkflowPluginCategory,
  type WorkflowPluginContext,
} from '@harni/types';
import { parseRateLimitError } from '../utils/rateLimit.js';

export class RateLimitPlugin implements WorkflowPlugin {
  public readonly id = 'harni.rate-limit-diagnostics';
  public readonly name = 'Rate Limit & Diagnostics Plugin';
  public readonly description =
    'Intercepts provider rate limits and quotas, formatting clear user notifications and error events.';
  public readonly priority = PluginPriority.TELEMETRY;
  public readonly category: WorkflowPluginCategory = 'telemetry';
  public readonly isBuiltin = true;
  public enabled = true;
  public applyToSubagents = false;

  public async onTaskError(
    ctx: WorkflowPluginContext,
    error: unknown,
  ): Promise<{ handled: boolean; customMessage?: ChatMessage }> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const model = ctx.taskState?.model;
    const provider = ctx.taskState?.provider;

    const parsedLimit = parseRateLimitError(errorMsg, model, provider);

    if (parsedLimit.isRateLimit) {
      const customMessage: ChatMessage = {
        id: `msg_err_${Date.now()}`,
        role: 'assistant',
        content: parsedLimit.formattedMessage,
        rateLimitInfo: parsedLimit,
        timestamp: Date.now(),
      };

      ctx.emitEvent('error', {
        code: 'RATE_LIMIT_ERROR',
        message: parsedLimit.formattedMessage,
        sessionId: ctx.sessionId,
        taskId: ctx.taskId,
        details: parsedLimit,
      });

      return {
        handled: true,
        customMessage,
      };
    }

    return { handled: false };
  }
}
