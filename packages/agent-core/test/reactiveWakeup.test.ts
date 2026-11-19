import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AgentCoreEngine,
  MockProvider,
  SchedulerService,
  ScheduleTool,
  parseCronExpression,
  getNextCronRunAt,
} from '../src/index.js';

describe('SchedulerService & ScheduleTool', () => {
  it('parses 5-field cron expressions and computes next run time', () => {
    const parsed = parseCronExpression('*/15 9-17 1,15 * 7');
    expect(parsed.minutes).toEqual(new Set([0, 15, 30, 45]));
    expect(parsed.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
    expect(parsed.daysOfMonth).toEqual(new Set([1, 15]));
    expect(parsed.daysOfWeek).toEqual(new Set([0])); // 7 normalized to 0

    // Pick a Sunday on the 1st? 2026-02-01 is Sunday!
    const baseMs = new Date(2026, 1, 1, 9, 10, 0, 0).getTime();
    const nextMs = getNextCronRunAt(parsed, baseMs);
    const nextDate = new Date(nextMs);
    expect(nextDate.getFullYear()).toBe(2026);
    expect(nextDate.getMonth()).toBe(1);
    expect(nextDate.getDate()).toBe(1);
    expect(nextDate.getHours()).toBe(9);
    expect(nextDate.getMinutes()).toBe(15);

    expect(() => parseCronExpression('* * *')).toThrow();
    expect(() => parseCronExpression('65 * * * *')).toThrow();
  });

  it('creates one-shot timer, triggers it, and supports early cancellation via timerCondition', async () => {
    const scheduler = new SchedulerService();
    const createdEvents: unknown[] = [];
    const triggeredEvents: Array<{ scheduleId: string; prompt: string; iteration: number }> = [];
    const cancelledEvents: Array<{ scheduleId: string; reason?: string }> = [];

    scheduler.on('schedule:created', (e) => createdEvents.push(e));
    scheduler.on('schedule:triggered', (e) => triggeredEvents.push(e));
    scheduler.on('schedule:cancelled', (e) => cancelledEvents.push(e));

    // 1. Timer that fires normally
    const t1 = scheduler.createTimer({
      sessionId: 's1',
      durationSeconds: 0.03,
      prompt: 'Check build status',
      timerCondition: 'never',
    });
    expect(createdEvents).toHaveLength(1);
    expect(scheduler.listSchedules('s1')).toHaveLength(1);

    // Notify wakeup event - 'never' should NOT cancel t1
    const earlyCancelled0 = scheduler.notifyWakeupEvent('s1', 'sub_123');
    expect(earlyCancelled0).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 70));
    expect(triggeredEvents).toHaveLength(1);
    expect(triggeredEvents[0]).toMatchObject({
      scheduleId: t1.id,
      prompt: 'Check build status',
      iteration: 1,
    });
    expect(scheduler.listSchedules('s1')).toHaveLength(0);

    // 2. Timer with timerCondition='sub_target' cancelled early
    const t2 = scheduler.createTimer({
      sessionId: 's1',
      durationSeconds: 5,
      prompt: 'Timeout fallback',
      timerCondition: 'sub_target',
    });
    const t3 = scheduler.createTimer({
      sessionId: 's1',
      durationSeconds: 5,
      prompt: 'Any wakeup fallback',
      timerCondition: 'any',
    });

    // Unrelated sourceId only cancels 'any' (t3)
    const cancelled1 = scheduler.notifyWakeupEvent('s1', 'sub_other');
    expect(cancelled1).toEqual([t3.id]);
    expect(scheduler.listSchedules('s1')).toHaveLength(1);

    // Matching sourceId cancels t2
    const cancelled2 = scheduler.notifyWakeupEvent('s1', 'sub_target');
    expect(cancelled2).toEqual([t2.id]);
    expect(scheduler.listSchedules('s1')).toHaveLength(0);
    expect(cancelledEvents).toHaveLength(2);

    scheduler.dispose();
  });

  it('executes ScheduleTool create, list, cancel, and validates inputs', async () => {
    const scheduler = new SchedulerService();
    const tool = new ScheduleTool();
    const ctx = { workspaceRoot: process.cwd(), sessionId: 'sess_tool', schedulerService: scheduler };

    // Missing prompt
    const err1 = await tool.execute({ durationSeconds: 10 }, ctx);
    expect(err1.isError).toBe(true);

    // Mutually exclusive
    const err2 = await tool.execute(
      { prompt: 'hi', durationSeconds: 10, cronExpression: '* * * * *' },
      ctx,
    );
    expect(err2.isError).toBe(true);

    // Create cron
    const resCreate = await tool.execute(
      { prompt: 'Periodic check', cronExpression: '0 * * * *', maxIterations: 3, isDaemon: true },
      ctx,
    );
    expect(resCreate.isError).toBe(false);
    const created = JSON.parse(resCreate.output);
    expect(created.kind).toBe('cron');
    expect(created.isDaemon).toBe(true);

    // List
    const resList = await tool.execute({ action: 'list' }, ctx);
    expect(resList.isError).toBe(false);
    expect(JSON.parse(resList.output)).toHaveLength(1);

    // Cancel
    const resCancel = await tool.execute({ action: 'cancel', scheduleId: created.id }, ctx);
    expect(resCancel.isError).toBe(false);
    expect(scheduler.listSchedules('sess_tool')).toHaveLength(0);

    // Cancel from another session must be rejected
    const created2 = JSON.parse(
      (await tool.execute({ prompt: 'Owned by A', durationSeconds: 30 }, ctx)).output,
    );
    const crossCancel = await tool.execute(
      { action: 'cancel', scheduleId: created2.id },
      { ...ctx, sessionId: 'other_session' },
    );
    expect(crossCancel.isError).toBe(true);
    expect(scheduler.listSchedules('sess_tool')).toHaveLength(1);

    // Cancel from owning session succeeds
    const ownCancel = await tool.execute({ action: 'cancel', scheduleId: created2.id }, ctx);
    expect(ownCancel.isError).toBe(false);

    // Impossible cron expression (Feb 31) fails immediately without blocking
    expect(() =>
      scheduler.createCron({
        sessionId: 'sess_tool',
        cronExpression: '0 0 31 2 *',
        prompt: 'Never',
      }),
    ).toThrow(/Impossible cron expression/i);

    scheduler.dispose();
  });
});

