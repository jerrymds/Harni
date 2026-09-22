import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentCoreEngine, MockProvider } from '../src/index.js';

describe('Multi-Session Task State & Workspace Isolation', () => {
  const tempTestDir = path.resolve('temp_test_multisession_workspace');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  it('isolates multi-session task state and background execution', async () => {
    const multiSessionEngine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    const sessionA_Tokens: string[] = [];
    const sessionB_Tokens: string[] = [];

    multiSessionEngine.on('chat:token', (ev) => {
      if (ev.sessionId === 'session_A') sessionA_Tokens.push(ev.text);
      if (ev.sessionId === 'session_B') sessionB_Tokens.push(ev.text);
    });

    const mockProviderA = new MockProvider({
      script: [{ thought: 'Thinking in session A', text: 'Output from session A' }],
    });
    const mockProviderB = new MockProvider({
      script: [{ thought: 'Thinking in session B', text: 'Output from session B' }],
    });

    await Promise.all([
      multiSessionEngine.startTask('Task in A', { sessionId: 'session_A', customProvider: mockProviderA }),
      multiSessionEngine.startTask('Task in B', { sessionId: 'session_B', customProvider: mockProviderB }),
    ]);

    expect(sessionA_Tokens.join('').trim()).toBe('Output from session A');
    expect(sessionB_Tokens.join('').trim()).toBe('Output from session B');
    expect(multiSessionEngine.getStatus('session_A')).toBe('completed');
    expect(multiSessionEngine.getStatus('session_B')).toBe('completed');

    const stateA = multiSessionEngine.getTaskState('session_A');
    const stateB = multiSessionEngine.getTaskState('session_B');
    expect(stateA?.prompt).toBe('Task in A');
    expect(stateB?.prompt).toBe('Task in B');

    multiSessionEngine.resetSession('session_A');
    expect(multiSessionEngine.getTaskState('session_A')).toBeNull();
    expect(multiSessionEngine.getTaskState('session_B')).not.toBeNull();
  });

  it('dynamically switches workspace root and enforces boundary isolation', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    const subProjectDir = path.join(tempTestDir, 'sub_project_etf');
    await fs.mkdir(subProjectDir, { recursive: true });
    await fs.writeFile(path.join(subProjectDir, 'project.json'), '{"name":"etf-dashboard"}', 'utf-8');

    engine.setWorkspaceRoot(subProjectDir);
    expect(engine.getWorkspaceRoot()).toBe(subProjectDir);

    const subWriteRes = await engine.getToolRegistry().executeTool(
      'write_to_file',
      { path: 'dashboard.ts', content: 'export const etf = true;' },
      { workspaceRoot: subProjectDir },
    );
    expect(subWriteRes.isError).toBeFalsy();
    const fileExistsInSub = await fs.readFile(path.join(subProjectDir, 'dashboard.ts'), 'utf-8');
    expect(fileExistsInSub).toBe('export const etf = true;');

    const outOfBoundsRes = await engine.getToolRegistry().executeTool(
      'read_file',
      { path: '../test.ts' },
      { workspaceRoot: subProjectDir },
    );
    expect(outOfBoundsRes.isError).toBeTruthy();
    expect(String(outOfBoundsRes.output)).toContain('Path traversal denied');
  });

  it('guarantees concurrent multi-session workspace directory isolation', async () => {
    const workspaceA = path.join(tempTestDir, 'workspace_a');
    const workspaceB = path.join(tempTestDir, 'workspace_b');
    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(workspaceB, { recursive: true });

    const multiEngine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    const mockIsoProviderA = new MockProvider({
      script: [
        {
          thought: 'Writing to session A workspace',
          text: 'Writing file in A',
          toolCalls: [
            {
              id: 'call_a',
              name: 'write_to_file',
              arguments: { path: 'result_a.txt', content: 'RESULT_A' },
            },
          ],
        },
        { thought: 'Done A', text: 'Completed A' },
      ],
    });

    const mockIsoProviderB = new MockProvider({
      script: [
        {
          thought: 'Writing to session B workspace',
          text: 'Writing file in B',
          toolCalls: [
            {
              id: 'call_b',
              name: 'write_to_file',
              arguments: { path: 'result_b.txt', content: 'RESULT_B' },
            },
          ],
        },
        { thought: 'Done B', text: 'Completed B' },
      ],
    });

    await Promise.all([
      multiEngine.startTask('Execute task in workspace A', {
        sessionId: 'session_a',
        workspaceRoot: workspaceA,
        customProvider: mockIsoProviderA,
      }),
      multiEngine.startTask('Execute task in workspace B', {
        sessionId: 'session_b',
        workspaceRoot: workspaceB,
        customProvider: mockIsoProviderB,
      }),
    ]);

    const fileAExists = await fs.access(path.join(workspaceA, 'result_a.txt')).then(() => true).catch(() => false);
    const fileBExists = await fs.access(path.join(workspaceB, 'result_b.txt')).then(() => true).catch(() => false);
    const fileACross = await fs.access(path.join(workspaceB, 'result_a.txt')).then(() => true).catch(() => false);
    const fileBCross = await fs.access(path.join(workspaceA, 'result_b.txt')).then(() => true).catch(() => false);

    expect(fileAExists).toBe(true);
    expect(fileBExists).toBe(true);
    expect(fileACross).toBe(false);
    expect(fileBCross).toBe(false);
  });

  it('ensures targeted cancelTask never aborts unrelated sessions or fallback-kills all', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    // Session B will do work
    const mockProviderB = new MockProvider({
      script: [
        {
          thought: 'Running B step 1',
          text: 'Output B 1',
          toolCalls: [
            {
              id: 'call_b_1',
              name: 'write_to_file',
              arguments: { path: 'b_step1.txt', content: 'STEP1' },
            },
          ],
        },
        { thought: 'Running B step 2', text: 'Output B 2' },
      ],
    });

    const taskBPromise = engine.startTask('Task B running', {
      sessionId: 'session_running_b',
      customProvider: mockProviderB,
    });

    // 1. Cancelling a non-existent session must NOT cancel session_running_b
    engine.cancelTask({ sessionId: 'session_non_existent' });

    await taskBPromise;

    expect(engine.getStatus('session_running_b')).toBe('completed');
    const fileB = await fs.access(path.join(tempTestDir, 'b_step1.txt')).then(() => true).catch(() => false);
    expect(fileB).toBe(true);
  });
});

