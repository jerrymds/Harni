import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AgentCoreEngine,
  MockProvider,
  SubagentRegistry,
  SubagentManager,
  InvokeSubagentTool,
  ManageSubagentsTool,
  DefineSubagentTool,
  SendMessageTool,
} from '../src/index.js';

describe('Hierarchical Multi-Agent Orchestration', () => {
  const tempTestDir = path.resolve('temp_test_subagents_workspace');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
    await fs.writeFile(
      path.join(tempTestDir, 'sample.txt'),
      'Hello from cline-web hierarchical multi-agent workspace!',
      'utf-8',
    );
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  it('verifies SubagentRegistry built-in archetypes and dynamic definitions', () => {
    const registry = new SubagentRegistry(true);

    expect(registry.has('researcher')).toBe(true);
    expect(registry.has('coder')).toBe(true);
    expect(registry.has('reviewer')).toBe(true);
    expect(registry.has('architect')).toBe(true);
    expect(registry.has('self')).toBe(true);

    const researcher = registry.get('researcher')!;
    expect(researcher.enableWriteTools).toBe(false);
    expect(researcher.allowedTools).toContain('read_file');
    expect(researcher.allowedTools).not.toContain('write_to_file');

    const coder = registry.get('coder')!;
    expect(coder.enableWriteTools).toBe(true);
    expect(coder.allowedTools).toContain('write_to_file');

    // Dynamic registration
    registry.register({
      name: 'sql_optimizer',
      role: 'SQL Performance Optimizer',
      description: 'Optimizes database queries',
      systemPrompt: 'You analyze SQL queries for indexes and performance.',
      allowedTools: ['read_file', 'search_files'],
    });

    expect(registry.has('sql_optimizer')).toBe(true);
    expect(registry.get('sql_optimizer')?.role).toBe('SQL Performance Optimizer');
  });

  it('spawns a researcher subagent with isolated context and scoped tools', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    const mockSubagentProvider = new MockProvider({
      script: [
        // Turn 1: Subagent reads file
        {
          thought: 'I will read sample.txt to research its contents.',
          text: 'Reading sample.txt...',
          toolCalls: [
            {
              id: 'sub_call_1',
              name: 'read_file',
              arguments: { path: 'sample.txt' },
            },
          ],
        },
        // Turn 2: Subagent reports findings
        {
          thought: 'Analysis complete.',
          text: 'Research Report: sample.txt contains a greeting message.',
        },
      ],
    });

    let spawnedEventReceived = false;
    let toolEventReceived = false;
    let completedEventReceived = false;

    manager.on('subagent:spawned', (ev) => {
      if (ev.subagent.typeName === 'researcher') {
        spawnedEventReceived = true;
      }
    });

    manager.on('subagent:tool', (ev) => {
      if (ev.toolName === 'read_file') {
        toolEventReceived = true;
      }
    });

    manager.on('subagent:completed', (ev) => {
      if (ev.result.includes('Research Report')) {
        completedEventReceived = true;
      }
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Codebase Researcher',
        prompt: 'Investigate sample.txt',
        sessionId: 'session_test_1',
        parentId: 'task_parent_1',
        customProvider: mockSubagentProvider,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].result).toContain('Research Report: sample.txt');
    expect(results[0].toolCallCount).toBe(1);
    expect(spawnedEventReceived).toBe(true);
    expect(toolEventReceived).toBe(true);
    expect(completedEventReceived).toBe(true);

    // Context isolation: Manager tracks subagent instance
    const instances = manager.getInstancesBySession('session_test_1');
    expect(instances).toHaveLength(1);
    expect(instances[0].role).toBe('Codebase Researcher');
  });

  it('enforces depth guard limit to prevent infinite recursion', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
      maxDepth: 2,
    });

    // Attempting depth 3 should fail
    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Deep Subagent',
        prompt: 'Too deep',
        sessionId: 'session_depth_test',
        parentId: 'parent_2',
        depth: 3, // Exceeds maxDepth 2
      },
    ]);

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('depth limit exceeded');
  });

  it('executes manage_subagents tool to list and kill subagents', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    // Mock an idle instance
    const mockProvider = new MockProvider({
      script: [{ thought: 'Done', text: 'Output' }],
    });

    await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Test Subagent',
        prompt: 'Do research',
        sessionId: 'session_mgmt',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);

    const manageTool = new ManageSubagentsTool();

    // 1. List
    const listResult = await manageTool.execute(
      { action: 'list' },
      {
        workspaceRoot: tempTestDir,
        sessionId: 'session_mgmt',
        subagentManager: manager,
      },
    );

    expect(listResult.isError).toBeFalsy();
    expect(String(listResult.output)).toContain('Active Subagents (1)');

    // 2. Kill all
    const killResult = await manageTool.execute(
      { action: 'kill_all' },
      {
        workspaceRoot: tempTestDir,
        sessionId: 'session_mgmt',
        subagentManager: manager,
      },
    );

    expect(killResult.isError).toBeFalsy();
    expect(String(killResult.output)).toContain("Action 'kill_all' applied");
  });

  it('allows dynamic subagent creation with define_subagent tool', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    const defineTool = new DefineSubagentTool();
    const result = await defineTool.execute(
      {
        name: 'perf_auditor',
        role: 'Performance Auditor',
        description: 'Audits memory and CPU performance',
        systemPrompt: 'Analyze benchmarks and hot paths.',
        allowedTools: ['read_file', 'search_files'],
      },
      {
        workspaceRoot: tempTestDir,
        subagentManager: manager,
      },
    );

    expect(result.isError).toBeFalsy();
    expect(String(result.output)).toContain("Successfully defined subagent archetype 'perf_auditor'");
    expect(manager.getRegistry().has('perf_auditor')).toBe(true);
  });

  it('runs complete multi-agent orchestration loop with AgentCoreEngine', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    // Subagent provider script
    const subagentMockProvider = new MockProvider({
      script: [
        {
          thought: 'I am the researcher examining sample.txt',
          text: 'Reading sample.txt...',
          toolCalls: [
            {
              id: 'sub_read_1',
              name: 'read_file',
              arguments: { path: 'sample.txt' },
            },
          ],
        },
        {
          thought: 'Done researching.',
          text: 'Research Summary: sample.txt contains valid workspace greetings.',
        },
      ],
    });

    // Pre-register custom subagent that uses mock provider or test invoke_subagent directly
    engine.getSubagentManager().getRegistry().register({
      name: 'mock_researcher',
      role: 'Mock Researcher',
      description: 'Mock research subagent',
      systemPrompt: 'Research files thoroughly.',
      allowedTools: ['read_file'],
    });

    // Parent orchestrator provider script
    const parentMockProvider = new MockProvider({
      script: [
        // Turn 1: Parent orchestrator invokes subagent to delegate research
        {
          thought: 'I will delegate file analysis to a specialized researcher subagent.',
          text: 'Invoking subagent to inspect the workspace.',
          toolCalls: [
            {
              id: 'parent_call_1',
              name: 'invoke_subagent',
              arguments: {
                subagents: [
                  {
                    typeName: 'researcher',
                    role: 'Codebase Researcher',
                    prompt: 'Read and analyze sample.txt',
                  },
                ],
              },
            },
          ],
        },
        // Turn 2: Parent orchestrator synthesizes findings and responds to user
        {
          thought: 'The researcher subagent returned findings. I will now answer the user.',
          text: 'Based on the researcher report, sample.txt contains a valid multi-agent greeting message.',
        },
      ],
    });

    // Override spawnSubagents temporarily to use subagentMockProvider for the spawned subagent
    const originalSpawn = engine.getSubagentManager().spawnSubagents.bind(engine.getSubagentManager());
    engine.getSubagentManager().spawnSubagents = (paramsList) => {
      const patched = paramsList.map((p) => ({
        ...p,
        customProvider: subagentMockProvider,
      }));
      return originalSpawn(patched);
    };

    let subagentSpawnedEmitted = false;
    let subagentCompletedEmitted = false;

    engine.on('subagent:spawned', () => {
      subagentSpawnedEmitted = true;
    });

    engine.on('subagent:completed', () => {
      subagentCompletedEmitted = true;
    });

    await engine.startTask('Please analyze sample.txt using a subagent', {
      sessionId: 'session_orchestration_test',
      customProvider: parentMockProvider,
    });

    expect(subagentSpawnedEmitted).toBe(true);
    expect(subagentCompletedEmitted).toBe(true);

    const taskState = engine.getTaskState('session_orchestration_test');
    expect(taskState?.status).toBe('completed');

    // The parent's last message synthesizes the subagent findings
    const lastMsg = taskState?.messages[taskState.messages.length - 1];
    expect(lastMsg?.content).toContain('Based on the researcher report');
  });

  it('parses .clinerules directory with sub-agent.md to bind custom roles and models', async () => {
    const clinerulesDir = path.join(tempTestDir, '.clinerules');
    await fs.mkdir(clinerulesDir, { recursive: true });

    const subagentMarkdown = `
# 階層式子代理人角色與模型配置 (Subagent Roles & Models)

## researcher
- **Model**: \`gemini-3.8-flash\`
- **Role**: 專案速查員
- **Instructions**: 快速搜尋檔案與檢索定義。

## coder
- **Model**: gemini-3.8-pro
- **Role**: 系統重構專員

## security_auditor
- **Model**: claude-3-7-sonnet
- **Role**: 系統資安稽核員
- **Allowed Tools**: read_file, search_files
- **Instructions**: 檢查程式碼注入與安全弱點。
`;

    const subagentPath = path.join(clinerulesDir, 'sub-agent.md');
    await fs.writeFile(subagentPath, subagentMarkdown, 'utf-8');

    // Also add another markdown rule in .clinerules/
    const codingStandardsPath = path.join(clinerulesDir, 'coding-standards.md');
    await fs.writeFile(codingStandardsPath, '# Coding Standards\nUse TypeScript strictly.', 'utf-8');

    const registry = new SubagentRegistry(true);
    const count = await registry.loadFromWorkspace(tempTestDir);

    expect(count).toBe(3);

    // Existing roles updated with models from .clinerules/sub-agent.md
    const researcher = registry.get('researcher')!;
    expect(researcher.model).toBe('gemini-3.8-flash');
    expect(researcher.role).toBe('專案速查員');
    expect(researcher.systemPrompt).toContain('快速搜尋檔案與檢索定義');

    const coder = registry.get('coder')!;
    expect(coder.model).toBe('gemini-3.8-pro');
    expect(coder.role).toBe('系統重構專員');

    // New custom role created from .clinerules/sub-agent.md
    expect(registry.has('security_auditor')).toBe(true);
    const auditor = registry.get('security_auditor')!;
    expect(auditor.model).toBe('claude-3-7-sonnet');
    expect(auditor.role).toBe('系統資安稽核員');
    expect(auditor.allowedTools).toEqual(['read_file', 'search_files']);

    // Clean up .clinerules directory in temp test directory
    await fs.rm(clinerulesDir, { recursive: true, force: true });
  });
});
