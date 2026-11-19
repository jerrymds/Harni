import { EventEmitter } from 'node:events';
import type { ScheduleInfo } from '@harni/types';

export type { ScheduleInfo, ScheduleKind } from '@harni/types';

export interface CreateTimerParams {
  sessionId: string;
  durationSeconds: number;
  prompt: string;
  timerCondition?: string;
}

export interface CreateCronParams {
  sessionId: string;
  cronExpression: string;
  prompt: string;
  maxIterations?: number;
  isDaemon?: boolean;
}

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

interface InternalScheduleEntry extends ScheduleInfo {
  timerHandle?: ReturnType<typeof setTimeout>;
  parsedCron?: ParsedCron;
}

const MAX_TIMEOUT_MS = 2_147_483_647; // 32-bit signed int max for setTimeout

function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  const parts = field.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      throw new Error(`Invalid cron field: '${field}'`);
    }

    const [rangePart, stepPart] = trimmed.split('/');
    if (trimmed.split('/').length > 2) {
      throw new Error(`Invalid cron step syntax: '${trimmed}'`);
    }

    let step = 1;
    if (stepPart !== undefined) {
      step = Number.parseInt(stepPart, 10);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid cron step value: '${stepPart}'`);
      }
    }

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [sStr, eStr] = rangePart.split('-');
      if (rangePart.split('-').length !== 2) {
        throw new Error(`Invalid cron range: '${rangePart}'`);
      }
      start = Number.parseInt(sStr, 10);
      end = Number.parseInt(eStr, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
        throw new Error(`Cron range out of bounds [${min}-${max}]: '${rangePart}'`);
      }
    } else {
      const single = Number.parseInt(rangePart, 10);
      if (!Number.isInteger(single) || single < min || single > max) {
        throw new Error(`Cron value out of bounds [${min}-${max}]: '${rangePart}'`);
      }
      if (stepPart !== undefined) {
        start = single;
        end = max;
      } else {
        result.add(single);
        continue;
      }
    }

    for (let v = start; v <= end; v += step) {
      result.add(v);
    }
  }

  if (result.size === 0) {
    throw new Error(`Cron field produced no values: '${field}'`);
  }
  return result;
}

export function parseCronExpression(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected 5-field cron expression (min hour dom mon dow), got ${fields.length}: '${expr}'`);
  }

  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const daysOfMonth = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const rawDow = parseCronField(fields[4], 0, 7);
  const daysOfWeek = new Set<number>();
  for (const d of rawDow) {
    daysOfWeek.add(d === 7 ? 0 : d);
  }

  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

const MAX_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function getNextCronRunAt(parsed: ParsedCron, afterMs: number): number {
  const minDom = Math.min(...parsed.daysOfMonth);
  const hasReachableDay = Array.from(parsed.months).some(
    (m) => minDom <= MAX_DAYS_IN_MONTH[m - 1],
  );
  if (!hasReachableDay) {
    throw new Error('Impossible cron expression: day-of-month never occurs in specified month(s)');
  }

  const date = new Date(afterMs);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);

  const deadlineMs = afterMs + 366 * 4 * 24 * 60 * 60 * 1000;
  while (date.getTime() <= deadlineMs) {
    const month = date.getMonth() + 1;
    const dom = date.getDate();
    const dow = date.getDay();

    if (!parsed.months.has(month) || !parsed.daysOfMonth.has(dom) || !parsed.daysOfWeek.has(dow)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }

    const hour = date.getHours();
    if (!parsed.hours.has(hour)) {
      date.setHours(hour + 1, 0, 0, 0);
      continue;
    }

    const minute = date.getMinutes();
    if (!parsed.minutes.has(minute)) {
      date.setMinutes(minute + 1);
      continue;
    }

    return date.getTime();
  }

  throw new Error('Could not find next cron occurrence within 4 years');
}

export class SchedulerService extends EventEmitter {
  private entries = new Map<string, InternalScheduleEntry>();
  private counter = 0;

