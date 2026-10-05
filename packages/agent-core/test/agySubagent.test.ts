import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  AgyBinaryResolver,
  AgyProcessRunner,
  AgySubagentInstance,
  SubagentRegistry,
  SubagentManager,
} from '../src/index.js';

describe('Antigravity CLI (agy) Subagent Integration', () => {
  it('registers built-in agy subagent archetypes in SubagentRegistry', () => {
    const registry = new SubagentRegistry(true);

    expect(registry.has('agy')).toBe(true);
    expect(registry.has('agy-worker')).toBe(true);
    expect(registry.has('agy-researcher')).toBe(true);
    expect(registry.has('agy-tester')).toBe(true);

    const agyWorker = registry.get('agy-worker')!;
    expect(agyWorker.runnerType).toBe('agy');
    expect(agyWorker.role).toBe('Antigravity Autonomous Worker');

    const agyResearcher = registry.get('agy-researcher')!;
    expect(agyResearcher.runnerType).toBe('agy');
    expect(agyResearcher.agyOptions?.mode).toBe('plan');
    expect(agyResearcher.agyOptions?.effort).toBe('medium');

    const agyTester = registry.get('agy-tester')!;
    expect(agyTester.runnerType).toBe('agy');
    expect(agyTester.agyOptions?.effort).toBe('high');
  });

  it('resolves the agy binary path accurately via AgyBinaryResolver', async () => {
    const resolved = await AgyBinaryResolver.resolve();
    expect(resolved).toBeTruthy();
    expect(typeof resolved).toBe('string');
  });

  it('initializes AgySubagentInstance with proper metadata and initial state', () => {
    const instance = new AgySubagentInstance({
      id: 'sub_test_agy_1',
      parentId: 'parent_task_1',
      sessionId: 'session_123',
      depth: 1,
      definition: {
        name: 'agy-worker',
        role: 'Test Worker',
        description: 'Test worker description',
        systemPrompt: 'Do testing.',
        runnerType: 'agy',
        agyOptions: {
          effort: 'medium',
          timeoutMs: 60000,
        },
      },
      role: 'Test Worker',
      prompt: 'Refactor auth module',
      workspaceRoot: process.cwd(),
    });

    const info = instance.getInfo();
    expect(info.id).toBe('sub_test_agy_1');
    expect(info.runnerType).toBe('agy');
    expect(info.status).toBe('pending');
    expect(info.prompt).toBe('Refactor auth module');
    expect(instance.getMessages().length).toBe(0);
  });

  it('spawns agy subagent through SubagentManager and manages lifecycle events', async () => {
    const manager = new SubagentManager({
      workspaceRoot: process.cwd(),
    });

    // Mock AgyProcessRunner.run to avoid calling real external CLI during fast unit testing
    const runSpy = vi.spyOn(AgyProcessRunner, 'run').mockImplementation(async (options) => {
      options.onInit?.({
        conversationId: 'mock-conv-123',
        tools: ['read_file', 'write_to_file'],
      });
      options.onToken?.('Analyzing codebase...', false);
      options.onTool?.({
        toolName: 'read_file',
        summary: 'Read package.json',
        status: 'start',
      });
      options.onToken?.('Everything looks good!', false);

      return {
        conversationId: 'mock-conv-123',
        status: 'SUCCESS',
        response: 'Task completed successfully by agy.',
        durationSeconds: 1.5,
        usage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
        },
      };
    });

    let spawnedFired = false;
    let tokenFired = false;
    let toolFired = false;
    let completedFired = false;

    manager.on('subagent:spawned', (ev) => {
      if (ev.subagent.typeName === 'agy-worker') {
        spawnedFired = true;
      }
    });

    manager.on('subagent:token', (ev) => {
      if (ev.text.includes('Analyzing codebase')) {
        tokenFired = true;
      }
    });

    manager.on('subagent:tool', (ev) => {
      if (ev.toolName === 'read_file') {
        toolFired = true;
      }
    });

    manager.on('subagent:completed', (ev) => {
      if (ev.result.includes('Task completed successfully')) {
        completedFired = true;
      }
    });

    const results = await manager.spawnSubagents([
      {
        typeName: 'agy-worker',
        role: 'Autonomous Coder',
        prompt: 'Implement test feature',
        sessionId: 'session_mock_1',
        parentId: 'task_parent_1',
      },
    ]);

    expect(results.length).toBe(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].result).toContain('Task completed successfully by agy');
    expect(spawnedFired).toBe(true);
    expect(tokenFired).toBe(true);
    expect(toolFired).toBe(true);
    expect(completedFired).toBe(true);

    const instance = manager.getInstance(results[0].id) as AgySubagentInstance;
    expect(instance).toBeDefined();
    expect(instance.getConversationId()).toBe('mock-conv-123');
    expect(instance.getLastUsage()?.totalTokens).toBe(165);

    // Test receiveMessage multi-turn continuation with conversationId
    const reply = await manager.sendMessage(results[0].id, 'Check lint status now');
    expect(reply).toContain('Task completed successfully');

    runSpy.mockRestore();
  });

  it('handles cancellation and aborting of agy subagents properly', async () => {
    const manager = new SubagentManager({
      workspaceRoot: process.cwd(),
    });

    vi.spyOn(AgyProcessRunner, 'run').mockImplementation(async (options) => {
      return new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => {
          resolve({
            conversationId: 'mock-abort-123',
            status: 'CANCELLED',
            response: 'Task was cancelled.',
          });
        });
      });
    });

    const spawnPromise = manager.spawnSubagents([
      {
        typeName: 'agy-worker',
        role: 'Long Running Worker',
        prompt: 'Infinite work',
        sessionId: 'session_cancel_test',
        parentId: 'parent_1',
      },
    ]);

    // Give it a tiny tick to register
    await new Promise((r) => setTimeout(r, 10));

    const instances = manager.getInstancesBySession('session_cancel_test');
    expect(instances.length).toBe(1);

    // Kill the subagent
    manager.manageSubagents('kill', [instances[0].id]);

    const results = await spawnPromise;
    expect(results[0].status).toBe('cancelled');

    vi.restoreAllMocks();
  });

  it('automatically routes "researcher" to "agy-researcher" when provider is antigravity or Anthropic key is absent', async () => {
    const manager = new SubagentManager({
      workspaceRoot: process.cwd(),
      defaultProvider: 'antigravity',
    });

    const runSpy = vi.spyOn(AgyProcessRunner, 'run').mockResolvedValue({
      conversationId: 'mock-conv-fallback',
      status: 'SUCCESS',
      response: 'Architecture analysis complete: monorepo with packages and apps.',
      durationSeconds: 1.0,
      usage: { totalTokens: 100 },
    });

    // Subagent request uses generic 'researcher', but environment runs under antigravity
    const results = await manager.spawnSubagents([
      {
        typeName: 'researcher',
        role: 'Codebase Researcher',
        prompt: '列出專案架構',
        sessionId: 'session_fallback_test',
        parentId: 'parent_task_1',
      },
    ]);

    expect(results.length).toBe(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].result).toContain('Architecture analysis complete');

    const instance = manager.getInstance(results[0].id) as AgySubagentInstance;
    expect(instance).toBeDefined();
    expect(instance.runnerType).toBe('agy');
    expect(instance.getInfo().typeName).toBe('agy-researcher');

    runSpy.mockRestore();
  });

  it('sanitizes external/proxy model strings and allows effort on valid models', () => {
    expect(AgyProcessRunner.sanitizeModel('cline-pass/mimo-v2.5')).toBeUndefined();
    expect(AgyProcessRunner.sanitizeModel('openai/gpt-4o')).toBeUndefined();
    expect(AgyProcessRunner.sanitizeModel('anthropic/claude-3-5-sonnet')).toBeUndefined();
    expect(AgyProcessRunner.sanitizeModel('gemini-3.8-flash-medium')).toBe('gemini-3.8-flash-medium');
    expect(AgyProcessRunner.sanitizeModel('google/gemini-3.7-flash')).toBe('gemini-3.7-flash');
    expect(AgyProcessRunner.sanitizeModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('accurately parses real agy stream-json events with step_type "tool" and updates currentToolSummary', async () => {
    const instance = new AgySubagentInstance({
      id: 'sub_tool_test',
      parentId: 'p1',
      sessionId: 's1',
      depth: 1,
      definition: {
        name: 'agy-researcher',
        systemPrompt: 'Explore',
        runnerType: 'agy',
      },
      role: 'Researcher',
      prompt: 'Check files',
      workspaceRoot: process.cwd(),
    });

    const runSpy = vi.spyOn(AgyProcessRunner, 'run').mockImplementation(async (options) => {
      // Simulate real agy step_update with step_type="tool" and state="ACTIVE"
      options.onTool?.({
        toolName: 'view_file',
        summary: 'view_file: apps/desktop/package.json',
        status: 'start',
      });

      expect(instance.getInfo().currentToolSummary).toBe('view_file: apps/desktop/package.json');
      expect(instance.getInfo().toolCallCount).toBe(1);

      // Simulate completion of tool step
      options.onTool?.({
        toolName: 'view_file',
        summary: 'view_file: apps/desktop/package.json',
        status: 'complete',
      });

      // toolCallCount should NOT double-count on complete
      expect(instance.getInfo().toolCallCount).toBe(1);
      expect(instance.getInfo().currentToolSummary).toBeUndefined();

      return {
        conversationId: 'mock-conv-tool',
        status: 'SUCCESS',
        response: 'Exploration finished',
      };
    });

    const result = await instance.run();
    expect(result.status).toBe('completed');
    expect(result.toolCallCount).toBe(1);
    expect(instance.getInfo().currentToolSummary).toBeUndefined();

    runSpy.mockRestore();
  });
});

