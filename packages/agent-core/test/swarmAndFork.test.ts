import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatMessage } from '@harni/types';
import {
  AgentCoreEngine,
  MockProvider,
  SubagentManager,
  SwarmBoardService,
  SwarmTool,
  extractMentions,
} from '../src/index.js';

describe('SwarmBoardService & extractMentions', () => {
  it('extracts and deduplicates @mentions accurately', () => {
    expect(
      extractMentions('Hello @worker-1, please coordinate with (@coordinator) and @worker-1! Also @all.'),
    ).toEqual(['worker-1', 'coordinator', 'all']);
    expect(extractMentions('email user@example.com should not match')).toEqual([]);
  });

  it('manages board title, members, messages, and session clearing', () => {
    const board = new SwarmBoardService();
    const updatedEvents: unknown[] = [];
    const messageEvents: unknown[] = [];
    board.on('swarm:updated', (b) => updatedEvents.push(b));
    board.on('swarm:message', (m) => messageEvents.push(m));

    board.setTitle('s1', 'Refactor Auth Swarm');
    board.registerMember('s1', {
      name: 'researcher-1',
      subagentId: 'sub_1',
      role: 'researcher-1',
      typeName: 'researcher',
      status: 'running',
      addedBy: 'coordinator',
      workspaceIsolation: 'inherit',
    });

    const m1 = board.postMessage({
      sessionId: 's1',
      sender: 'coordinator',
      content: 'Start investigating auth.',
    });
    const m2 = board.postMessage({
      sessionId: 's1',
      sender: 'researcher-1',
      senderSubagentId: 'sub_1',
      content: '@coordinator Found issue in token parser.',
    });

    expect(messageEvents).toHaveLength(2);
    expect(m2.mentions).toEqual(['coordinator']);
    expect(board.getMessages('s1', { sinceId: m1.id })).toHaveLength(1);
    expect(board.getMessages('s1', { limit: 1 })[0].id).toBe(m2.id);

    board.updateMemberStatus('s1', 'sub_1', 'completed');
    expect(board.resolveMember('s1', 'RESEARCHER-1')?.status).toBe('completed');

    board.clearSession('s1');
    expect(board.listMembers('s1')).toHaveLength(0);
    expect(board.getMessages('s1')).toHaveLength(0);
    board.dispose();
  });
});

