import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentCoreEngine, MockProvider } from '../src/index.js';

describe('AgentCoreEngine Multi-turn Loop', () => {
  const tempTestDir = path.resolve('temp_test_engine_workspace');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  it('runs multi-turn task loop and emits stream events', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    const mockProvider = new MockProvider({
      script: [
        // Turn 1: Assistant decides to inspect and create a file
        {
          thought: 'I will write a greeting file.',
          text: 'Creating hello.txt now.',
          toolCalls: [
            {
              id: 'call_1',
              name: 'write_to_file',
              arguments: { path: 'hello.txt', content: 'Hello from cline-web Agent!' },
            },
          ],
        },
        // Turn 2: Assistant finishes the task
        {
          thought: 'The file has been created. I am done.',
          text: 'I have finished creating hello.txt successfully.',
        },
      ],
    });

    let tokenEventsReceived = 0;
    let thinkingEventsReceived = 0;
    let toolResultEventsReceived = 0;
    let completedEventReceived = false;

    engine.on('chat:token', () => { tokenEventsReceived++; });
    engine.on('chat:thinking', () => { thinkingEventsReceived++; });
    engine.on('tool:result', () => { toolResultEventsReceived++; });
    engine.on('task:status', (ev) => {
      if (ev.status === 'completed') completedEventReceived = true;
    });

    await engine.startTask('Create a greeting file in workspace', {
      customProvider: mockProvider,
    });

    expect(tokenEventsReceived).toBeGreaterThan(0);
    expect(thinkingEventsReceived).toBeGreaterThan(0);
    expect(toolResultEventsReceived).toBe(1);
    expect(completedEventReceived).toBe(true);

    const createdHello = await fs.readFile(path.join(tempTestDir, 'hello.txt'), 'utf-8');
    expect(createdHello).toBe('Hello from cline-web Agent!');
  });

  it('filters out subagent tools and orchestration prompt when subagentsEnabled is false', async () => {
    let capturedTools: string[] = [];
    let capturedSystemPrompt = '';

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'Done directly.',
          text: 'Finished without subagents.',
        },
      ],
    });

    const originalStream = mockProvider.streamCompletion.bind(mockProvider);
    mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk) => {
      capturedTools = tools.map((t) => t.name);
      capturedSystemPrompt = systemPrompt;
      return originalStream(messages, systemPrompt, tools, onChunk);
    };

    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    await engine.startTask('A task without subagents', {
      customProvider: mockProvider,
      subagentsEnabled: false,
    });

    expect(capturedTools).not.toContain('invoke_subagent');
    expect(capturedTools).not.toContain('send_message');
    expect(capturedTools).not.toContain('manage_subagents');
    expect(capturedTools).not.toContain('define_subagent');
    expect(capturedSystemPrompt).not.toContain('HIERARCHICAL MULTI-AGENT ORCHESTRATION');
  });

  it('includes subagent tools and orchestration prompt when subagentsEnabled is true', async () => {
    let capturedTools: string[] = [];
    let capturedSystemPrompt = '';

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'I can use subagents.',
          text: 'Multi-agent orchestration available.',
        },
      ],
    });

    const originalStream = mockProvider.streamCompletion.bind(mockProvider);
    mockProvider.streamCompletion = async (messages, systemPrompt, tools, onChunk) => {
      capturedTools = tools.map((t) => t.name);
      capturedSystemPrompt = systemPrompt;
      return originalStream(messages, systemPrompt, tools, onChunk);
    };

    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    await engine.startTask('A task with subagents', {
      customProvider: mockProvider,
      subagentsEnabled: true,
    });

    expect(capturedTools).toContain('invoke_subagent');
    expect(capturedTools).toContain('send_message');
    expect(capturedTools).toContain('manage_subagents');
    expect(capturedTools).toContain('define_subagent');
    expect(capturedSystemPrompt).toContain('HIERARCHICAL MULTI-AGENT ORCHESTRATION');
  });

  it('intercepts tool call if model attempts invoke_subagent while subagents are disabled', async () => {
    let toolResultReceived: any = null;

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'I want to call a subagent anyway.',
          text: 'Spawning subagent.',
          toolCalls: [
            {
              id: 'call_sub_1',
              name: 'invoke_subagent',
              arguments: {
                subagents: [{ typeName: 'researcher', role: 'test', prompt: 'test' }],
              },
            },
          ],
        },
        {
          thought: 'Understood, subagents are disabled.',
          text: 'I will solve it directly myself.',
        },
      ],
    });

    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    engine.on('tool:result', (ev) => {
      if (ev.toolCallId === 'call_sub_1') {
        toolResultReceived = ev;
      }
    });

    await engine.startTask('Test disabled subagent intercept', {
      customProvider: mockProvider,
      subagentsEnabled: false,
    });

    expect(toolResultReceived).toBeDefined();
    expect(toolResultReceived.isError).toBe(true);
    expect(toolResultReceived.output).toContain('disabled in settings');
  });
});
