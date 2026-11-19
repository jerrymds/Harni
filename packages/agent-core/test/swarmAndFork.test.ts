import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { ChatMessage } from '@harni/types';
import {
  AgentCoreEngine,
  MockProvider,
  SubagentManager,
  SwarmBoardService,
  SwarmTool,
  ToolGuardPlugin,
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

  it('enforces SwarmTool batch limits, rollback on failure, and ToolGuardPlugin subagent disablement', async () => {
    const board = new SwarmBoardService();
    const mgr = new SubagentManager({ workspaceRoot: tempTestDir });
    const tool = new SwarmTool();
    const ctx = {
      workspaceRoot: tempTestDir,
      sessionId: 'sess_guard_batch',
      taskId: 'task_root',
      subagentManager: mgr,
      swarmBoardService: board,
    };

    const tooMany = await tool.execute(
      { action: 'add', name: 'worker', brief: 'Do work', n: 25 },
      ctx,
    );
    expect(tooMany.isError).toBe(true);
    expect(tooMany.output).toContain('exceeds maximum allowed per batch');

    // Partial failure in spawnSubagents should kill already-spawned workers in the batch
    const origSpawn = mgr.spawnSubagents.bind(mgr);
    let killSpyCalledWith: string[] = [];
    const origManage = mgr.manageSubagents.bind(mgr);
    mgr.manageSubagents = (action, ids, sid) => {
      if (action === 'kill' && ids) killSpyCalledWith.push(...ids);
      return origManage(action, ids, sid);
    };
    mgr.spawnSubagents = async (list) => {
      const first = await origSpawn([
        {
          ...list[0],
          customProvider: new MockProvider({ script: [{ text: 'ok' }] }),
        },
      ]);
      return [
        first[0],
        {
          id: 'failed_1',
          typeName: list[1].typeName,
          role: list[1].role,
          status: 'error',
          result: 'Simulated spawn failure',
          error: 'Simulated spawn failure',
          durationMs: 0,
          toolCallCount: 0,
        },
      ];
    };

    const partialFail = await tool.execute(
      { action: 'add', name: 'batch', brief: 'Work', tasks: ['a', 'b'] },
      ctx,
    );
    expect(partialFail.isError).toBe(true);
    expect(killSpyCalledWith).toHaveLength(1);
    expect(board.listMembers('sess_guard_batch')).toHaveLength(0);

    // ToolGuardPlugin blocks 'swarm' when subagentsEnabled is false
    const guard = new ToolGuardPlugin();
    const filtered = guard.onResolveTools(
      { sessionId: 's', workspaceRoot: tempTestDir, isSubagent: false, isSubagentsEnabled: () => false } as never,
      [{ name: 'read_file', description: '', parameters: { type: 'object', properties: {} }, requiresApproval: false }, { name: 'swarm', description: '', parameters: { type: 'object', properties: {} }, requiresApproval: false }],
    );
    expect(filtered.map((t) => t.name)).toEqual(['read_file']);

    const denied = await guard.onToolCall(
      { sessionId: 's', workspaceRoot: tempTestDir, isSubagent: false, isSubagentsEnabled: () => false } as never,
      { toolCall: { id: 'c1', name: 'swarm', arguments: {} }, canonicalToolName: 'swarm', requiresApproval: false, isMcpTool: false, metadata: {} },
      async () => ({ toolCallId: 'c1', output: 'ok' }),
    );
    expect(denied.isError).toBe(true);
    expect(denied.output).toContain('disabled in settings');

    mgr.clearSessionSubagents('sess_guard_batch');
    board.dispose();
  });

  it('preserves swarm worker worktree across @mention wakeup and cleans up worktree on kill', async () => {
    const execFileAsync = promisify(execFile);
    const repoDir = path.join(os.tmpdir(), `harni_swarm_wt_${Date.now()}`);
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.email', 'harni-test@example.com'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.name', 'Harni Test'], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, 'base.txt'), 'base content', 'utf-8');
    await execFileAsync('git', ['add', 'base.txt'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir });

    const coordProvider = new MockProvider({
      script: [
        { text: 'Coordinator initialized.' },
        { text: 'Noted worker round 1.' },
        { text: 'Noted worker round 2.' },
      ],
    });

    const engine = new AgentCoreEngine({
      workspaceRoot: repoDir,
      autoTestEnabled: false,
      gitCheckpointEnabled: false,
      experienceLearningEnabled: false,
      subagentsEnabled: true,
      customProvider: coordProvider,
    });

    try {
      await engine.startTask('Start worktree swarm test', {
        sessionId: 'sess_wt_swarm',
        customProvider: coordProvider,
      });

      const subMgr = (engine as unknown as { subagentManager: SubagentManager }).subagentManager;
      const board = engine.getSwarmBoardService();

      const workerProvider = new MockProvider({
        script: [
          {
            text: 'Writing round 1 file.',
            toolCalls: [
              {
                id: 'wt_call_1',
                name: 'write_file',
                arguments: { path: 'round1.txt', content: 'from round 1' },
              },
            ],
          },
          { text: 'Round 1 complete.' },
          {
            text: 'Writing round 2 file.',
            toolCalls: [
              {
                id: 'wt_call_2',
                name: 'write_file',
                arguments: { path: 'round2.txt', content: 'from round 2' },
              },
            ],
          },
          { text: 'Round 2 complete.' },
        ],
      });

      const [workerRes] = await subMgr.spawnSubagents([
        {
          typeName: 'self',
          role: 'worker-wt',
          alias: 'worker-wt',
          prompt: 'Write round1.txt',
          sessionId: 'sess_wt_swarm',
          parentId: 'root',
          workspaceRoot: repoDir,
          isolation: 'worktree',
          autoMergeWorktree: false,
          autoApprove: true,
          background: true,
          swarmEnabled: true,
          swarmBoardService: board,
          customProvider: workerProvider,
        },
      ]);

      board.registerMember('sess_wt_swarm', {
        name: 'worker-wt',
        subagentId: workerRes.id,
        role: 'worker-wt',
        typeName: 'self',
        status: workerRes.status,
        addedBy: 'coordinator',
        workspaceIsolation: 'worktree',
      });

      await subMgr.waitForSubagents([workerRes.id], 'sess_wt_swarm');
      const infoAfterRound1 = subMgr.getInstance(workerRes.id)?.getInfo();
      const wtPath = infoAfterRound1?.worktreePath;
      expect(wtPath).toBeTruthy();
      expect(engine.getActiveWorktreePaths()).toContain(path.resolve(wtPath!));
      expect(await fs.readFile(path.join(wtPath!, 'round1.txt'), 'utf-8')).toBe('from round 1');

      // Wake up worker via @mention for round 2 — worktree must be reused, not recreated
      board.postMessage({
        sessionId: 'sess_wt_swarm',
        sender: 'coordinator',
        content: '@worker-wt Please write round2.txt now.',
      });

      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const check = async () => {
          const existsRound2 = await fs
            .access(path.join(wtPath!, 'round2.txt'))
            .then(() => true)
            .catch(() => false);
          const status = subMgr.getInstance(workerRes.id)?.getStatus();
          if (existsRound2 && status === 'completed') {
            resolve();
          } else if (Date.now() > deadline) {
            reject(new Error('Timed out waiting for worker-wt round 2 in existing worktree'));
          } else {
            setTimeout(check, 25);
          }
        };
        setTimeout(check, 25);
      });

      // Round 1 file must still exist inside the reused worktree
      expect(await fs.readFile(path.join(wtPath!, 'round1.txt'), 'utf-8')).toBe('from round 1');
      expect(await fs.readFile(path.join(wtPath!, 'round2.txt'), 'utf-8')).toBe('from round 2');

      // Cross-session kill must be ignored
      const wrongSessionKill = subMgr.manageSubagents('kill', [workerRes.id], 'other_session');
      expect(wrongSessionKill).toHaveLength(0);
      expect(engine.getActiveWorktreePaths()).toContain(path.resolve(wtPath!));

      // Owning session kill must terminate and immediately remove active worktree path
      const ownKill = subMgr.manageSubagents('kill', [workerRes.id], 'sess_wt_swarm');
      expect(ownKill).toHaveLength(1);
      expect(engine.getActiveWorktreePaths()).not.toContain(path.resolve(wtPath!));
    } finally {
      await engine.dispose();
      await new Promise((r) => setTimeout(r, 150));
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoDir });
      } catch {
        // ignore
      }
      await fs.rm(repoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
