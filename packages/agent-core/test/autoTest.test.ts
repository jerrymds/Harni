import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AgentCoreEngine,
  AutoTestRunner,
  MockProvider,
} from '../src/index.js';

describe('AutoTestRunner Unit Tests', () => {
  const tempDir = path.resolve('temp_test_autotest_runner');

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects preferred command when provided', async () => {
    const cmd = await AutoTestRunner.detectTestCommand(tempDir, 'pnpm test:unit');
    expect(cmd).toBe('pnpm test:unit');
  });

  it('detects pnpm test when package.json and pnpm-lock.yaml exist', async () => {
    const pnpmWorkspace = path.join(tempDir, 'pnpm_proj');
    await fs.mkdir(pnpmWorkspace, { recursive: true });
    await fs.writeFile(
      path.join(pnpmWorkspace, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
    );
    await fs.writeFile(path.join(pnpmWorkspace, 'pnpm-lock.yaml'), '');

    const cmd = await AutoTestRunner.detectTestCommand(pnpmWorkspace);
    expect(cmd).toBe('pnpm test');
  });

  it('detects npm test when package.json exists without custom lockfile', async () => {
    const npmWorkspace = path.join(tempDir, 'npm_proj');
    await fs.mkdir(npmWorkspace, { recursive: true });
    await fs.writeFile(
      path.join(npmWorkspace, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } }),
    );

    const cmd = await AutoTestRunner.detectTestCommand(npmWorkspace);
    expect(cmd).toBe('npm test');
  });

  it('ignores placeholder "no test specified"', async () => {
    const dummyWorkspace = path.join(tempDir, 'dummy_proj');
    await fs.mkdir(dummyWorkspace, { recursive: true });
    await fs.writeFile(
      path.join(dummyWorkspace, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );

    const cmd = await AutoTestRunner.detectTestCommand(dummyWorkspace);
    expect(cmd).toBeNull();
  });

  it('detects pytest when pytest.ini exists', async () => {
    const pyWorkspace = path.join(tempDir, 'py_proj');
    await fs.mkdir(pyWorkspace, { recursive: true });
    await fs.writeFile(path.join(pyWorkspace, 'pytest.ini'), '[pytest]');

    const cmd = await AutoTestRunner.detectTestCommand(pyWorkspace);
    expect(cmd).toBe('pytest');
  });

  it('strips ANSI escape sequences and extracts error stacktrace', () => {
    const rawWithAnsi = '\u001b[31mFAIL\u001b[39m test/calc.test.ts\n  ✕ adds 1 + 2 = 3\n    AssertionError: expected 4 to be 3\n      at /workspace/calc.test.ts:15:10';
    const clean = AutoTestRunner.stripAnsi(rawWithAnsi);
    expect(clean).not.toContain('\u001b');
    expect(clean).toContain('FAIL test/calc.test.ts');

    const stacktrace = AutoTestRunner.extractErrorStacktrace(rawWithAnsi);
    expect(stacktrace).toContain('AssertionError: expected 4 to be 3');
  });

  it('formats failure observation properly for next turn', () => {
    const observation = AutoTestRunner.formatFailureObservation({
      command: 'pnpm test',
      exitCode: 1,
      rawOutput: 'FAIL calc.test.ts\nAssertionError: expected 5 to be 4',
      retries: 1,
      maxRetries: 3,
    });

    expect(observation).toContain('[自動測試驅動修復系統 (Auto Test-Driven Repair)]');
    expect(observation).toContain('`pnpm test`');
    expect(observation).toContain('第 1 / 3 次');
    expect(observation).toContain('AssertionError: expected 5 to be 4');
    expect(observation).toContain('請調用相應代碼修改工具');
  });

  it('classifies documentation and asset files as non-code', () => {
    expect(AutoTestRunner.isCodeFile('README.md')).toBe(false);
    expect(AutoTestRunner.isCodeFile('docs/CHANGELOG.MD')).toBe(false);
    expect(AutoTestRunner.isCodeFile('notes/TODO.txt')).toBe(false);
    expect(AutoTestRunner.isCodeFile('assets/logo.png')).toBe(false);
    expect(AutoTestRunner.isCodeFile('docs\\guide.mdx')).toBe(false);
    expect(AutoTestRunner.isCodeFile('LICENSE')).toBe(false);
  });

  it('classifies source files as code', () => {
    expect(AutoTestRunner.isCodeFile('src/engine.ts')).toBe(true);
    expect(AutoTestRunner.isCodeFile('math.js')).toBe(true);
    expect(AutoTestRunner.isCodeFile('components\\Sidebar\\LeftSidebar.tsx')).toBe(true);
    expect(AutoTestRunner.isCodeFile('main.py')).toBe(true);
    expect(AutoTestRunner.isCodeFile('package.json')).toBe(true);
    expect(AutoTestRunner.isCodeFile('')).toBe(false);
  });
});