describe('Context Fork & SwarmTool', () => {
  const tempTestDir = path.resolve('temp_test_swarm_fork_workspace');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('forks conversation history from coordinator and sibling subagent with isolation', async () => {
    const coordinatorHistory: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Remember secret code: ALPHA-99', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Noted secret code ALPHA-99.', timestamp: 2 },
    ];

    const mgr = new SubagentManager({ workspaceRoot: tempTestDir });

    const seenMessagesChild1: ChatMessage[][] = [];
    const child1Provider = new MockProvider({
      script: [{ text: 'Child 1 saw ALPHA-99.' }],
    });
    const origStream1 = child1Provider.streamCompletion.bind(child1Provider);
    child1Provider.streamCompletion = async (msgs, sys, tools, onChunk, signal) => {
      seenMessagesChild1.push(msgs);
      return origStream1(msgs, sys, tools, onChunk, signal);
    };

    const [res1] = await mgr.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'forked-researcher',
        alias: 'fork-r1',
        prompt: 'Confirm the secret code from history.',
        sessionId: 'sess_fork',
        parentId: 'root',
        fork: 'coordinator',
        getSessionMessages: () => coordinatorHistory,
        customProvider: child1Provider,
      },
    ]);

    expect(res1.status).toBe('completed');
    expect(seenMessagesChild1[0].map((m) => m.content)).toEqual([
      'Remember secret code: ALPHA-99',
      'Noted secret code ALPHA-99.',
      'Confirm the secret code from history.',
    ]);
    // Coordinator history must remain untouched
    expect(coordinatorHistory).toHaveLength(2);

    // Now fork Child 2 from Child 1 by alias!
    const seenMessagesChild2: ChatMessage[][] = [];
    const child2Provider = new MockProvider({
      script: [{ text: 'Child 2 inherited Child 1 conversation.' }],
    });
    const origStream2 = child2Provider.streamCompletion.bind(child2Provider);
    child2Provider.streamCompletion = async (msgs, sys, tools, onChunk, signal) => {
      seenMessagesChild2.push(msgs);
      return origStream2(msgs, sys, tools, onChunk, signal);
    };

    const [res2] = await mgr.spawnSubagents([
      {
        typeName: 'reviewer',
        role: 'forked-reviewer',
        prompt: 'Verify Child 1 conclusion.',
        sessionId: 'sess_fork',
        parentId: 'root',
        fork: 'fork-r1',
        customProvider: child2Provider,
      },
    ]);

    expect(res2.status).toBe('completed');
    expect(seenMessagesChild2[0].some((m) => m.content.includes('Child 1 saw ALPHA-99.'))).toBe(true);
    expect(seenMessagesChild2[0].at(-1)?.content).toBe('Verify Child 1 conclusion.');

    // Invalid fork source should return error result
    const [errRes] = await mgr.spawnSubagents([
      {
        typeName: 'self',
        role: 'bad-fork',
        prompt: 'Will fail',
        sessionId: 'sess_fork',
        parentId: 'root',
        fork: 'non-existent-source',
      },
    ]);
    expect(errRes.status).toBe('error');
    expect(errRes.error).toContain('non-existent-source');
  });

  it('supports SwarmTool title, sharded add (tasks & n), post, read, status, and kill permissions', async () => {
    const board = new SwarmBoardService();
    const mgr = new SubagentManager({
      workspaceRoot: tempTestDir,
      defaultProvider: 'mock' as never,
    });
    const tool = new SwarmTool();

    // Coordinator sets title
    const coordCtx = {
      workspaceRoot: tempTestDir,
      sessionId: 'sess_swarm_tool',
      taskId: 'task_coord',
      subagentManager: mgr,
      swarmBoardService: board,
    };

    const titleRes = await tool.execute({ action: 'title', title: 'Parallel Audit' }, coordCtx);
    expect(titleRes.isError).toBeFalsy();

    // Worker cannot set title
    const workerCtx = {
      ...coordCtx,
      agentAlias: 'audit-1',
      taskId: 'sub_fake',
    };
    const badTitleRes = await tool.execute({ action: 'title', title: 'Hijack' }, workerCtx);
    expect(badTitleRes.isError).toBe(true);

    // Sharded add with tasks using MockProvider via monkey-patched spawn?
    // Let's use customProvider by directly testing SwarmTool with a SubagentManager whose default provider is mock,
    // or verify ProviderFactory mock fallback? Let's spy on mgr.spawnSubagents to supply MockProvider!
    const origSpawn = mgr.spawnSubagents.bind(mgr);
    mgr.spawnSubagents = (list) =>
      origSpawn(
        list.map((item) => ({
          ...item,
          customProvider: new MockProvider({ script: [{ text: `Done slice for ${item.alias}` }] }),
        })),
      );

    const addTasksRes = await tool.execute(
      {
        action: 'add',
        name: 'auditor',
        typeName: 'researcher',
        brief: 'Audit module',
        tasks: ['auth.ts', 'db.ts'],
      },
      coordCtx,
    );
    expect(addTasksRes.isError).toBeFalsy();
    const added = JSON.parse(addTasksRes.output) as Array<{ name: string; subagentId: string }>;
    expect(added.map((a) => a.name)).toEqual(['auditor-1', 'auditor-2']);

    // Wait for background workers to complete
    await mgr.waitForSubagents(added.map((a) => a.subagentId), 'sess_swarm_tool');

    const statusRes = await tool.execute({ action: 'status' }, coordCtx);
    const statusJson = JSON.parse(statusRes.output);
    expect(statusJson.title).toBe('Parallel Audit');
    expect(statusJson.memberCount).toBe(2);

    // Worker 'other-worker' cannot kill 'auditor-1' (which was addedBy='coordinator')
    const killDenied = await tool.execute(
      { action: 'kill', name: 'auditor-1' },
      { ...coordCtx, agentAlias: 'other-worker' },
    );
    expect(killDenied.isError).toBe(true);

    // Coordinator can kill 'auditor-1'
    const killOk = await tool.execute({ action: 'kill', name: 'auditor-1' }, coordCtx);
    expect(killOk.isError).toBeFalsy();

    mgr.clearSessionSubagents('sess_swarm_tool');
    board.dispose();
  });

  it('wakes both peer worker via @mention and coordinator via @coordinator through AgentCoreEngine', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      autoApprove: true,
      autoTestEnabled: false,
      gitCheckpointEnabled: false,
    });

    const coordProvider = new MockProvider({
      script: [
        // Turn 1: Coordinator finishes initial setup
        { text: 'Swarm initialized. Waiting for updates.' },
        // Turn 2 (Reactive Wakeup from Worker B background completion)
        { text: 'Noted Worker B initial scan completion.' },
        // Turn 3 (Reactive Wakeup from @coordinator): Respond to worker's swarm message
        { text: 'Coordinator acknowledged @coordinator report from worker-b.' },
      ],
    });

    await engine.startTask('Initialize swarm coordination', {
      sessionId: 'sess_p2p_wake',
      customProvider: coordProvider,
    });
    expect(engine.getStatus('sess_p2p_wake')).toBe('completed');

    // Spawn worker-b in background via SubagentManager + register on SwarmBoardService
    const subMgr = (engine as unknown as { subagentManager: SubagentManager }).subagentManager;
    const board = engine.getSwarmBoardService();

    const workerBProvider = new MockProvider({
      script: [
        // Turn 1: initial completion
        { text: 'Worker B finished initial scan.' },
        // Turn 2 (woken up by @worker-b mention from worker-a): posts @coordinator
        {
          text: 'Worker B replying to board.',
          toolCalls: [
            {
              id: 'call_swarm_post_1',
              name: 'swarm',
              arguments: {
                action: 'post',
                message: '@coordinator Both Worker A and Worker B findings are merged!',
              },
            },
          ],
        },
        { text: 'Worker B notified coordinator.' },
      ],
    });

    const [workerBRes] = await subMgr.spawnSubagents([
      {
        typeName: 'self',
        role: 'worker-b',
        alias: 'worker-b',
        prompt: 'Perform initial scan.',
        sessionId: 'sess_p2p_wake',
        parentId: 'root',
        background: true,
        swarmEnabled: true,
        swarmBoardService: board,
        customProvider: workerBProvider,
      },
    ]);

    board.registerMember('sess_p2p_wake', {
      name: 'worker-b',
      subagentId: workerBRes.id,
      role: 'worker-b',
      typeName: 'self',
      status: workerBRes.status,
      addedBy: 'coordinator',
    });

    // Wait for worker-b initial turn and coordinator Turn 2 wakeup to settle
    await subMgr.waitForSubagents([workerBRes.id], 'sess_p2p_wake');
    expect(subMgr.getInstance(workerBRes.id)?.getStatus()).toBe('completed');
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        const state = engine.getTaskState('sess_p2p_wake');
        const hasTurn2 = state?.messages.some(
          (m) => m.role === 'assistant' && m.content.includes('Noted Worker B initial scan completion'),
        );
        if (hasTurn2 && state?.status === 'completed') {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error('Timed out waiting for coordinator Turn 2'));
        } else {
          setTimeout(check, 15);
        }
      };
      setTimeout(check, 15);
    });

    // Now simulate worker-a posting @worker-b on the swarm board (without mentioning @coordinator)
    board.postMessage({
      sessionId: 'sess_p2p_wake',
      sender: 'worker-a',
      content: '@worker-b Please merge my findings and report to the coordinator.',
    });

    // Wait for worker-b to wake up, post @coordinator, and coordinator to wake up and reply
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const state = engine.getTaskState('sess_p2p_wake');
        const hasCoordReply = state?.messages.some(
          (m) =>
            m.role === 'assistant' &&
            m.content.includes('Coordinator acknowledged @coordinator report from worker-b'),
        );
        if (hasCoordReply && state?.status === 'completed') {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error('Timed out waiting for P2P -> Coordinator reactive wakeup'));
        } else {
          setTimeout(check, 20);
        }
      };
      setTimeout(check, 20);
    });

    const coordState = engine.getTaskState('sess_p2p_wake')!;
    expect(
      coordState.messages.some(
        (m) => m.role === 'user' && m.content.includes('Swarm @coordinator mention from worker-b'),
      ),
    ).toBe(true);

    // resetSession clears the swarm board for this session
    engine.resetSession('sess_p2p_wake');
    expect(board.listMembers('sess_p2p_wake')).toHaveLength(0);
    expect(board.getMessages('sess_p2p_wake')).toHaveLength(0);

    await engine.dispose();
  });
});
