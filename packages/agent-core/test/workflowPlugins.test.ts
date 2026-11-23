import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AgentCoreEngine,
  MockProvider,
  WorkflowPluginManager,
} from '../src/index.js';
import {
  PluginPriority,
  type WorkflowPlugin,
  type WorkflowPluginContext,
  type ToolCallMiddlewareContext,
  type ToolCallNext,
  type ToolResult,
  type SystemPromptSection,
  type ToolDefinition,
  type CompletionGateResult,
} from '@harni/types';

describe('Harni Core Workflow Plugin Architecture', () => {
  const tempTestDir = path.resolve('temp_test_workflow_plugins');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  describe('1. WorkflowPluginManager Unit Operations', () => {
    it('manages registration, ordering, metadata, and subagent filtering', () => {
      const pm = new WorkflowPluginManager();

      const pluginLow: WorkflowPlugin = {
        id: 'test.low',
        name: 'Low Priority Plugin',
        description: 'Runs late',
        priority: PluginPriority.TELEMETRY, // 80
        enabled: true,
        applyToSubagents: false,
      };

      const pluginHigh: WorkflowPlugin = {
        id: 'test.high',
        name: 'High Priority Plugin',
        description: 'Runs early',
        priority: PluginPriority.ENVIRONMENT, // 10
        enabled: true,
        applyToSubagents: true,
      };

      const pluginDisabled: WorkflowPlugin = {
        id: 'test.disabled',
        name: 'Disabled Plugin',
        description: 'Inactive',
        priority: PluginPriority.CONTEXT, // 40
        enabled: false,
        applyToSubagents: true,
      };

      pm.register(pluginLow);
      pm.register(pluginHigh);
      pm.register(pluginDisabled);

      expect(pm.hasPlugin('test.high')).toBe(true);
      expect(pm.hasPlugin('test.low')).toBe(true);
      expect(pm.hasPlugin('test.disabled')).toBe(true);
      expect(pm.hasPlugin('nonexistent')).toBe(false);

      // Active plugins sorted by priority (10 before 80, disabled excluded)
      const activeMain = pm.getActivePlugins(false);
      expect(activeMain.map((p) => p.id)).toEqual(['test.high', 'test.low']);

      // Subagent active plugins (only applyToSubagents: true)
      const activeSub = pm.getActivePlugins(true);
      expect(activeSub.map((p) => p.id)).toEqual(['test.high']);

      // Toggle plugin enablement
      pm.setPluginEnabled('test.disabled', true);
      const activeAfterEnable = pm.getActivePlugins(true);
      expect(activeAfterEnable.map((p) => p.id)).toEqual(['test.high', 'test.disabled']);

      // Unregister
      expect(pm.unregister('test.low')).toBe(true);
      expect(pm.hasPlugin('test.low')).toBe(false);
      expect(pm.unregister('test.low')).toBe(false);

      // Metadata export
      const meta = pm.getPluginsMetadata();
      expect(meta.length).toBe(2);
      expect(meta.find((m) => m.id === 'test.high')?.name).toBe('High Priority Plugin');
    });

    it('executes onion middleware pipeline in correct priority order', async () => {
      const pm = new WorkflowPluginManager();
      const callLog: string[] = [];

      pm.register({
        id: 'p1',
        name: 'Plugin 1 (Outer)',
        description: '',
        priority: 10,
        enabled: true,
        onToolCall: async (_ctx, _toolCtx, next) => {
          callLog.push('p1-before');
          const res = await next();
          callLog.push('p1-after');
          return { ...res, output: `${res.output} -> p1` };
        },
      });

      pm.register({
        id: 'p2',
        name: 'Plugin 2 (Inner)',
        description: '',
        priority: 20,
        enabled: true,
        onToolCall: async (_ctx, _toolCtx, next) => {
          callLog.push('p2-before');
          const res = await next();
          callLog.push('p2-after');
          return { ...res, output: `${res.output} -> p2` };
        },
      });

      const mockCtx = {} as WorkflowPluginContext;
      const mockToolCtx: ToolCallMiddlewareContext = {
        toolCall: { id: 'call_1', name: 'test_tool', arguments: {} },
        canonicalToolName: 'test_tool',
        requiresApproval: false,
        isMcpTool: false,
        metadata: {},
      };

      const finalResult = await pm.executeToolWithMiddleware(
        mockCtx,
        mockToolCtx,
        async () => {
          callLog.push('core-exec');
          return { toolCallId: 'call_1', output: 'core-result' };
        },
      );

      expect(callLog).toEqual(['p1-before', 'p2-before', 'core-exec', 'p2-after', 'p1-after']);
      expect(finalResult.output).toBe('core-result -> p2 -> p1');
    });
  });

  describe('2. Custom WorkflowPlugin Hooks inside AgentCoreEngine', () => {
    it('executes onTaskStart, onResolveTools, onBuildSystemPrompt, and onToolCall middleware', async () => {
      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
      });

      let taskStartedCalled = false;
      let systemPromptReceived = '';
      let toolCallIntercepted = false;

      const customPlugin: WorkflowPlugin = {
        id: 'custom.workflow-test',
        name: 'Custom Workflow Test Plugin',
        description: 'Tests all custom hooks in engine loop',
        priority: 35,
        enabled: true,
        onTaskStart: (_ctx) => {
          taskStartedCalled = true;
        },
        onResolveTools: (_ctx, tools: ToolDefinition[]) => {
          // Add a custom synthetic tool definition
          return [
            ...tools,
            {
              name: 'custom_synthetic_tool',
              description: 'A dynamically injected tool',
              parameters: { type: 'object', properties: {} },
            },
          ];
        },
        onBuildSystemPrompt: (_ctx): SystemPromptSection[] => {
          return [
            {
              id: 'custom.prompt-section',
              content: '==== CUSTOM WORKFLOW PLUGIN INSTRUCTION ====\nAlways be concise.',
              order: 45,
            },
          ];
        },
        onToolCall: async (_ctx, toolCtx: ToolCallMiddlewareContext, next: ToolCallNext): Promise<ToolResult> => {
          if (toolCtx.canonicalToolName === 'write_file') {
            toolCallIntercepted = true;
            const res = await next();
            return {
              ...res,
              output: `[MODIFIED BY PLUGIN] ${res.output}`,
            };
          }
          return await next();
        },
      };

      engine.registerPlugin(customPlugin);

      const mockProvider = new MockProvider({
        script: [
          {
            thought: 'Writing a note',
            text: 'Writing custom note',
            toolCalls: [
              {
                id: 'call_wf_write',
                name: 'write_file',
                arguments: { path: 'custom_note.txt', content: 'Custom plugin output test' },
              },
            ],
          },
          {
            thought: 'Finishing',
            text: 'Note written successfully.',
          },
        ],
      });

      const origStream = mockProvider.streamCompletion.bind(mockProvider);
      mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        systemPromptReceived = systemPrompt;
        expect(tools.some((t) => t.name === 'custom_synthetic_tool')).toBe(true);
        return origStream(messages, systemPrompt, tools, onChunk, signal);
      };

      let toolResultEmitted: ToolResult | null = null;
      engine.on('tool:result', (ev) => {
        toolResultEmitted = ev;
      });

      await engine.startTask('Execute custom plugin workflow test', {
        customProvider: mockProvider,
      });

      expect(taskStartedCalled).toBe(true);
      expect(systemPromptReceived).toContain('==== CUSTOM WORKFLOW PLUGIN INSTRUCTION ====');
      expect(toolCallIntercepted).toBe(true);
      expect(toolResultEmitted).not.toBeNull();
      expect((toolResultEmitted as any).output).toContain('[MODIFIED BY PLUGIN]');
    });

    it('onBeforeComplete gate re-enters LLM loop when returning continue_loop', async () => {
      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
      });

      let gateCheckCount = 0;

      const gatePlugin: WorkflowPlugin = {
        id: 'custom.gate-plugin',
        name: 'Gate Plugin',
        description: 'Intercepts completion to force 1 extra correction turn',
        priority: 75,
        enabled: true,
        onBeforeComplete: async (): Promise<CompletionGateResult> => {
          gateCheckCount++;
          if (gateCheckCount === 1) {
            return {
              action: 'continue_loop',
              injectedMessages: [
                {
                  id: `msg_injected_${Date.now()}`,
                  role: 'user',
                  content: 'Gate check: Please provide a final checklist before finishing.',
                  timestamp: Date.now(),
                },
              ],
            };
          }
          return { action: 'allow' };
        },
      };

      engine.registerPlugin(gatePlugin);

      const mockProvider = new MockProvider({
        script: [
          // Turn 1: Assistant tries to finish
          {
            thought: 'First completion attempt',
            text: 'I think I am done.',
          },
          // Turn 2: Assistant responds to the gate check
          {
            thought: 'Answering checklist',
            text: 'Checklist completed: 1. Code written, 2. Tests verified.',
          },
        ],
      });

      await engine.startTask('Task requiring gate verification', {
        customProvider: mockProvider,
      });

      expect(gateCheckCount).toBe(2);
      const taskState = engine.getTaskState();
      expect(taskState?.status).toBe('completed');
      const messages = taskState?.messages || [];
      expect(messages.some((m) => m.content.includes('Gate check: Please provide a final checklist'))).toBe(true);
    });
  });

  describe('3. Built-in Core Workflow Plugin Toggling', () => {
    it('disabling harni.syntax-diagnostics skips AST linting while AutoTestRepairPlugin still tracks edits', async () => {
      let terminalExecuted = false;
      const mockExecuteTerminal = async () => {
        terminalExecuted = true;
        return { exitCode: 0, output: 'PASS calc.test.ts' };
      };

      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        executeTerminalCommand: mockExecuteTerminal,
        autoTestEnabled: true,
        experienceLearningEnabled: false,
      });

      // Disable syntax diagnostics plugin
      engine.setPluginEnabled('harni.syntax-diagnostics', false);
      expect(engine.getPluginManager().isPluginEnabled('harni.syntax-diagnostics')).toBe(false);

      let diagnosticsEmitted = false;
      engine.on('file:diagnostics', () => {
        diagnosticsEmitted = true;
      });

      const mockProvider = new MockProvider({
        script: [
          {
            thought: 'Writing ts file',
            text: 'Creating ts file',
            toolCalls: [
              {
                id: 'call_diag_ts',
                name: 'write_file',
                arguments: {
                  path: 'calc.ts',
                  // Syntax error with trailing unexpected token
                  content: 'export function add(a: number, b: number) { return a + b } }}}\n',
                },
              },
            ],
          },
          {
            thought: 'Done',
            text: 'Finished writing calc.ts',
          },
        ],
      });

      await engine.startTask('Write calc.ts and run test', {
        customProvider: mockProvider,
        autoTest: true,
        testCommand: 'pnpm test:calc',
      });

      // Diagnostics plugin was disabled, so no diagnostic event was emitted
      expect(diagnosticsEmitted).toBe(false);
      // But AutoTestRepairPlugin's onToolCall detected the file write and executed the test!
      expect(terminalExecuted).toBe(true);
    });

    it('disabling harni.auto-test-repair skips auto test execution', async () => {
      let terminalExecuted = false;
      const mockExecuteTerminal = async () => {
        terminalExecuted = true;
        return { exitCode: 0, output: 'PASS' };
      };

      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        executeTerminalCommand: mockExecuteTerminal,
        autoTestEnabled: true,
        experienceLearningEnabled: false,
      });

      // Disable auto test plugin
      engine.setPluginEnabled('harni.auto-test-repair', false);

      const mockProvider = new MockProvider({
        script: [
          {
            thought: 'Writing file',
            text: 'Writing file',
            toolCalls: [
              {
                id: 'call_edit',
                name: 'write_file',
                arguments: { path: 'module.ts', content: 'export const x = 1;\n' },
              },
            ],
          },
          {
            thought: 'Done',
            text: 'Complete.',
          },
        ],
      });

      await engine.startTask('Edit file with autoTest enabled option', {
        customProvider: mockProvider,
        autoTest: true,
        testCommand: 'pnpm test',
      });

      expect(terminalExecuted).toBe(false);
    });

    it('disabling harni.rules-skills stops injecting .harnirules and skills into system prompt', async () => {
      const rulesDir = path.join(tempTestDir, '.harnirules');
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(path.join(rulesDir, 'custom.md'), 'RULE: Always use tabs over spaces');

      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
      });

      let capturedPrompt = '';
      const mockProvider = new MockProvider({
        script: [
          {
            thought: 'Done',
            text: 'Done',
          },
        ],
      });
      const origStream = mockProvider.streamCompletion.bind(mockProvider);
      mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        capturedPrompt = systemPrompt;
        return origStream(messages, systemPrompt, tools, onChunk, signal);
      };

      // 1. With harni.rules-skills enabled
      await engine.startTask('First task with rules plugin', {
        customProvider: mockProvider,
      });
      expect(capturedPrompt).toContain('==== WORKSPACE RULES (.harnirules) ====');
      expect(capturedPrompt).toContain('Always use tabs over spaces');

      // 2. Disable harni.rules-skills
      engine.setPluginEnabled('harni.rules-skills', false);
      capturedPrompt = '';

      const mockProvider2 = new MockProvider({
        script: [
          {
            thought: 'Done 2',
            text: 'Done 2',
          },
        ],
      });
      mockProvider2.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        capturedPrompt = systemPrompt;
        return origStream(messages, systemPrompt, tools, onChunk, signal);
      };

      await engine.startTask('Second task without rules plugin', {
        customProvider: mockProvider2,
      });
      expect(capturedPrompt).not.toContain('==== WORKSPACE RULES (.harnirules) ====');
      expect(capturedPrompt).not.toContain('Always use tabs over spaces');
      expect(capturedPrompt).not.toContain('AVAILABLE SKILLS');
    });

    it('disabling harni.experience-learning stops experience injection and synthesis', async () => {
      const expDir = path.join(tempTestDir, `exp_toggle_${Date.now()}`);
      await fs.mkdir(expDir, { recursive: true });

      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: true,
        experienceStorageDir: expDir,
        autoTestEnabled: false,
      });

      // Disable experience plugin
      engine.setPluginEnabled('harni.experience-learning', false);

      const mockProvider = new MockProvider({
        script: [
          {
            thought: 'Editing code',
            text: 'Fixing bug in helper.ts',
            toolCalls: [
              {
                id: 'call_write_exp',
                name: 'write_file',
                arguments: { path: 'helper.ts', content: 'export function help() { return true; }\n' },
              },
            ],
          },
          {
            thought: 'Done',
            text: 'Task complete.',
          },
        ],
      });

      await engine.startTask('Fix bug in helper.ts', {
        customProvider: mockProvider,
      });

      // No experiences should be saved
      const exps = await engine.experienceManager!.searchExperiences();
      expect(exps.length).toBe(0);
    });
  });

  describe('4. SubagentInstance Sharing WorkflowPluginManager', () => {
    it('executes applyToSubagents: true plugins inside subagents and ignores applyToSubagents: false plugins', async () => {
      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        subagentsEnabled: true,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
      });

      let subagentToolResolved = false;
      let subagentPromptInjected = false;
      let subagentMiddlewareRan = false;
      let nonSubagentPluginRan = false;

      const subSharedPlugin: WorkflowPlugin = {
        id: 'custom.subagent-shared',
        name: 'Shared Subagent Plugin',
        description: 'Runs on both main and subagents',
        priority: 25,
        enabled: true,
        applyToSubagents: true,
        onResolveTools: (ctx, tools) => {
          if (ctx.isSubagent) {
            subagentToolResolved = true;
          }
          return tools;
        },
        onBuildSystemPrompt: (ctx) => {
          if (ctx.isSubagent) {
            subagentPromptInjected = true;
            return [
              {
                id: 'sub.shared-prompt',
                content: '==== SUBAGENT TAILORED RULE ====\nWork surgically.',
                order: 10,
              },
            ];
          }
          return [];
        },
        onToolCall: async (ctx, _toolCtx, next) => {
          if (ctx.isSubagent) {
            subagentMiddlewareRan = true;
          }
          return await next();
        },
      };

      const nonSubPlugin: WorkflowPlugin = {
        id: 'custom.main-only',
        name: 'Main Only Plugin',
        description: 'Never runs on subagents',
        priority: 26,
        enabled: true,
        applyToSubagents: false,
        onToolCall: async (ctx, _toolCtx, next) => {
          if (ctx.isSubagent) {
            nonSubagentPluginRan = true;
          }
          return await next();
        },
      };

      engine.registerPlugin(subSharedPlugin);
      engine.registerPlugin(nonSubPlugin);

      const subMockProvider = new MockProvider({
        script: [
          {
            thought: 'Subagent doing research',
            text: 'I will list directory files.',
            toolCalls: [
              {
                id: 'call_sub_list',
                name: 'list_directory',
                arguments: { path: '.' },
              },
            ],
          },
          {
            thought: 'Subagent finishing',
            text: 'Research complete.',
          },
        ],
      });

      const parentMockProvider = new MockProvider({
        script: [
          {
            thought: 'Delegating to researcher',
            text: 'Delegating task',
            toolCalls: [
              {
                id: 'call_inv_1',
                name: 'invoke_subagent',
                arguments: {
                  subagents: [
                    {
                      typeName: 'researcher',
                      role: 'Research Specialist',
                      prompt: 'Investigate directory structure',
                    },
                  ],
                },
              },
            ],
          },
          {
            thought: 'Parent finishing',
            text: 'Subagent task finished.',
          },
        ],
      });

      const originalSpawn = engine.getSubagentManager().spawnSubagents.bind(engine.getSubagentManager());
      engine.getSubagentManager().spawnSubagents = async (paramsList) => {
        const patched = paramsList.map((p) => ({
          ...p,
          customProvider: subMockProvider,
        }));
        return originalSpawn(patched);
      };

      await engine.startTask('Orchestrate subagent with shared plugin manager', {
        customProvider: parentMockProvider,
      });

      expect(subagentToolResolved).toBe(true);
      expect(subagentPromptInjected).toBe(true);
      expect(subagentMiddlewareRan).toBe(true);
      expect(nonSubagentPluginRan).toBe(false);
    });
  });

  describe('4. Ask Mode Read-Only Guardrails (ToolGuardPlugin & GitWorkspacePlugin)', () => {
    it('filters out mutating tools in ask mode and blocks direct write/command/coder subagent calls', async () => {
      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
        enableCheckpoint: true,
      });

      let resolvedToolNames: string[] = [];
      let checkpointCreated = false;
      engine.on('checkpoint:created', () => {
        checkpointCreated = true;
      });

      const toolResults: ToolResult[] = [];
      engine.on('tool:result', (ev) => {
        toolResults.push(ev);
      });

      const mockProvider = new MockProvider({
        script: [
          {
            thought: 'Attempting write, command, and coder subagent in ask mode',
            text: 'Testing guardrails',
            toolCalls: [
              {
                id: 'call_ask_write',
                name: 'write_file',
                arguments: { path: 'should_not_exist.txt', content: 'blocked' },
              },
              {
                id: 'call_ask_cmd',
                name: 'run_command',
                arguments: { command: 'echo blocked' },
              },
              {
                id: 'call_ask_coder',
                name: 'invoke_subagent',
                arguments: {
                  subagents: [
                    {
                      typeName: 'coder',
                      role: 'Blocked Coder',
                      prompt: 'Edit file',
                    },
                  ],
                },
              },
              {
                id: 'call_ask_list',
                name: 'list_files',
                arguments: { path: '.' },
              },
            ],
          },
          {
            thought: 'Done',
            text: 'Completed ask mode checks.',
          },
        ],
      });

      const origStream = mockProvider.streamCompletion.bind(mockProvider);
      mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        resolvedToolNames = tools.map((t) => t.name);
        return origStream(messages, systemPrompt, tools, onChunk, signal);
      };

      await engine.startTask('Explain the codebase without modifying anything', {
        mode: 'ask',
        customProvider: mockProvider,
      });

      // Mutating tools should be stripped from resolved tools exposed to LLM
      expect(resolvedToolNames).toContain('read_file');
      expect(resolvedToolNames).toContain('list_files');
      expect(resolvedToolNames).toContain('search_files');
      expect(resolvedToolNames).toContain('invoke_subagent');
      expect(resolvedToolNames).not.toContain('write_file');
      expect(resolvedToolNames).not.toContain('edit_file');
      expect(resolvedToolNames).not.toContain('run_command');
      expect(resolvedToolNames).not.toContain('swarm');
      expect(resolvedToolNames).not.toContain('schedule');
      expect(resolvedToolNames).not.toContain('define_subagent');

      // Git checkpoint should be skipped in ask mode
      expect(checkpointCreated).toBe(false);

      // Even if LLM forces blocked tool calls, ToolGuardPlugin must block them
      const writeRes = toolResults.find((r) => r.toolCallId === 'call_ask_write');
      const cmdRes = toolResults.find((r) => r.toolCallId === 'call_ask_cmd');
      const coderRes = toolResults.find((r) => r.toolCallId === 'call_ask_coder');
      const listRes = toolResults.find((r) => r.toolCallId === 'call_ask_list');

      expect(writeRes?.isError).toBe(true);
      expect(String(writeRes?.output)).toContain("disabled in 'ask' mode");
      expect(cmdRes?.isError).toBe(true);
      expect(String(cmdRes?.output)).toContain("disabled in 'ask' mode");
      expect(coderRes?.isError).toBe(true);
      expect(String(coderRes?.output)).toContain("not permitted in 'ask' mode");
      expect(listRes?.isError).not.toBe(true);

      // File must NOT have been created
      const blockedFileExists = await fs
        .access(path.join(tempTestDir, 'should_not_exist.txt'))
        .then(() => true)
        .catch(() => false);
      expect(blockedFileExists).toBe(false);
    });

    it('normalizes legacy modes like architect/test to code mode', async () => {
      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
      });

      let resolvedToolNames: string[] = [];
      const mockProvider = new MockProvider({
        script: [{ thought: 'Done', text: 'OK' }],
      });
      const origStream = mockProvider.streamCompletion.bind(mockProvider);
      mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        resolvedToolNames = tools.map((t) => t.name);
        return origStream(messages, systemPrompt, tools, onChunk, signal);
      };

      await engine.startTask('Legacy mode test', {
        mode: 'architect' as any,
        customProvider: mockProvider,
      });

      expect(engine.getTaskState()?.mode).toBe('code');
      expect(resolvedToolNames).toContain('write_file');
      expect(resolvedToolNames).toContain('run_command');
    });
  });

  describe('5. Strict Orchestration Mode Guardrails', () => {
    it('removes and blocks direct read/write/command tools for coordinator while allowing subagents to execute them', async () => {
      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
        gitCheckpointEnabled: false,
      });

      let coordinatorToolNames: string[] = [];
      let coordinatorSystemPrompt = '';
      const toolResults: ToolResult[] = [];
      engine.on('tool:result', (ev) => {
        toolResults.push(ev);
      });

      const parentProvider = new MockProvider({
        script: [
          {
            thought: 'Try direct tools first, then delegate to researcher and coder',
            text: 'Checking strict orchestration guardrails',
            toolCalls: [
              {
                id: 'call_strict_read',
                name: 'read_file',
                arguments: { path: 'sample.txt' },
              },
              {
                id: 'call_strict_edit',
                name: 'edit_file',
                arguments: { path: 'sample.txt', targetContent: 'a', replacementContent: 'b' },
              },
              {
                id: 'call_strict_cmd',
                name: 'run_command',
                arguments: { command: 'echo blocked' },
              },
              {
                id: 'call_strict_delegate',
                name: 'invoke_subagent',
                arguments: {
                  subagents: [
                    {
                      typeName: 'coder',
                      role: 'Strict Coder',
                      prompt: 'Create strict_created.txt with content "Created by coder"',
                    },
                  ],
                },
              },
            ],
          },
          {
            thought: 'Done',
            text: 'Delegated work completed.',
          },
        ],
      });

      const origParentStream = parentProvider.streamCompletion.bind(parentProvider);
      parentProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        if (coordinatorToolNames.length === 0) {
          coordinatorToolNames = tools.map((t) => t.name);
          coordinatorSystemPrompt = systemPrompt;
        }
        return origParentStream(messages, systemPrompt, tools, onChunk, signal);
      };

      const coderSubProvider = new MockProvider({
        script: [
          {
            thought: 'Write the requested file inside subagent context',
            text: 'Creating strict_created.txt',
            toolCalls: [
              {
                id: 'call_sub_write',
                name: 'write_file',
                arguments: { path: 'strict_created.txt', content: 'Created by coder' },
              },
            ],
          },
          {
            thought: 'Done',
            text: 'Created strict_created.txt successfully.',
          },
        ],
      });

      const origSpawn = engine.getSubagentManager().spawnSubagents.bind(engine.getSubagentManager());
      engine.getSubagentManager().spawnSubagents = async (paramsList) => {
        return origSpawn(
          paramsList.map((p) => ({
            ...p,
            customProvider: coderSubProvider,
          })),
        );
      };

      await engine.startTask('Implement feature using strict orchestration', {
        mode: 'code',
        subagentsEnabled: true,
        strictOrchestration: true,
        customProvider: parentProvider,
      });

      // Coordinator must NOT receive direct read/write/exec tools, but keeps orchestration tools
      expect(coordinatorToolNames).toContain('invoke_subagent');
      expect(coordinatorToolNames).toContain('manage_subagents');
      expect(coordinatorToolNames).toContain('swarm');
      expect(coordinatorToolNames).toContain('ask_question');
      expect(coordinatorToolNames).not.toContain('read_file');
      expect(coordinatorToolNames).not.toContain('list_files');
      expect(coordinatorToolNames).not.toContain('search_files');
      expect(coordinatorToolNames).not.toContain('write_file');
      expect(coordinatorToolNames).not.toContain('edit_file');
      expect(coordinatorToolNames).not.toContain('run_command');

      // System prompt must contain mandatory delegation instructions
      expect(coordinatorSystemPrompt).toContain('STRICT ORCHESTRATION MODE');
      expect(coordinatorSystemPrompt).toContain('Delegate codebase exploration and file inspection to `researcher`');

      // Direct tool calls forced by coordinator must be blocked with delegation hints
      const readRes = toolResults.find((r) => r.toolCallId === 'call_strict_read');
      const editRes = toolResults.find((r) => r.toolCallId === 'call_strict_edit');
      const cmdRes = toolResults.find((r) => r.toolCallId === 'call_strict_cmd');
      const delegateRes = toolResults.find((r) => r.toolCallId === 'call_strict_delegate');

      expect(readRes?.isError).toBe(true);
      expect(String(readRes?.output)).toContain('researcher');
      expect(editRes?.isError).toBe(true);
      expect(String(editRes?.output)).toContain('coder');
      expect(cmdRes?.isError).toBe(true);
      expect(String(cmdRes?.output)).toContain('reviewer');

      // Subagent must NOT be blocked by strict orchestration and actually creates the file
      expect(delegateRes?.isError).not.toBe(true);
      const createdContent = await fs.readFile(path.join(tempTestDir, 'strict_created.txt'), 'utf-8');
      expect(createdContent).toBe('Created by coder');
    });

    it('keeps direct tools available when subagentsEnabled is false even if strictOrchestration is true', async () => {
      const engine = new AgentCoreEngine({
        workspaceRoot: tempTestDir,
        experienceLearningEnabled: false,
        autoTestEnabled: false,
        gitCheckpointEnabled: false,
      });

      let resolvedToolNames: string[] = [];
      let capturedPrompt = '';
      const mockProvider = new MockProvider({
        script: [{ thought: 'Done', text: 'OK' }],
      });
      const origStream = mockProvider.streamCompletion.bind(mockProvider);
      mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        resolvedToolNames = tools.map((t) => t.name);
        capturedPrompt = systemPrompt;
        return origStream(messages, systemPrompt, tools, onChunk, signal);
      };

      await engine.startTask('Single agent fallback', {
        mode: 'code',
        subagentsEnabled: false,
        strictOrchestration: true,
        customProvider: mockProvider,
      });

      expect(resolvedToolNames).toContain('read_file');
      expect(resolvedToolNames).toContain('write_file');
      expect(resolvedToolNames).toContain('edit_file');
      expect(resolvedToolNames).toContain('run_command');
      expect(resolvedToolNames).not.toContain('invoke_subagent');
      expect(capturedPrompt).not.toContain('STRICT ORCHESTRATION MODE');
    });
  });
});