describe('AgentCoreEngine Auto Test-Driven Repair Loop', () => {
  const workspaceDir = path.resolve('temp_test_autotest_engine');

  beforeAll(async () => {
    await fs.mkdir(workspaceDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('triggers background test after code edit and performs self-correction on test failure', async () => {
    let testCallCount = 0;

    // Simulate custom terminal executor that fails on first test call, and passes on second test call
    const mockExecuteTerminal = async (command: string) => {
      testCallCount++;
      if (testCallCount === 1) {
        return {
          exitCode: 1,
          output: 'FAIL test/math.test.ts\n  ✕ add(2, 2) === 4\n    AssertionError: expected 5 to be 4\n      at test/math.test.ts:8:12',
        };
      }
      return {
        exitCode: 0,
        output: '✓ test/math.test.ts (1 test passed)',
      };
    };

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      executeTerminalCommand: mockExecuteTerminal,
    });

    // Mock Provider scripting the 2-turn self-correction conversation:
    // Turn 1: Agent writes buggy math.js (2 + 2 = 5) and tries to complete
    // Turn 2: Agent receives test failure observation, fixes math.js (2 + 2 = 4), and completes
    const mockProvider = new MockProvider({
      script: [
        // Turn 1: Agent introduces bug
        {
          thought: 'I will write math.js with a bug.',
          text: 'Writing math.js now.',
          toolCalls: [
            {
              id: 'call_write_bug',
              name: 'write_to_file',
              arguments: {
                path: 'math.js',
                content: 'export function add(a, b) { return a + b + 1; }',
              },
            },
          ],
        },
        // Turn 1 finish attempt (no tool calls) -> Engine will intercept and run test!
        {
          thought: 'math.js written, I am done.',
          text: 'Finished writing math.js.',
        },
        // Turn 2: Agent inspects observation, fixes bug
        {
          thought: 'The test failed with AssertionError: expected 5 to be 4. I need to fix the add function.',
          text: 'Fixing the add function in math.js.',
          toolCalls: [
            {
              id: 'call_fix_bug',
              name: 'replace_file_content',
              arguments: {
                path: 'math.js',
                targetContent: 'return a + b + 1;',
                replacementContent: 'return a + b;',
              },
            },
          ],
        },
        // Turn 2 finish attempt (no tool calls) -> Engine intercepts, re-runs test -> PASSES!
        {
          thought: 'Bug fixed, math.js is now correct.',
          text: 'I have repaired math.js and verified tests pass.',
        },
      ],
    });

    const statusHistory: string[] = [];
    const testResults: any[] = [];

    engine.on('task:status', (ev) => {
      statusHistory.push(ev.status);
    });
    engine.on('test:result', (ev) => {
      testResults.push(ev);
    });

    await engine.startTask('Implement and test math.js', {
      customProvider: mockProvider,
      autoTest: true,
      testCommand: 'pnpm test:math',
    });

    // Verify test was executed twice
    expect(testCallCount).toBe(2);

    // Verify 'testing' status was emitted during verification
    expect(statusHistory).toContain('testing');
    expect(statusHistory[statusHistory.length - 1]).toBe('completed');

    // Verify test results
    expect(testResults.length).toBe(2);
    expect(testResults[0].passed).toBe(false);
    expect(testResults[0].exitCode).toBe(1);
    expect(testResults[1].passed).toBe(true);
    expect(testResults[1].exitCode).toBe(0);

    // Verify math.js content was fixed
    const content = await fs.readFile(path.join(workspaceDir, 'math.js'), 'utf-8');
    expect(content).toContain('return a + b;');
    expect(content).not.toContain('return a + b + 1;');
  });

  it('gracefully aborts and notifies user when maxTestRetries is reached', async () => {
    // Persistent failing test
    const mockExecuteTerminal = async () => ({
      exitCode: 1,
      output: 'FAIL test/always_fails.test.ts\n  ✕ Fatal error: syntax error in config',
    });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      executeTerminalCommand: mockExecuteTerminal,
    });

    const mockProvider = new MockProvider({
      script: [
        // Turn 1: Write file
        {
          thought: 'Writing broken code',
          text: 'Writing broken code',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_to_file',
              arguments: { path: 'broken.js', content: 'invalid code' },
            },
          ],
        },
        // Turn 1 complete -> Test fail (Retry 1)
        { text: 'Done 1' },
        // Turn 2 retry -> Test fail (Retry 2)
        { text: 'Retrying fix 1' },
        // Turn 3 retry -> Test fail (Retry 3) -> Max retries reached!
        { text: 'Retrying fix 2' },
      ],
    });

    await engine.startTask('Fix broken code', {
      customProvider: mockProvider,
      autoTest: true,
      testCommand: 'pnpm test',
      maxTestRetries: 2,
    });

    const taskState = engine.getTaskState();
    expect(taskState?.status).toBe('completed');

    // Verify the give up message was added
    const messages = taskState?.messages || [];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg?.content).toContain('自動測試驅動修復已達重試上限');
  });

  it('bypasses test runner when autoTest is false', async () => {
    let testCalled = false;
    const mockExecuteTerminal = async () => {
      testCalled = true;
      return { exitCode: 0, output: 'passed' };
    };

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      executeTerminalCommand: mockExecuteTerminal,
    });

    const mockProvider = new MockProvider({
      script: [
        {
          text: 'Creating doc',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_to_file',
              arguments: { path: 'README.md', content: '# Docs' },
            },
          ],
        },
        { text: 'Done' },
      ],
    });

    await engine.startTask('Create doc', {
      customProvider: mockProvider,
      autoTest: false,
      testCommand: 'pnpm test',
    });

    expect(testCalled).toBe(false);
    expect(engine.getTaskState()?.status).toBe('completed');
  });

  it('skips auto test-driven repair when only non-code files (.md) are edited', async () => {
    let testCalled = false;
    const mockExecuteTerminal = async () => {
      testCalled = true;
      return { exitCode: 1, output: 'FAIL docs.test.ts' };
    };

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      executeTerminalCommand: mockExecuteTerminal,
    });

    const mockProvider = new MockProvider({
      script: [
        {
          text: 'Documenting the module',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_to_file',
              arguments: { path: 'docs/GUIDE.md', content: '# Guide' },
            },
            {
              id: 'c2',
              name: 'replace_file_content',
              arguments: {
                path: 'docs/GUIDE.md',
                targetContent: '# Guide',
                replacementContent: '# Guide\n\nUpdated.',
              },
            },
          ],
        },
        { text: 'Docs finished' },
      ],
    });

    await engine.startTask('Update documentation', {
      customProvider: mockProvider,
      autoTest: true,
      testCommand: 'pnpm test',
    });

    expect(testCalled).toBe(false);
    expect(engine.getTaskState()?.status).toBe('completed');
  });
});