  public createTimer(params: CreateTimerParams): ScheduleInfo {
    if (!Number.isFinite(params.durationSeconds) || params.durationSeconds <= 0) {
      throw new Error(`durationSeconds must be a positive number, got ${params.durationSeconds}`);
    }
    if (!params.prompt || !params.prompt.trim()) {
      throw new Error('prompt is required for schedule');
    }

    const id = `sched_${Date.now()}_${++this.counter}`;
    const now = Date.now();
    const delayMs = Math.round(params.durationSeconds * 1000);
    const nextRunAt = now + delayMs;

    const entry: InternalScheduleEntry = {
      id,
      sessionId: params.sessionId,
      kind: 'timer',
      prompt: params.prompt,
      createdAt: now,
      nextRunAt,
      durationSeconds: params.durationSeconds,
      timerCondition: params.timerCondition ?? 'never',
      maxIterations: 1,
      iterations: 0,
      isDaemon: false,
    };

    this.entries.set(id, entry);
    this.scheduleWait(entry, delayMs, () => {
      const current = this.entries.get(id);
      if (!current) return;
      current.iterations += 1;
      this.entries.delete(id);
      this.emit('schedule:triggered', {
        sessionId: current.sessionId,
        scheduleId: current.id,
        prompt: current.prompt,
        iteration: current.iterations,
      });
    });

    this.emit('schedule:created', {
      sessionId: entry.sessionId,
      scheduleId: entry.id,
      kind: entry.kind,
      prompt: entry.prompt,
      nextRunAt: entry.nextRunAt,
      durationSeconds: entry.durationSeconds,
      isDaemon: entry.isDaemon,
    });

    return this.toPublicInfo(entry);
  }

  public createCron(params: CreateCronParams): ScheduleInfo {
    if (!params.cronExpression || !params.cronExpression.trim()) {
      throw new Error('cronExpression is required');
    }
    if (!params.prompt || !params.prompt.trim()) {
      throw new Error('prompt is required for schedule');
    }
    if (params.maxIterations !== undefined && (!Number.isInteger(params.maxIterations) || params.maxIterations <= 0)) {
      throw new Error(`maxIterations must be a positive integer, got ${params.maxIterations}`);
    }

    const parsedCron = parseCronExpression(params.cronExpression);
    const id = `sched_${Date.now()}_${++this.counter}`;
    const now = Date.now();
    const nextRunAt = getNextCronRunAt(parsedCron, now);

    const entry: InternalScheduleEntry = {
      id,
      sessionId: params.sessionId,
      kind: 'cron',
      prompt: params.prompt,
      createdAt: now,
      nextRunAt,
      cronExpression: params.cronExpression.trim(),
      maxIterations: params.maxIterations,
      iterations: 0,
      isDaemon: params.isDaemon ?? false,
      parsedCron,
    };

    this.entries.set(id, entry);
    this.armNextCronTick(entry);

    this.emit('schedule:created', {
      sessionId: entry.sessionId,
      scheduleId: entry.id,
      kind: entry.kind,
      prompt: entry.prompt,
      nextRunAt: entry.nextRunAt,
      cronExpression: entry.cronExpression,
      isDaemon: entry.isDaemon,
    });

    return this.toPublicInfo(entry);
  }

  /**
   * Notifies the scheduler that a wakeup event occurred for a session.
   * Cancels any one-shot timers whose timerCondition matches ('any' or sourceId).
   */
  public notifyWakeupEvent(sessionId: string, sourceId?: string): string[] {
    const cancelledIds: string[] = [];
    for (const entry of Array.from(this.entries.values())) {
      if (entry.sessionId !== sessionId || entry.kind !== 'timer') continue;
      const cond = entry.timerCondition;
      if (!cond || cond === 'never') continue;

      if (cond === 'any' || (sourceId && cond === sourceId)) {
        const reason =
          cond === 'any'
            ? 'Cancelled early by wakeup event'
            : `Cancelled early by wakeup event from ${sourceId}`;
        if (this.cancelSchedule(entry.id, reason)) {
          cancelledIds.push(entry.id);
        }
      }
    }
    return cancelledIds;
  }

