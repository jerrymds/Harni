import { describe, it, expect, vi } from 'vitest';
import { AskQuestionTool } from '../src/tools/askQuestion.js';
import { AgentCoreEngine } from '../src/engine.js';
import type { ToolExecutionContext } from '../src/tools/baseTool.js';

describe('AskQuestionTool & HITL Interactive Prompting', () => {
  it('defines tool metadata and parameter schema correctly', () => {
    const tool = new AskQuestionTool();
    expect(tool.name).toBe('ask_question');
    expect(tool.requiresApproval).toBe(false);

    const def = tool.getDefinition();
    expect(def.parameters.required).toContain('question');
    expect(def.parameters.properties.question).toBeDefined();
    expect(def.parameters.properties.options).toBeDefined();
    expect(def.parameters.properties.is_multi_select).toBeDefined();
    expect(def.parameters.properties.allow_custom_input).toBeDefined();
  });

  it('rejects execution when question parameter is missing or empty', async () => {
    const tool = new AskQuestionTool();
    const context: ToolExecutionContext = { workspaceRoot: '.' };

    const resultEmpty = await tool.execute({ question: '   ' }, context);
    expect(resultEmpty.isError).toBe(true);
    expect(resultEmpty.output).toContain('必須提供非空白的 question');

    const resultMissing = await tool.execute({ question: '' }, context);
    expect(resultMissing.isError).toBe(true);
  });

  it('handles environment gracefully when context.askQuestion is not provided', async () => {
    const tool = new AskQuestionTool();
    const context: ToolExecutionContext = { workspaceRoot: '.' };

    const result = await tool.execute(
      { question: 'Which styling framework to use?' },
      context,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain('互動提問模式在此執行環境未啟用');
  });

  it('calls context.askQuestion and formats output with user selections and custom input', async () => {
    const tool = new AskQuestionTool();
    const mockAskQuestion = vi.fn().mockResolvedValue({
      answers: ['Tailwind CSS'],
      customInput: 'Please use version 4',
    });

    const context: ToolExecutionContext = {
      workspaceRoot: '.',
      askQuestion: mockAskQuestion,
    };

    const result = await tool.execute(
      {
        question: 'Which CSS framework should we install?',
        options: ['Tailwind CSS', 'Vanilla CSS', 'Styled Components'],
        is_multi_select: false,
        allow_custom_input: true,
      },
      context,
    );

    expect(mockAskQuestion).toHaveBeenCalledWith({
      question: 'Which CSS framework should we install?',
      options: ['Tailwind CSS', 'Vanilla CSS', 'Styled Components'],
      isMultiSelect: false,
      allowCustomInput: true,
    });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output as string);
    expect(parsed.selectedOptions).toEqual(['Tailwind CSS']);
    expect(parsed.customInput).toBe('Please use version 4');
    expect(result.summary).toContain('Tailwind CSS');
  });

  it('supports handleAnswerQuestion on AgentCoreEngine to resume execution', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: '.',
      defaultProvider: 'antigravity',
      autoApprove: true,
    });

    const emittedEvents: any[] = [];
    engine.on('question:ask', (payload) => {
      emittedEvents.push(payload);
    });

    let answered = false;
    setTimeout(() => {
      const handled = engine.handleAnswerQuestion(
        'call_q123',
        ['Zustand'],
        'Lightweight state',
        'session_test_1',
      );
      expect(handled).toBe(true);
      answered = true;
    }, 50);

    // Simulate task registered in tasksBySession
    const dummyTask: any = {
      sessionId: 'session_test_1',
      taskState: { id: 'task_1', status: 'idle', updatedAt: Date.now() },
      abortController: new AbortController(),
      pendingQuestion: null,
    };
    (engine as any).tasksBySession.set('session_test_1', dummyTask);

    // Simulate asking question via the engine promise mechanism
    const answerPromise = new Promise<{ answers: string[]; customInput?: string }>(
      (resolve) => {
        dummyTask.pendingQuestion = {
          toolCallId: 'call_q123',
          resolve,
        };
      },
    );

    const result = await answerPromise;
    expect(answered).toBe(true);
    expect(result.answers).toEqual(['Zustand']);
    expect(result.customInput).toBe('Lightweight state');
  });
});