describe('AgentCoreEngine Reactive Wakeup', () => {
  const tempTestDir = path.resolve('temp_test_reactive_wakeup_workspace');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('automatically wakes a completed session when a scheduled timer triggers', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      autoApprove: true,
      autoTestEnabled: false,
      gitCheckpointEnabled: false,
    });

    const mockProvider = new MockProvider({
      script: [
        // Turn 1: Agent schedules a short timer and ends its turn
        {
          thought: 'I will set a short timer and wait reactively.',
          text: 'Scheduling a 50ms timer.',
          toolCalls: [
            {
              id: 'call_sched_1',
              name: 'schedule',
              arguments: {
                durationSeconds: 0.05,
                prompt: 'Timer fired: please report status.',
              },
            },
          ],
        },
        // Turn 2: Agent finishes initial turn
        {
          thought: 'Timer is set. Ending turn.',
          text: 'Waiting for timer notification.',
        },
        // Turn 3 (Reactive Wakeup): Agent responds to [SYSTEM_NOTIFICATION]
        {
          thought: 'I was woken up by the timer.',
          text: 'Received timer wakeup and processed it.',
        },
      ],
    });

    const wakeupQueuedEvents: Array<{ sessionId: string; source: string; summary: string }> = [];
    const triggeredEvents: Array<{ sessionId: string; scheduleId: string }> = [];
    engine.on('wakeup:queued', (e) => wakeupQueuedEvents.push(e));
    engine.on('schedule:triggered', (e) => triggeredEvents.push(e));

    await engine.startTask('Start reactive timer test', {
      sessionId: 'sess_timer_wake',
      customProvider: mockProvider,
    });

    // Initial task completed after Turn 2
    expect(engine.getStatus('sess_timer_wake')).toBe('completed');

    // Wait for timer to fire and reactive wakeup turn to finish
    await new Promise<void>((resolve) => {
      const check = () => {
        const state = engine.getTaskState('sess_timer_wake');
        const hasWakeupReply = state?.messages.some(
          (m) => m.role === 'assistant' && m.content.includes('Received timer wakeup'),
        );
        if (hasWakeupReply && state?.status === 'completed') {
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      setTimeout(check, 30);
    });

    expect(triggeredEvents).toHaveLength(1);
    expect(wakeupQueuedEvents).toHaveLength(1);
    expect(wakeupQueuedEvents[0].source).toBe('schedule');

    const finalState = engine.getTaskState('sess_timer_wake')!;
    expect(finalState.status).toBe('completed');
    const systemNotif = finalState.messages.find(
      (m) => m.role === 'user' && m.content.includes('[SYSTEM_NOTIFICATION — Reactive Wakeup]'),
    );
    expect(systemNotif).toBeDefined();
    expect(systemNotif?.content).toContain('Timer fired: please report status.');

    await engine.dispose();
  });

  it('wakes a completed session when a background subagent completes and cancels early timers', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      autoApprove: true,
      autoTestEnabled: false,
      gitCheckpointEnabled: false,
    });

    const mockProvider = new MockProvider({
      script: [
        // Turn 1: initial response completes
        {
          thought: 'Waiting for background subagent.',
          text: 'Dispatched background work.',
        },
        // Turn 2 (Reactive Wakeup): handle background subagent result
        {
          thought: 'Synthesizing background subagent result.',
          text: 'Background subagent result received and synthesized.',
        },
      ],
    });

    await engine.startTask('Wait for background subagent', {
      sessionId: 'sess_sub_wake',
      customProvider: mockProvider,
    });
    expect(engine.getStatus('sess_sub_wake')).toBe('completed');

    // Create a fallback timer with timerCondition: 'any'
    const fallbackTimer = engine.getSchedulerService().createTimer({
      sessionId: 'sess_sub_wake',
      durationSeconds: 10,
      prompt: 'Fallback timeout',
      timerCondition: 'any',
    });

    const cancelledEvents: Array<{ scheduleId: string }> = [];
    engine.on('schedule:cancelled', (e) => cancelledEvents.push(e));

    // Simulate background subagent completion on internal subagentManager
    const subagentMgr = (engine as unknown as { subagentManager: import('node:events').EventEmitter }).subagentManager;
    subagentMgr.emit('subagent:completed', {
      sessionId: 'sess_sub_wake',
      subagentId: 'sub_bg_1',
      status: 'completed',
      result: 'Found 42 matching symbols.',
      durationMs: 120,
      background: true,
      role: 'researcher',
    });

    // Fallback timer should have been cancelled early
    expect(cancelledEvents.some((c) => c.scheduleId === fallbackTimer.id)).toBe(true);

    // Wait for wakeup turn to complete
    await new Promise<void>((resolve) => {
      const check = () => {
        const state = engine.getTaskState('sess_sub_wake');
        const hasReply = state?.messages.some(
          (m) => m.role === 'assistant' && m.content.includes('Background subagent result received'),
        );
        if (hasReply && state?.status === 'completed') {
          resolve();
        } else {
          setTimeout(check, 15);
        }
      };
      setTimeout(check, 15);
    });

    const finalState = engine.getTaskState('sess_sub_wake')!;
    const notif = finalState.messages.find(
      (m) => m.role === 'user' && m.content.includes('Background subagent researcher (sub_bg_1) completed'),
    );
    expect(notif).toBeDefined();
    expect(notif?.content).toContain('Found 42 matching symbols.');

    await engine.dispose();
  });

  it('does not wake a cancelled session and cleans up schedules on cancelTask / resetSession', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      autoApprove: true,
      autoTestEnabled: false,
      gitCheckpointEnabled: false,
    });

    const mockProvider = new MockProvider({
      script: [{ text: 'Initial done.' }, { text: 'Should never run.' }],
    });

    await engine.startTask('Run and cancel', {
      sessionId: 'sess_cancel_test',
      customProvider: mockProvider,
    });

    const scheduler = engine.getSchedulerService();
    scheduler.createTimer({
      sessionId: 'sess_cancel_test',
      durationSeconds: 0.05,
      prompt: 'Should be cancelled',
    });
    scheduler.createCron({
      sessionId: 'sess_cancel_test',
      cronExpression: '* * * * *',
      prompt: 'Daemon cron',
      isDaemon: true,
    });

    // cancelTask cancels non-daemon timer but preserves daemon cron
    engine.cancelTask('sess_cancel_test');
    expect(engine.getStatus('sess_cancel_test')).toBe('cancelled');
    expect(scheduler.listSchedules('sess_cancel_test')).toHaveLength(1);
    expect(scheduler.listSchedules('sess_cancel_test')[0].isDaemon).toBe(true);

    // Even if a background subagent completes after cancel, cancelled session must NOT wake
    const wakeupEvents: unknown[] = [];
    engine.on('wakeup:queued', (e) => wakeupEvents.push(e));
    const subagentMgr = (engine as unknown as { subagentManager: import('node:events').EventEmitter }).subagentManager;
    subagentMgr.emit('subagent:completed', {
      sessionId: 'sess_cancel_test',
      subagentId: 'sub_late',
      status: 'completed',
      result: 'Too late',
      durationMs: 10,
      background: true,
      role: 'coder',
    });
    expect(wakeupEvents).toHaveLength(0);
    expect(engine.getStatus('sess_cancel_test')).toBe('cancelled');

    // resetSession clears even daemon schedules
    engine.resetSession('sess_cancel_test');
    expect(scheduler.listSchedules('sess_cancel_test')).toHaveLength(0);

    await engine.dispose();
  });
});
