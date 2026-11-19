import type { ToolParametersSchema, ToolResult } from '@harni/types';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';

export interface ScheduleToolParams {
  action?: 'create' | 'list' | 'cancel';
  prompt?: string;
  durationSeconds?: number;
  cronExpression?: string;
  timerCondition?: string;
  maxIterations?: number;
  isDaemon?: boolean;
  scheduleId?: string;
}

export class ScheduleTool extends BaseTool<ScheduleToolParams> {
  public readonly name = 'schedule';
  public readonly description =
    'Schedule a one-shot timer (durationSeconds) or recurring 5-field cron job (cronExpression) that wakes up the session with a prompt. Also supports listing and cancelling active schedules.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'cancel'],
        description: "Action to perform: 'create' (default), 'list', or 'cancel'.",
      },
      prompt: {
        type: 'string',
        description: 'Prompt delivered when the timer or cron triggers (required for create).',
      },
      durationSeconds: {
        type: 'number',
        description: 'Seconds to wait for a one-shot timer. Mutually exclusive with cronExpression.',
      },
      cronExpression: {
        type: 'string',
        description: 'Standard 5-field cron expression (min hour dom mon dow). Mutually exclusive with durationSeconds.',
      },
      timerCondition: {
        type: 'string',
        description:
          "Timer only. Cancels the timer early when a matching wakeup event arrives: 'never' (default), 'any', or a specific subagentId.",
      },
      maxIterations: {
        type: 'number',
        description: 'Cron only. Maximum number of triggers before stopping.',
      },
      isDaemon: {
        type: 'boolean',
        description: 'Cron only. Keep running even if the current task is cancelled.',
      },
      scheduleId: {
        type: 'string',
        description: "Schedule ID to cancel (required when action is 'cancel').",
      },
    },
    required: [],
  };

  public async execute(
    params: ScheduleToolParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const scheduler = context.schedulerService;
    if (!scheduler) {
      return {
        toolCallId: '',
        isError: true,
        output: 'SchedulerService is not available in the current execution context.',
      };
    }

    const sessionId = context.sessionId || 'default';
    const action = params.action ?? 'create';

    if (action === 'list') {
      const schedules = scheduler.listSchedules(sessionId);
      if (schedules.length === 0) {
        return {
          toolCallId: '',
          isError: false,
          output: 'No active schedules for this session.',
          summary: 'Listed 0 active schedules',
        };
      }
      return {
        toolCallId: '',
        isError: false,
        output: JSON.stringify(schedules, null, 2),
        summary: `Listed ${schedules.length} active schedule(s)`,
      };
    }

    if (action === 'cancel') {
      if (!params.scheduleId) {
        return {
          toolCallId: '',
          isError: true,
          output: "Missing required parameter 'scheduleId' for action 'cancel'.",
        };
      }
      const cancelled = scheduler.cancelSchedule(
        params.scheduleId,
        'Cancelled via schedule tool',
        sessionId,
      );
      if (!cancelled) {
        return {
          toolCallId: '',
          isError: true,
          output: `Schedule '${params.scheduleId}' not found for this session.`,
        };
      }
      return {
        toolCallId: '',
        isError: false,
        output: `Schedule '${params.scheduleId}' cancelled.`,
        summary: `Cancelled schedule ${params.scheduleId}`,
      };
    }

    // action === 'create'
    if (!params.prompt || !params.prompt.trim()) {
      return {
        toolCallId: '',
        isError: true,
        output: "Missing required parameter 'prompt' for creating a schedule.",
      };
    }

    const hasDuration = params.durationSeconds !== undefined;
    const hasCron = params.cronExpression !== undefined;

    if (hasDuration && hasCron) {
      return {
        toolCallId: '',
        isError: true,
        output: "'durationSeconds' and 'cronExpression' are mutually exclusive.",
      };
    }
    if (!hasDuration && !hasCron) {
      return {
        toolCallId: '',
        isError: true,
        output: "Must specify either 'durationSeconds' (timer) or 'cronExpression' (cron).",
      };
    }

    try {
      if (hasDuration) {
        const info = scheduler.createTimer({
          sessionId,
          durationSeconds: params.durationSeconds!,
          prompt: params.prompt,
          timerCondition: params.timerCondition,
        });
        return {
          toolCallId: '',
          isError: false,
          output: JSON.stringify(info, null, 2),
          summary: `Created timer ${info.id} (${info.durationSeconds}s)`,
        };
      }

      const info = scheduler.createCron({
        sessionId,
        cronExpression: params.cronExpression!,
        prompt: params.prompt,
        maxIterations: params.maxIterations,
        isDaemon: params.isDaemon,
      });
      return {
        toolCallId: '',
        isError: false,
        output: JSON.stringify(info, null, 2),
        summary: `Created cron ${info.id} (${info.cronExpression})`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to create schedule: ${msg}`,
      };
    }
  }
}
