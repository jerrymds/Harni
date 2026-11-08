import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AgentCoreEngine,
  MockProvider,
  ContrastiveProbeRunner,
  normalizeToolCall,
  type ContrastiveProbeResult,
  type ProbeCandidate,
  type SubagentExecutionResult,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('Step B: AgentCoreEngine Harness² Integration Tests', () => {
  const testRoot = path.join(os.tmpdir(), `harni_test_harness_engine_${Date.now()}`);
  const workspaceDir = path.join(testRoot, 'workspace');
  const storageDir = path.join(testRoot, 'experiences');

  beforeAll(async () => {
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(storageDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('1. Retrieves relevant experiences and injects them into systemPrompt when experienceLearningEnabled is true', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: storageDir,
    });

    expect(engine.experienceManager).toBeDefined();

    // Pre-seed an experience in the experience manager
    await engine.experienceManager!.saveExperience({
      title: 'Fix React useEffect memory leak with cleanup function',
      summary: 'Always return a cancellation function in useEffect to avoid memory leaks.',
      category: 'bug_fix',
      triggerCondition: 'When writing useEffect with subscriptions',
      actionableGuidance: 'Return unsubscribe or cleanup callback inside useEffect.',
      tags: ['react', 'useeffect', 'memory-leak'],
      confidenceScore: 0.95,
    });

    let capturedSystemPrompt = '';
    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'Understood.',
          text: 'I will handle the React memory leak task.',
        },
      ],
    });

    const originalStream = mockProvider.streamCompletion.bind(mockProvider);
    mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      capturedSystemPrompt = systemPrompt;
      return originalStream(messages, systemPrompt, tools, onChunk, signal);
    };

    await engine.startTask('How to fix React useEffect memory leak issue?', {
      customProvider: mockProvider,
    });

    // Verify systemPrompt contains the Harness Learned Experiences section
    expect(capturedSystemPrompt).toContain('==== HARNESS LEARNED EXPERIENCES ====');
    expect(capturedSystemPrompt).toContain('Fix React useEffect memory leak with cleanup function');
    expect(capturedSystemPrompt).toContain('Return unsubscribe or cleanup callback inside useEffect.');
  });

  it('2. Automatically synthesizes and persists experience when task is completed and code was modified', async () => {
    const expSubdir = path.join(testRoot, 'experiences_auto_save');
    await fs.mkdir(expSubdir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: expSubdir,
      autoTestEnabled: false, // disable auto test for this specific flow
    });

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'Writing a helper module.',
          text: 'Writing string utility.',
          toolCalls: [
            {
              id: 'call_write_1',
              name: 'write_to_file',
              arguments: {
                path: 'utils/stringHelper.ts',
                content: 'export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);',
              },
            },
          ],
        },
        {
          thought: 'Finished implementation.',
          text: 'Helper module stringHelper.ts has been created.',
        },
      ],
    });

    await engine.startTask('Implement string capitalization utility function in utils/stringHelper.ts', {
      customProvider: mockProvider,
    });

    const taskState = engine.getTaskState();
    expect(taskState?.status).toBe('completed');

    // Verify experience was saved by searching through experienceManager
    const saved = await engine.experienceManager!.searchExperiences({
      query: 'capitalize stringHelper',
      limit: 5,
    });

    expect(saved.length).toBeGreaterThan(0);
    const exp = saved[0];
    expect(exp.title.toLowerCase()).toContain('capitaliz');
    expect(exp.relatedFiles).toBeDefined();
    expect(exp.relatedFiles).toContain('utils/stringHelper.ts');
    expect(exp.actionableGuidance).toContain('stringHelper.ts');
  });

  it('3. Does not synthesize experiences when task was cancelled or no code was modified', async () => {
    const expSubdir = path.join(testRoot, 'experiences_no_save');
    await fs.mkdir(expSubdir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: expSubdir,
      autoTestEnabled: false,
    });

    // 3a. Read-only task without code modifications or errors
    const readOnlyProvider = new MockProvider({
      script: [
        {
          thought: 'Reading files only.',
          text: 'Reading list of files.',
          toolCalls: [
            {
              id: 'call_list_1',
              name: 'list_files',
              arguments: { path: '.' },
            },
          ],
        },
        {
          thought: 'Done reading.',
          text: 'All files inspected.',
        },
      ],
    });

    await engine.startTask('List all files in workspace directory', {
      customProvider: readOnlyProvider,
    });

    let exps = await engine.experienceManager!.searchExperiences({ query: 'List all files', limit: 5 });
    expect(exps.length).toBe(0);

    // 3b. Cancelled task
    const cancelProvider = new MockProvider({
      script: [
        {
          thought: 'Writing something before cancel.',
          text: 'Writing draft.',
          toolCalls: [
            {
              id: 'call_write_cancel',
              name: 'write_to_file',
              arguments: { path: 'draft.ts', content: 'export const draft = 1;' },
            },
          ],
        },
      ],
    });

    // Cancel immediately when executing tool
    const cancelHandler = (ev: { status: string }) => {
      if (ev.status === 'executing_tool') {
        engine.cancelTask();
        engine.off('task:status', cancelHandler);
      }
    };
    engine.on('task:status', cancelHandler);

    await engine.startTask('Draft something then cancel', {
      customProvider: cancelProvider,
    });

    exps = await engine.experienceManager!.searchExperiences({ query: 'Draft something', limit: 5 });
    expect(exps.length).toBe(0);
  });

  it('4. Triggers contrastive probe evaluation and emits probe:result when auto-test reaches max retries with >=2 diff snapshots', async () => {
    const gitWorkspace = path.join(testRoot, 'git_probe_repo');
    await fs.mkdir(gitWorkspace, { recursive: true });

    // Initialize git repository
    await execFileAsync('git', ['init'], { cwd: gitWorkspace });
    await execFileAsync('git', ['config', 'user.email', 'harni-test@example.com'], { cwd: gitWorkspace });
    await execFileAsync('git', ['config', 'user.name', 'Harni Test'], { cwd: gitWorkspace });

    const targetFile = path.join(gitWorkspace, 'calc.ts');
    await fs.writeFile(targetFile, 'export function add(a: number, b: number) { return a + b; }\n');
    await execFileAsync('git', ['add', '.'], { cwd: gitWorkspace });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: gitWorkspace });

    // Mock terminal command to always fail the test
    const mockExecuteTerminal = async () => ({
      exitCode: 1,
      output: 'FAIL calc.test.ts: Expected 42, received NaN\n  at Object.<anonymous> (calc.test.ts:10:5)',
    });

    const expFailDir = path.join(testRoot, `experiences_failed_task_${Date.now()}`);
    await fs.mkdir(expFailDir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: gitWorkspace,
      executeTerminalCommand: mockExecuteTerminal,
      autoTestEnabled: true,
      maxTestRetries: 1,
      experienceLearningEnabled: true,
      experienceStorageDir: expFailDir,
    });

    // Mock Provider creates two different modifications to produce 2 different diff snapshots
    const mockProvider = new MockProvider({
      script: [
        // Turn 1: First attempt
        {
          thought: 'First repair attempt',
          text: 'Trying repair attempt 1',
          toolCalls: [
            {
              id: 'call_repair_1',
              name: 'write_to_file',
              arguments: { path: 'calc.ts', content: 'export function add(a: number, b: number) { return a + b + 1; }\n' },
            },
          ],
        },
        // Turn 1 complete -> No tool calls -> Auto test runs -> Fails -> Retry 1
        {
          thought: 'Done attempt 1',
          text: 'Attempt 1 done',
        },
        // Turn 2: Second attempt after test failure observation
        {
          thought: 'Second repair attempt',
          text: 'Trying repair attempt 2',
          toolCalls: [
            {
              id: 'call_repair_2',
              name: 'write_to_file',
              arguments: { path: 'calc.ts', content: 'export function add(a: number, b: number) { return a + b + 2; }\n' },
            },
          ],
        },
        // Turn 2 complete -> No tool calls -> Auto test runs -> Fails -> Retry 2 reached (>= maxRetries 1)!
        {
          thought: 'Done attempt 2',
          text: 'Attempt 2 done',
        },
      ],
    });

    const originalStream = mockProvider.streamCompletion.bind(mockProvider);
    mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      const lastMsg = messages[messages.length - 1];
      if (
        lastMsg &&
        typeof lastMsg.content === 'string' &&
        lastMsg.content.toLowerCase().includes('side-by-side')
      ) {
        return {
          text: JSON.stringify({
            winnerId: 'attempt_2',
            winnerName: '修復嘗試方案 2',
            confidence: 0.9,
            comparisonSummary: '方案 2 比方案 1 更接近正確結果',
            rationale: '邏輯修正更合理',
            candidateScores: {
              attempt_1: { candidateId: 'attempt_1', correctness: 60, minimalInvasiveness: 70, safety: 80, maintainability: 70, pros: [], cons: [] },
              attempt_2: { candidateId: 'attempt_2', correctness: 85, minimalInvasiveness: 90, safety: 90, maintainability: 85, pros: ['接近成功'], cons: [] },
            },
            improvementSuggestions: ['檢查運算邊界條件'],
          }),
        };
      }
      return originalStream(messages, systemPrompt, tools, onChunk, signal);
    };

    let probeResultEmitted: ContrastiveProbeResult | null = null;
    engine.on('probe:result', (ev) => {
      probeResultEmitted = ev.result;
    });

    await engine.startTask('Fix calculation test failure in calc.ts', {
      customProvider: mockProvider,
      autoTest: true,
      testCommand: 'pnpm test:calc',
      maxTestRetries: 1,
    });

    const taskState = engine.getTaskState();
    expect(taskState?.status).toBe('completed');

    // R1 negative: Exceeding max retries must NOT save an experience
    const savedExperiences = await engine.experienceManager!.searchExperiences();
    expect(savedExperiences.length).toBe(0);

    // Verify probe:result event was emitted
    expect(probeResultEmitted).not.toBeNull();
    expect(probeResultEmitted!.winnerName).toBeDefined();
    expect(probeResultEmitted!.comparisonSummary).toBeDefined();

    // Verify assistant's final limitMsg contains probe recommendations
    const messages = taskState?.messages || [];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg?.content).toContain('自動測試驅動修復已達重試上限');
    expect(lastMsg?.content).toContain('對比探測評估建議');
    expect(lastMsg?.content).toContain('推薦最佳方案');
  });

  it('5. Allows invoking contrastive_probe tool directly and produces evaluation result', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
    });

    const registry = engine.getToolRegistry();
    const probeTool = registry.getTool('contrastive_probe');
    expect(probeTool).toBeDefined();
    expect(probeTool?.name).toBe('contrastive_probe');

    const candidates: ProbeCandidate[] = [
      {
        id: 'c1',
        name: 'Early return check',
        description: 'Check null early at function start',
        codeSnippets: [
          {
            file: 'src/handler.ts',
            content: 'export function handle(x: string | null) { if (!x) return null; return x.trim(); }',
          },
        ],
      },
      {
        id: 'c2',
        name: 'Optional chaining',
        description: 'Use optional chaining operator',
        codeSnippets: [
          {
            file: 'src/handler.ts',
            content: 'export function handle(x: string | null) { return x?.trim() ?? null; }',
          },
        ],
      },
    ];

    // 5a. Call with context.runContrastiveProbe
    const toolResWithContext = await registry.executeTool(
      'contrastive_probe',
      {
        taskDescription: 'Prevent null pointer exception when trimming string input',
        candidates,
      },
      {
        workspaceRoot: workspaceDir,
        runContrastiveProbe: async (params) => {
          return ContrastiveProbeRunner.evaluateCandidates({
            taskDescription: params.taskDescription,
            candidates: params.candidates,
            llmCaller: async () =>
              JSON.stringify({
                winnerId: 'c2',
                winnerName: 'Optional chaining',
                confidence: 0.9,
                comparisonSummary: 'Optional chaining is idiomatic and clean.',
                rationale: 'More concise with fewer branches.',
                candidateScores: {
                  c1: { correctness: 85, minimalInvasiveness: 80, safety: 90, maintainability: 80, pros: [], cons: [] },
                  c2: { correctness: 95, minimalInvasiveness: 95, safety: 95, maintainability: 95, pros: [], cons: [] },
                },
                improvementSuggestions: ['Add unit tests for empty strings'],
              }),
          });
        },
      },
    );

    expect(toolResWithContext.isError).toBeFalsy();
    expect(toolResWithContext.summary).toContain('Optional chaining');
    const parsedRes = JSON.parse(String(toolResWithContext.output));
    expect(parsedRes.winnerId).toBe('c2');
    expect(parsedRes.confidence).toBe(0.9);

    // 5b. Call without context.runContrastiveProbe (fallback mode)
    const toolResFallback = await registry.executeTool(
      'contrastive_probe',
      {
        taskDescription: 'Prevent null pointer exception',
        candidates,
      },
      {
        workspaceRoot: workspaceDir,
      },
    );

    expect(toolResFallback.isError).toBeFalsy();
    const fallbackParsed = JSON.parse(String(toolResFallback.output));
    expect(fallbackParsed.status).toBe('ok');
    expect(fallbackParsed.winnerId).toBeDefined();

    // 5c. Validation error on empty candidates
    const emptyRes = await registry.executeTool(
      'contrastive_probe',
      {
        taskDescription: 'Empty test',
        candidates: [],
      },
      {
        workspaceRoot: workspaceDir,
      },
    );
    expect(emptyRes.isError).toBe(true);
    expect(emptyRes.output).toContain('錯誤');
  });

  it('6. Synthesizes and saves experience when auto-test passes after modifying code (R1 positive)', async () => {
    const expSubdir = path.join(testRoot, `experiences_autotest_pass_${Date.now()}`);
    await fs.mkdir(expSubdir, { recursive: true });

    const mockExecuteTerminal = async () => ({
      exitCode: 0,
      output: 'PASS calc.test.ts (all tests passed)',
    });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: expSubdir,
      autoTestEnabled: true,
      executeTerminalCommand: mockExecuteTerminal,
    });

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'Fixing the math bug in math.ts',
          text: 'Updating math implementation.',
          toolCalls: [
            {
              id: 'call_write_math',
              name: 'write_to_file',
              arguments: {
                path: 'math.ts',
                content: 'export function multiply(a: number, b: number) { return a * b; }\n',
              },
            },
          ],
        },
        {
          thought: 'Task finished and test passed.',
          text: 'Fixed the math bug successfully.',
        },
      ],
    });

    await engine.startTask('Fix multiplication logic in math.ts', {
      customProvider: mockProvider,
      autoTest: true,
      testCommand: 'pnpm test:math',
    });

    const taskState = engine.getTaskState();
    expect(taskState?.status).toBe('completed');

    const allExp = await engine.experienceManager!.searchExperiences();
    expect(allExp.length).toBe(1);
    expect(allExp[0].title).toContain('Fix multiplication logic');
    expect(allExp[0].relatedFiles).toBeDefined();
    expect(allExp[0].relatedFiles).toContain('math.ts');
  });

  it('7. Multi-turn prompt lookup and experience synthesis uses current turn prompt (R2)', async () => {
    const expSubdir = path.join(testRoot, `experiences_multiturn_${Date.now()}`);
    await fs.mkdir(expSubdir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: expSubdir,
      autoTestEnabled: false,
    });

    // Pre-seed an experience about database caching
    await engine.experienceManager!.saveExperience({
      id: 'exp-db-caching',
      title: 'Database Redis caching pattern',
      summary: 'Use redis cache-aside for SQL queries',
      category: 'architectural',
      actionableGuidance: 'Wrap query with cache.get and set',
      tags: ['redis', 'caching'],
    });

    let turn1CapturedSystemPrompt = '';
    let turn2CapturedSystemPrompt = '';

    const mockProvider = new MockProvider({
      script: [
        // Turn 1 response (read-only, no code edit)
        {
          thought: 'Explaining design architecture.',
          text: 'Here is how microservices communicate over gRPC.',
        },
        // Turn 2 response (modifies code)
        {
          thought: 'Implementing Redis caching helper.',
          text: 'Created cache helper.',
          toolCalls: [
            {
              id: 'call_write_cache',
              name: 'write_to_file',
              arguments: {
                path: 'cache.ts',
                content: 'export class RedisCache { get() {} set() {} }\n',
              },
            },
          ],
        },
        // Turn 2 finish
        {
          thought: 'Done implementing cache.',
          text: 'Finished cache implementation.',
        },
      ],
    });

    const originalStream = mockProvider.streamCompletion.bind(mockProvider);
    let callCount = 0;
    mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      callCount++;
      if (callCount === 1) {
        turn1CapturedSystemPrompt = systemPrompt;
      } else if (callCount === 2) {
        turn2CapturedSystemPrompt = systemPrompt;
      }
      return originalStream(messages, systemPrompt, tools, onChunk, signal);
    };

    const sessionId = 'session_multiturn_r2';

    // Turn 1: Question about gRPC (Topic A, read-only)
    await engine.startTask('How does gRPC work in microservices?', {
      sessionId,
      customProvider: mockProvider,
    });

    expect(turn1CapturedSystemPrompt).not.toContain('Database Redis caching pattern');

    // Turn 2: Code task about Redis caching (Topic B, code edit)
    await engine.startTask('Implement Redis caching helper for database queries', {
      sessionId,
      customProvider: mockProvider,
    });

    // In Turn 2, experience retrieval should have queried with Turn 2 prompt and retrieved Redis caching!
    expect(turn2CapturedSystemPrompt).toContain('Database Redis caching pattern');

    // And auto-synthesized experience should be about Topic B (Turn 2 prompt), NOT Topic A!
    const allExp = await engine.experienceManager!.searchExperiences();
    const synthesized = allExp.find((e) => e.id !== 'exp-db-caching');
    expect(synthesized).toBeDefined();
    expect(synthesized!.title).toContain('Redis caching');
    expect(synthesized!.title).not.toContain('gRPC');
  });

  it('8. Workspace switching isolates experience storage directory per workspace root (R3)', async () => {
    const ws1Dir = path.join(testRoot, 'ws1');
    const ws2Dir = path.join(testRoot, 'ws2');
    const baseStorage = path.join(testRoot, 'experiences_workspaces');
    await fs.mkdir(ws1Dir, { recursive: true });
    await fs.mkdir(ws2Dir, { recursive: true });
    await fs.mkdir(baseStorage, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: ws1Dir,
      experienceLearningEnabled: true,
      experienceStorageDir: baseStorage,
    });

    const mgr1 = engine.experienceManager;
    expect(mgr1).toBeDefined();

    // Save an experience in Workspace 1
    await mgr1!.saveExperience({
      id: 'ws1-exp',
      title: 'Workspace 1 specific pattern',
      summary: 'Pattern for project 1',
      category: 'workflow',
      actionableGuidance: 'Apply ws1 pattern',
      tags: ['ws1'],
    });

    const ws1ResultsBefore = await mgr1!.searchExperiences();
    expect(ws1ResultsBefore.some((e) => e.id === 'ws1-exp')).toBe(true);

    // Switch workspace to ws2
    engine.setWorkspaceRoot(ws2Dir);
    const mgr2 = engine.experienceManager;
    expect(mgr2).toBeDefined();
    expect(mgr2).not.toBe(mgr1);

    // Workspace 2 storage should be empty and isolated from Workspace 1
    const ws2Results = await mgr2!.searchExperiences();
    expect(ws2Results.some((e) => e.id === 'ws1-exp')).toBe(false);

    // Save an experience in Workspace 2
    await mgr2!.saveExperience({
      id: 'ws2-exp',
      title: 'Workspace 2 specific pattern',
      summary: 'Pattern for project 2',
      category: 'bug_fix',
      actionableGuidance: 'Apply ws2 pattern',
      tags: ['ws2'],
    });

    const ws2ResultsAfter = await mgr2!.searchExperiences();
    expect(ws2ResultsAfter.some((e) => e.id === 'ws2-exp')).toBe(true);

    // Switch back to ws1
    engine.setWorkspaceRoot(ws1Dir);
    const mgr1Again = engine.experienceManager;
    expect(mgr1Again).toBe(mgr1);
    const ws1ResultsAfter = await mgr1Again!.searchExperiences();
    expect(ws1ResultsAfter.some((e) => e.id === 'ws1-exp')).toBe(true);
    expect(ws1ResultsAfter.some((e) => e.id === 'ws2-exp')).toBe(false);
  });

  it('9. Emits probe:result event when contrastive_probe tool is invoked within engine task (R6)', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
    });

    const candidates: ProbeCandidate[] = [
      {
        id: 'opt_a',
        name: 'Option A',
        description: 'Option A solution',
      },
      {
        id: 'opt_b',
        name: 'Option B',
        description: 'Option B solution',
      },
    ];

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'Running contrastive probe.',
          text: 'Evaluating candidate options.',
          toolCalls: [
            {
              id: 'call_probe_1',
              name: 'contrastive_probe',
              arguments: {
                taskDescription: 'Choose between Option A and Option B',
                candidates,
              },
            },
          ],
        },
        {
          thought: 'Completed probe.',
          text: 'Option B was selected as best.',
        },
      ],
    });

    const originalStream = mockProvider.streamCompletion.bind(mockProvider);
    mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      const lastMsg = messages[messages.length - 1];
      if (
        lastMsg &&
        typeof lastMsg.content === 'string' &&
        lastMsg.content.toLowerCase().includes('side-by-side')
      ) {
        return {
          text: JSON.stringify({
            winnerId: 'opt_b',
            winnerName: 'Option B',
            confidence: 0.95,
            comparisonSummary: 'Option B is more maintainable.',
            rationale: 'Clean architecture.',
            candidateScores: {
              opt_a: { candidateId: 'opt_a', correctness: 80, minimalInvasiveness: 80, safety: 80, maintainability: 80, pros: [], cons: [] },
              opt_b: { candidateId: 'opt_b', correctness: 95, minimalInvasiveness: 90, safety: 95, maintainability: 95, pros: [], cons: [] },
            },
          }),
        };
      }
      return originalStream(messages, systemPrompt, tools, onChunk, signal);
    };

    let emittedProbePayload: any = null;
    engine.on('probe:result', (ev) => {
      emittedProbePayload = ev;
    });

    await engine.startTask('Compare Option A and Option B', {
      customProvider: mockProvider,
    });

    expect(emittedProbePayload).not.toBeNull();
    expect(emittedProbePayload.sessionId).toBeDefined();
    expect(emittedProbePayload.taskId).toBeDefined();
    expect(emittedProbePayload.result.winnerId).toBe('opt_b');
    expect(emittedProbePayload.result.winnerName).toBe('Option B');
  });

  it('10. Subagent dynamic harness injects tailored scope and experiences when subagent is spawned (T1)', async () => {
    const expSubdir = path.join(testRoot, 'experiences_subagent_t1');
    await fs.mkdir(expSubdir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: expSubdir,
    });

    await engine.experienceManager!.saveExperience({
      title: 'PostgreSQL connection timeout resolution',
      summary: 'Increase connection pool timeout and retry on transient drop.',
      category: 'database',
      triggerCondition: 'When configuring database pool connection timeout',
      actionableGuidance: 'Configure connectionTimeoutMillis: 5000 in pool options.',
      tags: ['postgres', 'timeout', 'database'],
      confidenceScore: 0.95,
    });

    let capturedSubagentPrompt = '';
    const subMockProvider = new MockProvider({
      script: [
        {
          thought: 'Subagent running task.',
          text: 'Database configuration complete.',
        },
      ],
    });

    const originalSubStream = subMockProvider.streamCompletion.bind(subMockProvider);
    subMockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      capturedSubagentPrompt = systemPrompt;
      return originalSubStream(messages, systemPrompt, tools, onChunk, signal);
    };

    const results = await engine.getSubagentManager().spawnSubagents([
      {
        typeName: 'coder',
        role: 'Database Configurator',
        prompt: 'Configure database pool connection timeout settings',
        customProvider: subMockProvider,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(capturedSubagentPrompt).toContain('==== HARNESS TAILORED SUBAGENT SCOPE ====');
    expect(capturedSubagentPrompt).toContain('Role: Database Configurator');
    expect(capturedSubagentPrompt).toContain('==== HARNESS LEARNED EXPERIENCES ====');
    expect(capturedSubagentPrompt).toContain('PostgreSQL connection timeout resolution');
    expect(capturedSubagentPrompt).toContain('Configure connectionTimeoutMillis: 5000 in pool options.');
  });

  it('11. Read-only task encountering read errors does NOT auto-synthesize experience if code was not modified (T2)', async () => {
    const expSubdir = path.join(testRoot, 'experiences_readonly_no_save');
    await fs.mkdir(expSubdir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: expSubdir,
      autoTestEnabled: false,
    });

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'Trying to read non-existent file.',
          text: 'Reading missing file...',
          toolCalls: [
            {
              id: 'call_read_missing',
              name: 'read_file',
              arguments: {
                path: 'does_not_exist_file.txt',
              },
            },
          ],
        },
        {
          thought: 'File does not exist, finished investigation.',
          text: 'Investigation finished: file not found.',
        },
      ],
    });

    await engine.startTask('Inspect missing configuration file', {
      customProvider: mockProvider,
    });

    const saved = await engine.experienceManager!.searchExperiences({ query: 'missing configuration', limit: 10 });
    expect(saved).toHaveLength(0);
  });

  it('12. Rollback resets modified code tracking state and toolAdapter normalizes contrastive_probe (T3 & T4)', async () => {
    // T4 normalization check
    const rawArgs = {
      TaskDescription: 'Select best implementation strategy',
      Candidates: [
        { id: '1', name: 'Strategy A' },
        { id: '2', name: 'Strategy B' },
      ],
    };
    const { name, arguments: normalized } = normalizeToolCall('contrastive_probe', rawArgs);
    expect(name).toBe('contrastive_probe');
    expect(normalized.taskDescription).toBe('Select best implementation strategy');
    expect(normalized.candidates).toHaveLength(2);

    // T3 rollback check
    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      gitCheckpointEnabled: true,
    });

    // Create session task
    const sessionId = 'test_session_t3';
    const sessionTask: any = {
      sessionId,
      workspaceRoot: workspaceDir,
      mainWorkspaceRoot: workspaceDir,
      codeModified: true,
      hasModifiedCodeInTask: true,
      modifiedFiles: new Set(['some/file.ts']),
      isWorktree: false,
    };
    (engine as any).tasksBySession.set(sessionId, sessionTask);

    // Mock gitCheckpointService.rollbackCheckpoint to return success
    (engine as any).gitCheckpointService.rollbackCheckpoint = async () => ({
      success: true,
      message: 'Rollback succeeded',
    });

    const res = await engine.rollbackCheckpoint(sessionId, 'cp_123');
    expect(res.success).toBe(true);
    expect(sessionTask.codeModified).toBe(false);
    expect(sessionTask.hasModifiedCodeInTask).toBe(false);
    expect(sessionTask.modifiedFiles.size).toBe(0);

    // T3 discardWorktree check
    sessionTask.codeModified = true;
    sessionTask.hasModifiedCodeInTask = true;
    sessionTask.modifiedFiles.add('wt/file.ts');
    sessionTask.isWorktree = true;

    (engine as any).gitCheckpointService.discardWorktree = async () => ({
      success: true,
      message: 'Worktree discarded',
    });

    const discardRes = await engine.discardWorktree(sessionId);
    expect(discardRes.success).toBe(true);
    expect(sessionTask.codeModified).toBe(false);
    expect(sessionTask.hasModifiedCodeInTask).toBe(false);
    expect(sessionTask.modifiedFiles.size).toBe(0);
    expect(sessionTask.isWorktree).toBe(false);
  });

  it('13. Subagent spawned in worktree session gets experiences resolved via session mainWorkspaceRoot (U1)', async () => {
    const mainWorkspaceDir = path.join(testRoot, 'main_workspace_u1');
    const worktreeDir = path.join(testRoot, 'worktree_u1');
    const u1StorageDir = path.join(testRoot, 'experiences_u1');
    await fs.mkdir(mainWorkspaceDir, { recursive: true });
    await fs.mkdir(worktreeDir, { recursive: true });
    await fs.mkdir(u1StorageDir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: mainWorkspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: u1StorageDir,
    });

    // Save an experience under mainWorkspaceDir's manager
    await engine.experienceManager!.saveExperience({
      title: 'Fix Redis socket hangup in connection pool',
      summary: 'Increase connectTimeout and keepAlive settings.',
      category: 'bug_fix',
      triggerCondition: 'When configuring Redis client pool',
      actionableGuidance: 'Set keepAlive: 30000 and connectTimeout: 10000 in RedisOptions.',
      tags: ['redis', 'timeout'],
      confidenceScore: 0.95,
    });

    // Set up a session task with a different workspaceRoot (simulating worktree isolation)
    const sessionId = 'session_worktree_u1';
    const sessionTask: any = {
      sessionId,
      workspaceRoot: worktreeDir,
      mainWorkspaceRoot: mainWorkspaceDir,
      taskState: { status: 'running' },
      codeModified: false,
      hasModifiedCodeInTask: false,
      modifiedFiles: new Set<string>(),
      isWorktree: true,
      subagentTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
    (engine as any).tasksBySession.set(sessionId, sessionTask);

    let capturedSubagentPrompt = '';
    const subMockProvider = new MockProvider({
      script: [
        {
          thought: 'Subagent running in worktree.',
          text: 'Redis configured.',
        },
      ],
    });

    const originalSubStream = subMockProvider.streamCompletion.bind(subMockProvider);
    subMockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      capturedSubagentPrompt = systemPrompt;
      return originalSubStream(messages, systemPrompt, tools, onChunk, signal);
    };

    // Subagent is spawned with workspaceRoot = worktreeDir, sessionId = sessionId
    const results = await engine.getSubagentManager().spawnSubagents([
      {
        typeName: 'coder',
        role: 'Redis Engineer',
        prompt: 'Fix Redis socket hangup connection pool timeout issue',
        workspaceRoot: worktreeDir,
        sessionId,
        customProvider: subMockProvider,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(capturedSubagentPrompt).toContain('==== HARNESS LEARNED EXPERIENCES ====');
    expect(capturedSubagentPrompt).toContain('Fix Redis socket hangup in connection pool');
    expect(capturedSubagentPrompt).toContain('Set keepAlive: 30000 and connectTimeout: 10000 in RedisOptions.');
  });

  it('14. Coder subagent retains execute_command and ask_question in scoped tool registry for surgical edit task (U2)', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      dynamicHarnessEnabled: true,
    });

    let capturedTools: import('@harni/types').ToolDefinition[] = [];
    const subMockProvider = new MockProvider({
      script: [
        {
          thought: 'Fixing typo.',
          text: 'Typo fixed.',
        },
      ],
    });

    const originalSubStream = subMockProvider.streamCompletion.bind(subMockProvider);
    subMockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      capturedTools = tools;
      return originalSubStream(messages, systemPrompt, tools, onChunk, signal);
    };

    const results = await engine.getSubagentManager().spawnSubagents([
      {
        typeName: 'coder',
        role: 'Typo Fixer',
        prompt: 'Fix typo in docs and replace word in README.md',
        customProvider: subMockProvider,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    const toolNames = capturedTools.map((t) => t.name);
    expect(toolNames).toContain('execute_command');
    expect(toolNames).toContain('ask_question');
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_to_file');
    expect(toolNames).toContain('replace_file_content');

    // Also verify directly on the instance's tool registry
    const instance = engine.getSubagentManager().getInstance(results[0].id);
    expect(instance).toBeDefined();
    expect(instance!.getToolRegistry().getTool('execute_command')).toBeDefined();
    expect(instance!.getToolRegistry().getTool('ask_question')).toBeDefined();

    // Also test reviewer retains execute_command but has no write tools
    let reviewerTools: import('@harni/types').ToolDefinition[] = [];
    const revMockProvider = new MockProvider({
      script: [{ text: 'Review complete.' }],
    });
    revMockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      reviewerTools = tools;
      return originalSubStream(messages, systemPrompt, tools, onChunk, signal);
    };

    const revResults = await engine.getSubagentManager().spawnSubagents([
      {
        typeName: 'reviewer',
        role: 'Reviewer',
        prompt: 'Fix typo review in documentation',
        customProvider: revMockProvider,
      },
    ]);
    expect(revResults[0].status).toBe('completed');
    const revToolNames = reviewerTools.map((t) => t.name);
    expect(revToolNames).toContain('execute_command');
    expect(revToolNames).toContain('ask_question');
    expect(revToolNames).not.toContain('write_to_file');
    expect(revToolNames).not.toContain('replace_file_content');
  });

  it('15. Disabling dynamicHarnessEnabled preserves plain system prompt without harness scope block (U3)', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      dynamicHarnessEnabled: false,
    });

    let capturedPrompt = '';
    const subMockProvider = new MockProvider({
      script: [
        {
          text: 'Done.',
        },
      ],
    });

    const originalSubStream = subMockProvider.streamCompletion.bind(subMockProvider);
    subMockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      capturedPrompt = systemPrompt;
      return originalSubStream(messages, systemPrompt, tools, onChunk, signal);
    };

    const results = await engine.getSubagentManager().spawnSubagents([
      {
        typeName: 'coder',
        role: 'Code Implementer',
        prompt: 'Fix typo in documentation',
        customProvider: subMockProvider,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(capturedPrompt).not.toContain('==== HARNESS TAILORED SUBAGENT SCOPE ====');
    expect(capturedPrompt).not.toContain('HARNESS TAILORED SUBAGENT SCOPE');
    expect(capturedPrompt).toContain('You are a specialized Code Implementer subagent');
  });

  it('16. ExperienceManager cache caps at 20 entries, evicts oldest, and preserves default experienceManager (U3)', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      experienceLearningEnabled: true,
      experienceStorageDir: storageDir,
    });

    const defaultMgr = engine.experienceManager;
    expect(defaultMgr).toBeDefined();

    const managersByRoot = (engine as any).experienceManagersByRoot as Map<string, any>;
    expect(managersByRoot.size).toBe(1);

    // Access 25 distinct roots
    const rootPaths: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const dir = path.join(testRoot, `fake_workspace_${i}`);
      rootPaths.push(path.resolve(dir));
      const mgr = (engine as any).getExperienceManagerForRoot(dir);
      expect(mgr).toBeDefined();
    }

    // Cache must be capped at 20 entries
    expect(managersByRoot.size).toBe(20);

    // Default workspace manager must NEVER have been evicted
    expect(managersByRoot.has(path.resolve(workspaceDir))).toBe(true);
    expect(managersByRoot.get(path.resolve(workspaceDir))).toBe(defaultMgr);
    expect((engine as any).getExperienceManagerForRoot(workspaceDir)).toBe(defaultMgr);

    // Oldest non-default roots (e.g. fake_workspace_1) should have been evicted
    expect(managersByRoot.has(rootPaths[0])).toBe(false);

    // Most recent roots should still be in cache
    expect(managersByRoot.has(rootPaths[rootPaths.length - 1])).toBe(true);
  });

  it('17. Runtime toggle of engine.dynamicHarnessEnabled syncs to SubagentManager and subagent tool writes populate modifiedFiles (V1 & V2)', async () => {
    const expSubdir = path.join(testRoot, 'experiences_v1_v2');
    await fs.mkdir(expSubdir, { recursive: true });

    const engine = new AgentCoreEngine({
      workspaceRoot: workspaceDir,
      dynamicHarnessEnabled: true,
      experienceLearningEnabled: true,
      experienceStorageDir: expSubdir,
      autoTestEnabled: false,
      autoApprove: true,
    });

    // 1. Initial state check
    expect(engine.dynamicHarnessEnabled).toBe(true);
    expect(engine.getSubagentManager().getDynamicHarnessEnabled()).toBe(true);

    // Runtime toggle mutation (V1)
    engine.dynamicHarnessEnabled = false;
    expect(engine.dynamicHarnessEnabled).toBe(false);
    expect(engine.getSubagentManager().getDynamicHarnessEnabled()).toBe(false);

    let capturedSubagentPrompt = '';
    const subMockProvider = new MockProvider({
      script: [
        {
          thought: 'Writing sub_feature.ts file.',
          text: 'Writing sub_feature.ts.',
          toolCalls: [
            {
              id: 'call_write_sub_1',
              name: 'write_to_file',
              arguments: {
                path: 'sub_feature.ts',
                content: 'export const subFeature = true;\n',
              },
            },
          ],
        },
        {
          thought: 'Finishing without markdown modified files section',
          text: 'Implemented sub_feature.ts',
        },
      ],
    });

    const originalSubStream = subMockProvider.streamCompletion.bind(subMockProvider);
    subMockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
      capturedSubagentPrompt = systemPrompt;
      return originalSubStream(messages, systemPrompt, tools, onChunk, signal);
    };

    const sessionId = 'session_test_17';
    const parentMockProvider = new MockProvider({
      script: [
        {
          thought: 'Delegating work to subagent',
          text: 'Delegating to coder subagent',
          toolCalls: [
            {
              id: 'call_inv_sub_1',
              name: 'invoke_subagent',
              arguments: {
                subagents: [
                  {
                    typeName: 'coder',
                    role: 'Feature Implementer',
                    prompt: 'Implement sub_feature.ts module',
                  },
                ],
              },
            },
          ],
        },
        {
          thought: 'Subagent completed, completing task',
          text: 'Completed feature implementation task.',
        },
      ],
    });

    // Intercept spawnSubagents to attach subMockProvider and capture execution results
    const originalSpawn = engine.getSubagentManager().spawnSubagents.bind(engine.getSubagentManager());
    let results: SubagentExecutionResult[] = [];
    engine.getSubagentManager().spawnSubagents = async (paramsList) => {
      const patched = paramsList.map((p) => ({
        ...p,
        customProvider: subMockProvider,
      }));
      const res = await originalSpawn(patched);
      results = res;
      return res;
    };

    await engine.startTask('Implement sub_feature.ts using coder subagent', {
      sessionId,
      customProvider: parentMockProvider,
    });

    // Assertions for V1
    expect(engine.getSubagentManager().getDynamicHarnessEnabled()).toBe(false);
    expect(capturedSubagentPrompt).not.toContain('==== HARNESS TAILORED SUBAGENT SCOPE ====');
    expect(capturedSubagentPrompt).not.toContain('HARNESS TAILORED SUBAGENT SCOPE');

    // Assertions for V2
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].structuredReport?.modifiedFiles).toBeDefined();
    expect(results[0].structuredReport?.modifiedFiles).toContain('sub_feature.ts');

    // Assertions for Experience synthesis
    const experiences = await engine.experienceManager!.searchExperiences();
    expect(experiences.length).toBeGreaterThan(0);
    const expWithRelated = experiences.find((e) => (e.relatedFiles ?? []).includes('sub_feature.ts'));
    expect(expWithRelated).toBeDefined();
    expect(expWithRelated!.relatedFiles).toContain('sub_feature.ts');
  });
});