  public listSchedules(sessionId?: string): ScheduleInfo[] {
    const result: ScheduleInfo[] = [];
    for (const entry of this.entries.values()) {
      if (sessionId && entry.sessionId !== sessionId) continue;
      result.push(this.toPublicInfo(entry));
    }
    return result;
  }

  public cancelSchedule(
    scheduleId: string,
    reason = 'Cancelled',
    expectedSessionId?: string,
  ): boolean {
    const entry = this.entries.get(scheduleId);
    if (!entry) return false;
    if (expectedSessionId && entry.sessionId !== expectedSessionId) {
      return false;
    }

    if (entry.timerHandle) {
      clearTimeout(entry.timerHandle);
      entry.timerHandle = undefined;
    }
    this.entries.delete(scheduleId);

    this.emit('schedule:cancelled', {
      sessionId: entry.sessionId,
      scheduleId: entry.id,
      reason,
    });
    return true;
  }

  public cancelSessionSchedules(sessionId: string, includeDaemon = false): number {
    let count = 0;
    for (const entry of Array.from(this.entries.values())) {
      if (entry.sessionId !== sessionId) continue;
      if (!includeDaemon && entry.isDaemon) continue;
      if (this.cancelSchedule(entry.id, 'Session cancelled or reset')) {
        count++;
      }
    }
    return count;
  }

  public dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.timerHandle) {
        clearTimeout(entry.timerHandle);
        entry.timerHandle = undefined;
      }
    }
    this.entries.clear();
    this.removeAllListeners();
  }

  private armNextCronTick(entry: InternalScheduleEntry): void {
    if (!entry.parsedCron || !entry.nextRunAt) return;
    const delayMs = Math.max(0, entry.nextRunAt - Date.now());

    this.scheduleWait(entry, delayMs, () => {
      const current = this.entries.get(entry.id);
      if (!current || !current.parsedCron) return;

      current.iterations += 1;
      const iteration = current.iterations;

      const reachedMax =
        current.maxIterations !== undefined && iteration >= current.maxIterations;

      if (reachedMax) {
        this.entries.delete(current.id);
      } else {
        current.nextRunAt = getNextCronRunAt(current.parsedCron, Date.now());
        this.armNextCronTick(current);
      }

      this.emit('schedule:triggered', {
        sessionId: current.sessionId,
        scheduleId: current.id,
        prompt: current.prompt,
        iteration,
      });

      if (reachedMax) {
        this.emit('schedule:cancelled', {
          sessionId: current.sessionId,
          scheduleId: current.id,
          reason: `Reached maxIterations (${current.maxIterations})`,
        });
      }
    });
  }

  private scheduleWait(
    entry: InternalScheduleEntry,
    remainingMs: number,
    onReady: () => void,
  ): void {
    if (remainingMs > MAX_TIMEOUT_MS) {
      entry.timerHandle = setTimeout(() => {
        if (!this.entries.has(entry.id)) return;
        this.scheduleWait(entry, remainingMs - MAX_TIMEOUT_MS, onReady);
      }, MAX_TIMEOUT_MS);
    } else {
      entry.timerHandle = setTimeout(onReady, Math.max(0, remainingMs));
    }
    entry.timerHandle.unref?.();
  }

  private toPublicInfo(entry: InternalScheduleEntry): ScheduleInfo {
    return {
      id: entry.id,
      sessionId: entry.sessionId,
      kind: entry.kind,
      prompt: entry.prompt,
      createdAt: entry.createdAt,
      nextRunAt: entry.nextRunAt,
      durationSeconds: entry.durationSeconds,
      cronExpression: entry.cronExpression,
      timerCondition: entry.timerCondition,
      maxIterations: entry.maxIterations,
      iterations: entry.iterations,
      isDaemon: entry.isDaemon,
    };
  }
}
