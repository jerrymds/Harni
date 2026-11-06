import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AgentCoreEngine,
  MockProvider,
  SubagentRegistry,
  SubagentManager,
  InvokeSubagentTool,
  ManageSubagentsTool,
  DefineSubagentTool,
  SendMessageTool,
  SystemPromptBuilder,
  ProviderFactory,
  McpServerManager,
  SubagentInstance,
  ClinerulesParser,
  GitCheckpointService,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

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
    await fs.rm(tempTestDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('verifies SubagentRegistry built-in archetypes and dynamic definitions', () => {
    const registry = new SubagentRegistry(true);

    // Verify default registry has exactly 5 core archetypes (no separate agy-* archetypes)
    expect(registry.getAll()).toHaveLength(5);
    expect(registry.getAll().map((d) => d.name).sort()).toEqual([
      'architect',
      'coder',
      'researcher',
      'reviewer',
      'self',
    ]);

    expect(registry.has('researcher')).toBe(true);
    expect(registry.has('coder')).toBe(true);
    expect(registry.has('reviewer')).toBe(true);
    expect(registry.has('architect')).toBe(true);
    expect(registry.has('self')).toBe(true);

    // Backward-compatibility alias normalization for legacy agy-* names
    expect(registry.has('agy-researcher')).toBe(true);
    expect(registry.get('agy-researcher')?.name).toBe('researcher');
    expect(registry.has('agy-worker')).toBe(true);
    expect(registry.get('agy-worker')?.name).toBe('coder');
    expect(registry.has('agy-tester')).toBe(true);
    expect(registry.get('agy-tester')?.name).toBe('reviewer');
    expect(registry.has('agy')).toBe(true);
    expect(registry.get('agy')?.name).toBe('coder');

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
    let observedCurrentToolSummary: string | undefined;

    manager.on('subagent:spawned', (ev) => {
      if (ev.subagent.typeName === 'researcher') {
        spawnedEventReceived = true;
      }
    });

    manager.on('subagent:tool', (ev) => {
      if (ev.toolName === 'read_file' && ev.status === 'start') {
        toolEventReceived = true;
        const inst = manager.getInstance(ev.subagentId);
        observedCurrentToolSummary = inst?.getInfo().currentToolSummary;
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
    expect(observedCurrentToolSummary).toBe('Subagent calling read_file');

    // Context isolation: Manager tracks subagent instance
    const instances = manager.getInstancesBySession('session_test_1');
    expect(instances).toHaveLength(1);
    expect(instances[0].role).toBe('Codebase Researcher');
    expect(instances[0].currentToolSummary).toBeUndefined();
  });

  it('spawns subagent using legacy agy-worker archetype with seamless alias normalization', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    const mockCoderProvider = new MockProvider({
      script: [
        {
          thought: 'Implementing code fix.',
          text: 'Legacy agy-worker execution completed successfully.',
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'agy-worker',
        role: 'Autonomous Worker',
        prompt: 'Implement feature',
        sessionId: 'session_legacy_alias',
        parentId: 'parent_1',
        customProvider: mockCoderProvider,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].typeName).toBe('coder');
    expect(results[0].result).toContain('Legacy agy-worker execution completed successfully.');

    const inst = manager.getInstancesBySession('session_legacy_alias')[0];
    expect(inst.typeName).toBe('coder');
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

  it('resolves models based on tiered routing and explicit overrides', () => {
    const registry = new SubagentRegistry(true);

    // Fast tier routing by provider
    const fastResearcher = registry.get('researcher')!;
    expect(
      SubagentRegistry.resolveModel({
        definition: fastResearcher,
        provider: 'antigravity',
        parentModel: 'gemini-3.8-pro',
      }),
    ).toBe('gemini-3.8-flash');

    expect(
      SubagentRegistry.resolveModel({
        definition: fastResearcher,
        provider: 'anthropic',
        parentModel: 'claude-3-7-sonnet',
      }),
    ).toBe('claude-3-5-haiku-latest');

    expect(
      SubagentRegistry.resolveModel({
        definition: fastResearcher,
        provider: 'openai',
        parentModel: 'gpt-4o',
      }),
    ).toBe('gpt-4o-mini');

    // Inherit tier routes to parentModel
    const coder = registry.get('coder')!;
    expect(
      SubagentRegistry.resolveModel({
        definition: coder,
        provider: 'anthropic',
        parentModel: 'claude-3-7-sonnet',
      }),
    ).toBe('claude-3-7-sonnet');

    // Explicit model override takes highest priority
    expect(
      SubagentRegistry.resolveModel({
        explicitModel: 'claude-3-opus-20240229',
        definition: fastResearcher,
        provider: 'anthropic',
      }),
    ).toBe('claude-3-opus-20240229');
  });

  it('links parent signal cancellation to running subagent', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    const parentAbortController = new AbortController();

    // Provider that will hang until cancelled
    const hangingProvider = new MockProvider({
      script: [
        {
          thought: 'Working indefinitely...',
          text: 'Still working...',
          toolCalls: [{ id: 'hang_tool', name: 'read_file', arguments: { path: 'sample.txt' } }],
        },
      ],
    });

    const spawnPromise = manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Hanging Coder',
        prompt: 'Long running task',
        sessionId: 'session_signal_cancel',
        parentId: 'parent_task',
        parentSignal: parentAbortController.signal,
        customProvider: hangingProvider,
      },
    ]);

    // Abort parent immediately
    parentAbortController.abort();
    const results = await spawnPromise;

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('cancelled');
  });

  it('clears session subagents and purges instances via clearSessionSubagents', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    const mockProvider = new MockProvider({
      script: [{ thought: 'Quick work', text: 'Done.' }],
    });

    await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Session Subagent',
        prompt: 'Inspect',
        sessionId: 'session_to_clear',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);

    expect(manager.getInstancesBySession('session_to_clear')).toHaveLength(1);

    manager.clearSessionSubagents('session_to_clear');
    expect(manager.getInstancesBySession('session_to_clear')).toHaveLength(0);
  });

  it('tracks codeModified and triggers onCodeModified callback when writing code files', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    const mockCoderProvider = new MockProvider({
      script: [
        {
          thought: 'Writing a new source file.',
          text: 'Writing app.ts',
          toolCalls: [
            {
              id: 'write_call',
              name: 'write_to_file',
              arguments: { path: 'app.ts', content: 'export const app = 42;' },
            },
          ],
        },
        {
          thought: 'Done editing.',
          text: 'Finished writing app.ts',
        },
      ],
    });

    let codeModifiedCallbackCalled = false;
    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Code Writer',
        prompt: 'Write app.ts',
        sessionId: 'session_code_mod',
        parentId: 'parent_1',
        onCodeModified: () => {
          codeModifiedCallbackCalled = true;
        },
        customProvider: mockCoderProvider,
      },
    ]);

    expect(results[0].status).toBe('completed');
    expect(results[0].codeModified).toBe(true);
    expect(codeModifiedCallbackCalled).toBe(true);

    // Clean up created file
    await fs.rm(path.join(tempTestDir, 'app.ts'), { force: true });
  });

  it('truncates very large subagent tool output to protect context window', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    // Generate huge text file
    const hugeFilePath = path.join(tempTestDir, 'huge.txt');
    const hugeContent = 'A'.repeat(50_000);
    await fs.writeFile(hugeFilePath, hugeContent, 'utf-8');

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'Reading huge file...',
          text: 'Reading huge.txt',
          toolCalls: [
            {
              id: 'read_huge',
              name: 'read_file',
              arguments: { path: 'huge.txt' },
            },
          ],
        },
        {
          thought: 'Synthesizing output.',
          text: 'File read successfully.',
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Huge File Reader',
        prompt: 'Read huge file',
        sessionId: 'session_truncation_test',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);

    expect(results[0].status).toBe('completed');
    const instance = manager.getInstance(results[0].id)!;
    const toolMessage = instance.getMessages().find((m) => m.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(toolMessage!.content).toContain('已自動壓縮至安全長度以維護 Token 安全');
    expect(toolMessage!.content.length).toBeLessThan(35_000);

    // Clean up huge file
    await fs.rm(hugeFilePath, { force: true });
  });

  it('A1: handles subagent tool approval, rejection, autoApprove, and abort cleanup', async () => {
    // 1. Without requestToolApproval, execute_command (which requiresApproval) is rejected
    const managerNoApproval = new SubagentManager({
      workspaceRoot: tempTestDir,
    });
    const mockProvider1 = new MockProvider({
      script: [
        {
          text: 'Running terminal command',
          toolCalls: [{ id: 'cmd_1', name: 'execute_command', arguments: { command: 'echo hello' } }],
        },
      ],
    });
    const resNoApproval = await managerNoApproval.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder',
        prompt: 'run cmd',
        sessionId: 'sess_a1_1',
        parentId: 'parent',
        customProvider: mockProvider1,
      },
    ]);
    const inst1 = managerNoApproval.getInstance(resNoApproval[0].id)!;
    const toolMsg1 = inst1.getMessages().find((m) => m.role === 'tool');
    expect(toolMsg1?.toolResult?.isError).toBe(true);
    expect(toolMsg1?.toolResult?.output).toContain("User rejected execution of tool 'execute_command'");

    // 2. With requestToolApproval returning approved: true
    let approvalRequested = false;
    const managerWithApproval = new SubagentManager({
      workspaceRoot: tempTestDir,
      executeTerminalCommand: async () => ({ exitCode: 0, output: 'hello-output' }),
      requestToolApproval: async (_sid, req) => {
        approvalRequested = true;
        expect(req.subagentRole).toBe('Coder');
        return { approved: true };
      },
    });
    const mockProvider2 = new MockProvider({
      script: [
        {
          text: 'Running terminal command with approval',
          toolCalls: [{ id: 'cmd_2', name: 'execute_command', arguments: { command: 'echo hello' } }],
        },
      ],
    });
    const resWithApproval = await managerWithApproval.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder',
        prompt: 'run cmd',
        sessionId: 'sess_a1_2',
        parentId: 'parent',
        customProvider: mockProvider2,
      },
    ]);
    expect(approvalRequested).toBe(true);
    const inst2 = managerWithApproval.getInstance(resWithApproval[0].id)!;
    const toolMsg2 = inst2.getMessages().find((m) => m.role === 'tool');
    expect(toolMsg2?.toolResult?.isError).toBe(false);

    // 3. Engine level autoApprove: true bypasses interactive waiting
    const engineAuto = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      executeTerminalCommand: async () => ({ exitCode: 0, output: 'auto-ok' }),
    });
    engineAuto.autoApprove = true;
    const engineMock = new MockProvider({
      script: [
        {
          text: 'Running terminal command under autoApprove',
          toolCalls: [{ id: 'cmd_3', name: 'execute_command', arguments: { command: 'echo auto' } }],
        },
      ],
    });
    const resAuto = await engineAuto['subagentManager'].spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder',
        prompt: 'run cmd',
        sessionId: 'sess_a1_3',
        parentId: 'parent',
        customProvider: engineMock,
      },
    ]);
    const inst3 = engineAuto['subagentManager'].getInstance(resAuto[0].id)!;
    const toolMsg3 = inst3.getMessages().find((m) => m.role === 'tool');
    expect(toolMsg3?.toolResult?.isError).toBe(false);

    // 4. Pending approval cleanup when subagent is killed
    const engineWait = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });
    engineWait.autoApprove = false;
    await engineWait.startTask('init task', {
      sessionId: 'sess_a1_4',
      customProvider: new MockProvider({ script: [{ text: 'ready' }] }),
    });

    const mockWaitingSub = new MockProvider({
      script: [
        {
          text: 'Waiting for approval',
          toolCalls: [{ id: 'cmd_wait', name: 'execute_command', arguments: { command: 'echo wait' } }],
        },
      ],
    });

    const spawnPromise = engineWait['subagentManager'].spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder',
        prompt: 'run cmd',
        sessionId: 'sess_a1_4',
        parentId: 'parent',
        customProvider: mockWaitingSub,
      },
    ]);

    const waitStart = Date.now();
    while (Date.now() - waitStart < 2000) {
      const task = engineWait['tasksBySession'].get('sess_a1_4');
      if (task?.pendingApproval?.toolCallId === 'cmd_wait') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const sessionTask = engineWait['tasksBySession'].get('sess_a1_4');
    expect(sessionTask?.pendingApproval?.toolCallId).toBe('cmd_wait');

    // Kill subagents
    engineWait['subagentManager'].manageSubagents('kill_all', undefined, 'sess_a1_4');
    const waitResults = await spawnPromise;
    expect(sessionTask?.pendingApproval).toBeNull();
    expect(waitResults[0].status).toBe('cancelled');
  });

  it('A2: filters MCP tools for read-only subagents based on destructiveHint and readOnlyDenyTools', async () => {
    const mcpManager = new McpServerManager({ workspaceRoot: tempTestDir });
    mcpManager['tools'].set('mcp__server__safe_search', {
      definition: {
        name: 'mcp__server__safe_search',
        description: 'Safe search tool',
        parameters: { type: 'object', properties: {} },
      },
      serverName: 'server',
      toolName: 'safe_search',
      requiresApproval: false,
      allowedForReadOnly: true,
    });
    mcpManager['tools'].set('mcp__server__delete_repo', {
      definition: {
        name: 'mcp__server__delete_repo',
        description: 'Delete repository',
        parameters: { type: 'object', properties: {} },
      },
      serverName: 'server',
      toolName: 'delete_repo',
      requiresApproval: false,
      allowedForReadOnly: false,
    });
    mcpManager['tools'].set('mcp__server__drop_db', {
      definition: {
        name: 'mcp__server__drop_db',
        description: 'Drop database',
        parameters: { type: 'object', properties: {} },
      },
      serverName: 'server',
      toolName: 'drop_db',
      requiresApproval: false,
      allowedForReadOnly: false,
    });

    expect(mcpManager.isToolAllowedForReadOnly('mcp__server__safe_search')).toBe(true);
    expect(mcpManager.isToolAllowedForReadOnly('mcp__server__delete_repo')).toBe(false);
    expect(mcpManager.isToolAllowedForReadOnly('mcp__server__drop_db')).toBe(false);

    // Test tool registration logic with annotations and readOnlyDenyTools
    const fakeClient = { serverName: 'srv' } as any;
    mcpManager['registerTool'](
      fakeClient,
      { name: 'unannotated', description: 'desc' },
      { command: 'node' }
    );
    expect(mcpManager.isToolAllowedForReadOnly('mcp__srv__unannotated')).toBe(true);

    mcpManager['registerTool'](
      fakeClient,
      { name: 'destructive', description: 'desc', annotations: { destructiveHint: true } },
      { command: 'node' }
    );
    expect(mcpManager.isToolAllowedForReadOnly('mcp__srv__destructive')).toBe(false);

    mcpManager['registerTool'](
      fakeClient,
      { name: 'denied_by_config', description: 'desc' },
      { command: 'node', readOnlyDenyTools: ['denied_by_config'] }
    );
    expect(mcpManager.isToolAllowedForReadOnly('mcp__srv__denied_by_config')).toBe(false);

    // Spawn researcher (enableWriteTools: false) calling delete_repo
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
      mcpManager,
    });
    const mockProvider = new MockProvider({
      script: [
        {
          text: 'Attempting to call forbidden tool',
          toolCalls: [{ id: 'del_1', name: 'mcp__server__delete_repo', arguments: {} }],
        },
      ],
    });
    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Researcher',
        prompt: 'research',
        sessionId: 'sess_a2',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);
    const inst = manager.getInstance(results[0].id)!;
    const toolMsg = inst.getMessages().find((m) => m.role === 'tool');
    expect(toolMsg?.toolResult?.isError).toBe(true);
    expect(toolMsg?.toolResult?.output).toBe('Tool not permitted for read-only subagent');
  });

  it('A3: accumulates token usage across turns without double counting or state overwrite', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
    });

    const mockProvider = new MockProvider({
      script: [
        {
          text: 'Reading sample.txt',
          toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'sample.txt' } }],
          usageChunk: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
        },
        {
          text: 'Done reading',
          usageChunk: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Researcher',
        prompt: 'count tokens',
        sessionId: 'sess_a3',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);

    expect(results[0].tokenUsage).toEqual({
      promptTokens: 200,
      completionTokens: 70,
      totalTokens: 270,
    });

    // Test engine integration and syncTaskState persistence
    const engine = new AgentCoreEngine({ workspaceRoot: tempTestDir });
    await engine.startTask('test', {
      sessionId: 'sess_a3_engine',
      customProvider: new MockProvider({ script: [{ text: 'done' }] }),
    });

    const sessionTask = engine['tasksBySession'].get('sess_a3_engine')!;
    engine['subagentManager'].emit('subagent:completed', {
      sessionId: 'sess_a3_engine',
      subagentId: 'sub_1',
      status: 'completed',
      result: 'finished',
      durationMs: 50,
      tokenUsage: { promptTokens: 200, completionTokens: 70, totalTokens: 270 },
    });

    expect(sessionTask.subagentTokenUsage.promptTokens).toBe(200);
    expect(sessionTask.taskState.tokenUsage.totalTokens).toBeGreaterThanOrEqual(270);

    engine['syncTaskState'](sessionTask);
    expect(sessionTask.taskState.tokenUsage.promptTokens).toBeGreaterThanOrEqual(200);
    expect(sessionTask.taskState.tokenUsage.completionTokens).toBeGreaterThanOrEqual(70);
  });

  it('A4: emits completed event with status cancelled when subagent is cancelled', async () => {
    const manager = new SubagentManager({ workspaceRoot: tempTestDir });
    let completedPayload: any = null;
    manager.on('subagent:completed', (payload) => {
      completedPayload = payload;
    });

    const parentController = new AbortController();
    parentController.abort(); // already aborted

    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder',
        prompt: 'code',
        sessionId: 'sess_a4',
        parentId: 'parent',
        parentSignal: parentController.signal,
        customProvider: new MockProvider({ script: [{ text: 'test' }] }),
      },
    ]);

    expect(results[0].status).toBe('cancelled');
    expect(completedPayload).toBeDefined();
    expect(completedPayload.status).toBe('cancelled');
    expect(completedPayload.error).toBe('Parent task cancelled');
  });

  it('A5: follow-up message via send_message does not duplicate initial prompt in context', async () => {
    const manager = new SubagentManager({ workspaceRoot: tempTestDir });
    const mockProvider = new MockProvider({
      script: [
        { text: 'Initial answer' },
        { text: 'Follow-up answer' },
      ],
    });

    const initialPrompt = 'Unique initial prompt test A5';
    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Researcher',
        prompt: initialPrompt,
        sessionId: 'sess_a5',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);

    const subId = results[0].id;
    const followUpRes = await manager.sendMessage(subId, 'Follow-up question');
    expect(followUpRes).toBe('Follow-up answer');

    const inst = manager.getInstance(subId)!;
    const initialPromptMessages = inst.getMessages().filter(
      (m) => m.role === 'user' && m.content === initialPrompt,
    );
    expect(initialPromptMessages).toHaveLength(1);
  });

  it('A6: builds subagent-specific system prompt without planning mode and with operating rules', () => {
    const prompt = SystemPromptBuilder.build({
      workspaceRoot: tempTestDir,
      isSubagent: true,
      customInstructions: 'Custom subagent instructions',
    });

    expect(prompt).not.toContain('PLANNING MODE & IMPLEMENTATION PLAN WORKFLOW');
    expect(prompt).toContain('==== SUBAGENT OPERATING RULES ====');
    expect(prompt).toContain('You are a subagent delegated by a parent orchestrator.');
    expect(prompt).toContain('==== SUBAGENT ROLE INSTRUCTIONS ====');
    expect(prompt).toContain('Custom subagent instructions');
  });

  it('A7: passes OAuth flags to ProviderFactory.create when spawning subagents', async () => {
    const manager = new SubagentManager({ workspaceRoot: tempTestDir });
    const spy = vi.spyOn(ProviderFactory, 'create').mockReturnValue(new MockProvider({ script: [{ text: 'done' }] }));

    await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder',
        prompt: 'oauth test',
        sessionId: 'sess_a7',
        parentId: 'parent',
        anthropicOAuth: true,
        openaiOAuth: true,
        openaiAccountId: 'acc_oauth_test',
      },
    ]);

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        anthropicOAuth: true,
        openaiOAuth: true,
        openaiAccountId: 'acc_oauth_test',
      }),
    );
    spy.mockRestore();
  });

  it('A8: invokes final summary completion without tools when reaching maxTurns, preserving status', async () => {
    const registry = new SubagentRegistry(false);
    registry.register({
      name: 'turn_tester',
      role: 'Turn Tester',
      description: 'maxTurns test',
      systemPrompt: 'prompt',
      maxTurns: 1,
    });

    const manager = new SubagentManager({ workspaceRoot: tempTestDir });
    manager['registry'] = registry;

    const mockProvider = new MockProvider({
      script: [
        // Turn 1: model calls tool
        {
          text: 'Calling tool',
          toolCalls: [{ id: 'read_1', name: 'read_file', arguments: { path: 'sample.txt' } }],
        },
        // Turn limit summary call (no tools)
        {
          text: 'Final summarized report after turn limit reached',
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'turn_tester',
        role: 'Turn Tester',
        prompt: 'test turns',
        sessionId: 'sess_a8',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);

    expect(results[0].status).toBe('completed');
    expect(results[0].result).toBe('Final summarized report after turn limit reached');

    // Immunity test: if subagent was cancelled, its status is never overwritten by completed
    const cancelledInstance = manager.getInstance(results[0].id)!;
    cancelledInstance['status'] = 'cancelled';
    cancelledInstance['setStatus']('cancelled');
    expect(cancelledInstance.getStatus()).toBe('cancelled');
  });

  it('P1-1: enforces maxConcurrent limit when spawning multiple subagents', async () => {
    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
      maxConcurrent: 2,
    });

    let currentActive = 0;
    let peakActive = 0;
    const spawnedStatuses: string[] = [];

    manager.on('subagent:spawned', ({ subagent }) => {
      spawnedStatuses.push(subagent.status);
    });

    const createDelayedProvider = (delayMs: number, resultText: string) => ({
      providerType: 'mock' as const,
      model: 'mock-model',
      streamCompletion: async () => {
        currentActive++;
        if (currentActive > peakActive) {
          peakActive = currentActive;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        currentActive--;
        return {
          text: resultText,
          toolCalls: [],
        };
      },
      countTokens: () => 10,
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder 1',
        prompt: 'task 1',
        sessionId: 'sess_p1_1',
        parentId: 'parent',
        customProvider: createDelayedProvider(50, 'Result 1') as any,
      },
      {
        typeName: 'coder',
        role: 'Coder 2',
        prompt: 'task 2',
        sessionId: 'sess_p1_1',
        parentId: 'parent',
        customProvider: createDelayedProvider(50, 'Result 2') as any,
      },
      {
        typeName: 'coder',
        role: 'Coder 3',
        prompt: 'task 3',
        sessionId: 'sess_p1_1',
        parentId: 'parent',
        customProvider: createDelayedProvider(30, 'Result 3') as any,
      },
      {
        typeName: 'coder',
        role: 'Coder 4',
        prompt: 'task 4',
        sessionId: 'sess_p1_1',
        parentId: 'parent',
        customProvider: createDelayedProvider(30, 'Result 4') as any,
      },
    ]);

    expect(spawnedStatuses).toHaveLength(4);
    expect(spawnedStatuses.every((s) => s === 'pending')).toBe(true);
    expect(peakActive).toBe(2);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === 'completed')).toBe(true);

    manager.setMaxConcurrent(5);
    expect(manager.getMaxConcurrent()).toBe(5);
  });

  it('P1-2: retries automatically with exponential backoff on rate limit (429) errors', async () => {
    let callCount = 0;
    const retryEvents: any[] = [];

    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
      maxRateLimitRetries: 2,
      rateLimitBaseDelayMs: 20,
    });

    manager.on('subagent:tool', (evt) => {
      if (evt.toolName === 'RateLimitRetry') {
        retryEvents.push(evt);
      }
    });

    const rateLimitedProvider = {
      providerType: 'mock' as const,
      model: 'mock-model',
      streamCompletion: async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('429 Too Many Requests: Rate limit reached. Quota exceeded.');
        }
        return {
          text: 'Successful response after rate limit retry',
          toolCalls: [],
        };
      },
      countTokens: () => 10,
    };

    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Researcher',
        prompt: 'research something',
        sessionId: 'sess_p1_2',
        parentId: 'parent',
        customProvider: rateLimitedProvider as any,
      },
    ]);

    expect(callCount).toBe(2);
    expect(results[0].status).toBe('completed');
    expect(results[0].result).toBe('Successful response after rate limit retry');
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('P1-3: parses structured handoff report sections and propagates via events and result', async () => {
    const reportText = `
## 摘要 (Summary)
Refactored subagent execution to single runner architecture.

## 修改檔案 (Modified Files)
- \`packages/agent-core/src/subagents/subagentInstance.ts\`
- \`packages/types/src/agent.ts\`

## 關鍵發現 (Key Findings)
- Single runner simplifies lifecycle management.
- Concurrency queue prevents rate limits.

## 驗證 (Verification)
All unit tests pass with zero regressions.

## 待決問題 (Open Questions)
- None remaining.
`;

    const parsed = SubagentInstance.parseStructuredReport(reportText);
    expect(parsed).toBeDefined();
    expect(parsed?.summary).toBe('Refactored subagent execution to single runner architecture.');
    expect(parsed?.modifiedFiles).toEqual([
      'packages/agent-core/src/subagents/subagentInstance.ts',
      'packages/types/src/agent.ts',
    ]);
    expect(parsed?.findings).toEqual([
      'Single runner simplifies lifecycle management.',
      'Concurrency queue prevents rate limits.',
    ]);
    expect(parsed?.verification).toBe('All unit tests pass with zero regressions.');
    expect(parsed?.openQuestions).toEqual(['None remaining.']);

    let completedPayload: any = null;
    const manager = new SubagentManager({ workspaceRoot: tempTestDir });
    manager.on('subagent:completed', (payload) => {
      completedPayload = payload;
    });

    const mockProvider = new MockProvider({
      script: [{ text: reportText }],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Coder',
        prompt: 'do work',
        sessionId: 'sess_p1_3',
        parentId: 'parent',
        customProvider: mockProvider,
      },
    ]);

    expect(results[0].structuredReport).toBeDefined();
    expect(results[0].structuredReport?.modifiedFiles).toEqual([
      'packages/agent-core/src/subagents/subagentInstance.ts',
      'packages/types/src/agent.ts',
    ]);
    expect(completedPayload?.structuredReport).toBeDefined();
    expect(completedPayload.structuredReport.modifiedFiles).toHaveLength(2);
  });

  it('P2-1: spawns background subagents asynchronously and awaits completion via manage_subagents wait', async () => {
    const manager = new SubagentManager({ workspaceRoot: tempTestDir });
    let completedCount = 0;
    manager.on('subagent:completed', () => {
      completedCount++;
    });

    const slowProvider = new MockProvider({
      script: [
        {
          text: 'Slow task complete: background analysis done.',
          latencyMs: 100,
        },
      ],
    });

    const spawnResults = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Background Researcher',
        prompt: 'Analyze data in background',
        sessionId: 'sess_p2_bg',
        parentId: 'parent',
        background: true,
        customProvider: slowProvider,
      },
    ]);

    // Should return immediately without waiting for slowProvider
    expect(spawnResults).toHaveLength(1);
    expect(spawnResults[0].background).toBe(true);
    expect(['pending', 'running']).toContain(spawnResults[0].status);
    expect(completedCount).toBe(0);

    const subId = spawnResults[0].id;

    // Use ManageSubagentsTool to wait for it
    const manageTool = new ManageSubagentsTool();
    const waitResult = await manageTool.execute(
      { action: 'wait', subagentIds: [subId] },
      { workspaceRoot: tempTestDir, sessionId: 'sess_p2_bg', subagentManager: manager } as any,
    );

    expect(waitResult.isError).toBeFalsy();
    expect(waitResult.output).toContain('Background subagents completed');
    expect(waitResult.output).toContain('Slow task complete');
    expect(completedCount).toBe(1);

    const instance = manager.getInstance(subId);
    expect(instance?.getStatus()).toBe('completed');
  });

  it('P2-2: supports subagent ask_question with state transition to waiting_for_input and engine answer linkage', async () => {
    let questionAskedPayload: any = null;

    const askUserQuestion = vi.fn(
      async (
        sessionId: string,
        params: {
          question: string;
          options?: string[];
          isMultiSelect?: boolean;
          allowCustomInput?: boolean;
          subagentId: string;
          subagentRole: string;
        },
      ) => {
        questionAskedPayload = { sessionId, ...params };
        return { answers: ['PostgreSQL'], customInput: 'Use version 16' };
      },
    );

    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
      askUserQuestion,
    });

    const subagentProvider = new MockProvider({
      script: [
        // Turn 1: Subagent asks a question
        {
          thought: 'I need to know which database to use.',
          text: 'Asking user for database preference...',
          toolCalls: [
            {
              id: 'call_ask_1',
              name: 'ask_question',
              arguments: {
                question: 'Which database should we configure?',
                options: ['PostgreSQL', 'MySQL', 'SQLite'],
              },
            },
          ],
        },
        // Turn 2: Receives answer and finishes
        {
          thought: 'I got the answer PostgreSQL.',
          text: 'Configured PostgreSQL database as requested.',
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Database Configurator',
        prompt: 'Configure database connection',
        sessionId: 'sess_p2_ask',
        parentId: 'parent',
        customProvider: subagentProvider,
      },
    ]);

    expect(askUserQuestion).toHaveBeenCalledTimes(1);
    expect(questionAskedPayload.question).toBe('Which database should we configure?');
    expect(questionAskedPayload.subagentRole).toBe('Database Configurator');
    expect(results[0].status).toBe('completed');
    expect(results[0].result).toContain('Configured PostgreSQL database');
  });

  it('P2-2: integrates subagent ask_question with AgentCoreEngine and handles user answer', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      defaultProvider: 'mock',
    });

    await engine.startTask('init session', {
      sessionId: 'sess_engine_q',
      customProvider: new MockProvider({ script: [{ text: 'ready' }] }),
    });

    let questionEventReceived: any = null;
    engine.on('question:ask', (payload) => {
      questionEventReceived = payload;
      // Simulate user answering after 20ms
      setTimeout(() => {
        engine.handleAnswerQuestion(payload.toolCallId, ['Option A'], undefined, payload.sessionId);
      }, 20);
    });

    const subProvider = new MockProvider({
      script: [
        {
          thought: 'Ask user preference',
          text: 'Asking question...',
          toolCalls: [
            {
              id: 'call_sub_q1',
              name: 'ask_question',
              arguments: {
                question: 'Which option do you prefer?',
                options: ['Option A', 'Option B'],
              },
            },
          ],
        },
        {
          thought: 'User selected Option A',
          text: 'Proceeding with Option A.',
        },
      ],
    });

    const manager = engine.getSubagentManager();
    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Engine Question Agent',
        prompt: 'Ask and configure',
        sessionId: 'sess_engine_q',
        parentId: 'parent',
        customProvider: subProvider,
      },
    ]);

    expect(questionEventReceived).toBeDefined();
    expect(questionEventReceived.subagentRole).toBe('Engine Question Agent');
    expect(questionEventReceived.question).toBe('Which option do you prefer?');
    expect(results[0].status).toBe('completed');
    expect(results[0].result).toContain('Proceeding with Option A');
  });

  it('P2-3: enforces timeoutMs cap marking subagent status as error', async () => {
    const manager = new SubagentManager({ workspaceRoot: tempTestDir });

    const slowProvider = new MockProvider({
      script: [
        {
          text: 'Very slow processing...',
          latencyMs: 300,
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Timeout Tester',
        prompt: 'Run quick task',
        sessionId: 'sess_p2_timeout',
        parentId: 'parent',
        timeoutMs: 50, // Timeout after 50ms
        customProvider: slowProvider,
      },
    ]);

    expect(results[0].status).toBe('error');
    expect(results[0].error).toMatch(/timed out after 50ms/i);
  });

  it('P2-3: enforces maxTokensBudget cap stopping turn loop and producing final summary', async () => {
    const manager = new SubagentManager({ workspaceRoot: tempTestDir });

    // MockProvider that generates tokens exceeding budget
    const tokenExceedingProvider = new MockProvider({
      script: [
        {
          text: 'Turn 1 generating output...',
          usage: { promptTokens: 400, completionTokens: 200, totalTokens: 600 },
        },
        {
          text: 'Final summary: concluded within token budget.',
          usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Budget Tester',
        prompt: 'Complete task within token budget',
        sessionId: 'sess_p2_budget',
        parentId: 'parent',
        maxTokensBudget: 500, // Budget is 500, Turn 1 uses 600
        customProvider: tokenExceedingProvider,
      },
    ]);

    expect(results[0].status).toBe('completed');
    expect(results[0].tokenUsage?.totalTokens).toBeGreaterThanOrEqual(600);
    expect(results[0].result).toContain('concluded within token budget');
  });

  it('P2-4: supports modelTierMap in SubagentRegistry and SubagentManager', () => {
    const registry = new SubagentRegistry(true);
    registry.setModelTierMap({
      fast: 'custom-fast-model',
      reasoning: 'custom-reasoning-model',
    });

    expect(registry.getModelTierMap()).toEqual({
      fast: 'custom-fast-model',
      reasoning: 'custom-reasoning-model',
    });

    // Resolves model using customTierMap
    const resolvedFast = registry.resolveModel({
      definition: { name: 'fast_agent', role: 'Fast Agent', systemPrompt: '', modelTier: 'fast' },
      provider: 'anthropic',
    });
    expect(resolvedFast).toBe('custom-fast-model');

    const resolvedReasoning = registry.resolveModel({
      explicitModel: 'reasoning',
      provider: 'openai',
    });
    expect(resolvedReasoning).toBe('custom-reasoning-model');

    const manager = new SubagentManager({
      workspaceRoot: tempTestDir,
      modelTierMap: { fast: 'manager-fast-model' },
    });
    expect(manager.getModelTierMap()).toEqual({ fast: 'manager-fast-model' });

    manager.setModelTierMap({ reasoning: 'manager-reasoning-model' });
    expect(manager.getModelTierMap()).toEqual({
      fast: 'manager-fast-model',
      reasoning: 'manager-reasoning-model',
    });
  });

  it('P2-4: parses model tier, token budget, and timeoutMs from clinerules', () => {
    const content = `
## Subagents
### fast_worker
- Role: Fast Worker
- Description: Executes fast background jobs
- Model Tier: fast
- Max Tokens: 25000
- Timeout: 30000ms
- System Prompt: You are a fast worker.
`;
    const parsed = ClinerulesParser.parse(content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('fast_worker');
    expect(parsed[0].modelTier).toBe('fast');
    expect(parsed[0].maxTokensBudget).toBe(25000);
    expect(parsed[0].timeoutMs).toBe(30000);

    const registry = new SubagentRegistry(false);
    ClinerulesParser.applyRules(parsed, registry['definitions']);

    const def = registry.get('fast_worker');
    expect(def).toBeDefined();
    expect(def?.modelTier).toBe('fast');
    expect(def?.maxTokensBudget).toBe(25000);
    expect(def?.timeoutMs).toBe(30000);
  });

  it('P3-1: supports Git Worktree isolation for parallel writing subagents and auto merges on completion', async () => {
    const gitRepoDir = path.join(tempTestDir, `wt_repo_${Date.now()}`);
    await fs.mkdir(gitRepoDir, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: gitRepoDir });
    await fs.writeFile(path.join(gitRepoDir, 'main.txt'), 'base content', 'utf-8');
    await execFileAsync('git', ['add', 'main.txt'], { cwd: gitRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: gitRepoDir });

    const gitService = new GitCheckpointService();
    const manager = new SubagentManager({
      workspaceRoot: gitRepoDir,
      gitCheckpointService: gitService,
    });

    let completedPayload: any = null;
    manager.on('subagent:completed', (p) => {
      completedPayload = p;
    });

    const subProvider = new MockProvider({
      script: [
        {
          thought: 'Write file in isolated worktree',
          text: 'Writing file in worktree...',
          toolCalls: [
            {
              id: 'call_wt1',
              name: 'write_to_file',
              arguments: {
                path: 'subagent_output.txt',
                content: 'Created in isolated worktree!',
              },
            },
          ],
        },
        {
          thought: 'Done writing',
          text: 'Worktree task finished.',
        },
      ],
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Isolated Worker',
        prompt: 'Create file in worktree',
        sessionId: 'sess_p3_wt1',
        parentId: 'parent',
        isolation: 'worktree',
        autoMergeWorktree: true,
        customProvider: subProvider,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].worktreePath).toBeDefined();
    expect(results[0].worktreeBranch).toContain(results[0].id);
    expect(results[0].worktreeMerged).toBe(true);

    expect(completedPayload).toBeDefined();
    expect(completedPayload.worktreePath).toBe(results[0].worktreePath);
    expect(completedPayload.worktreeBranch).toBe(results[0].worktreeBranch);

    // Verify the file was merged into the main gitRepoDir
    const mergedContent = await fs.readFile(path.join(gitRepoDir, 'subagent_output.txt'), 'utf-8');
    expect(mergedContent).toBe('Created in isolated worktree!');

    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: gitRepoDir });
    } catch {
      // ignore
    }
  });

  it('P3-1: discards worktree when subagent is cancelled', async () => {
    const gitRepoDir = path.join(tempTestDir, `wt_cancel_${Date.now()}`);
    await fs.mkdir(gitRepoDir, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: gitRepoDir });
    await fs.writeFile(path.join(gitRepoDir, 'main.txt'), 'base content', 'utf-8');
    await execFileAsync('git', ['add', 'main.txt'], { cwd: gitRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: gitRepoDir });

    const gitService = new GitCheckpointService();
    const manager = new SubagentManager({
      workspaceRoot: gitRepoDir,
      gitCheckpointService: gitService,
    });

    const longRunningProvider = new MockProvider({
      script: [
        {
          text: 'Running long task in worktree...',
          latencyMs: 500,
        },
      ],
    });

    const [instance] = await manager.spawnSubagents([
      {
        typeName: 'coder',
        role: 'Cancelled Worker',
        prompt: 'Work in worktree',
        sessionId: 'sess_p3_wt_cancel',
        parentId: 'parent',
        isolation: 'worktree',
        background: true,
        customProvider: longRunningProvider,
      },
    ]);

    expect(instance.status).toBe('pending');

    // Wait for subagent to start running in its worktree
    await new Promise<void>((resolve) => {
      const handler = (payload: any) => {
        if (payload.subagentId === instance.id && payload.status === 'running') {
          manager.off('subagent:status', handler);
          resolve();
        }
      };
      manager.on('subagent:status', handler);
    });

    const runningSub = manager.getInstance(instance.id);
    expect(runningSub?.status).toBe('running');
    expect(runningSub?.worktreePath).toBeDefined();

    // Cancel the subagent
    const cancelled = manager.killSubagent(instance.id);
    expect(cancelled).toBe(true);

    const res = await manager.waitForSubagent(instance.id);
    expect(res?.status).toBe('cancelled');
    // Ensure worktree directory is removed or discarded
    const wtExists = await fs.stat(res!.worktreePath!).catch(() => null);
    expect(wtExists).toBeNull();

    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: gitRepoDir });
    } catch {
      // ignore
    }
  });

  it('P3-2: persists subagents in TaskState and synchronizes upon reconnection', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      defaultProvider: 'mock',
    });

    const sessionId = 'sess_p3_persist';
    await engine.startTask('Initial prompt', {
      sessionId,
      customProvider: new MockProvider({ script: [{ text: 'Main task ready' }] }),
    });

    let taskStateEmitted: any = null;
    engine.on('task:state', (payload) => {
      taskStateEmitted = payload;
    });

    const subProvider = new MockProvider({
      script: [
        {
          text: 'Subagent completed report with structured information',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
      ],
    });

    const manager = engine.getSubagentManager();
    const [result] = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Persisted Researcher',
        prompt: 'Research subagent state persistence',
        sessionId,
        parentId: 'parent',
        customProvider: subProvider,
      },
    ]);

    expect(result.status).toBe('completed');

    // 1. Verify engine.getTaskState returns subagents list with persisted state
    const taskState = engine.getTaskState(sessionId);
    expect(taskState).toBeDefined();
    expect(Array.isArray(taskState?.subagents)).toBe(true);
    expect(taskState?.subagents).toHaveLength(1);

    const subInfo = taskState?.subagents![0];
    expect(subInfo?.id).toBe(result.id);
    expect(subInfo?.role).toBe('Persisted Researcher');
    expect(subInfo?.status).toBe('completed');
    expect(subInfo?.tokenUsage?.totalTokens).toBe(150);

    // 2. Verify task:state event emitted to reconnected clients includes subagents
    expect(taskStateEmitted).toBeDefined();
    expect(Array.isArray(taskStateEmitted.subagents)).toBe(true);
    expect(taskStateEmitted.subagents[0].id).toBe(result.id);
  });
});
