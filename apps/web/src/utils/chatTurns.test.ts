import { describe, it, expect } from 'vitest';
import { groupMessagesIntoTurns } from './chatTurns.js';
import type { ChatMessage } from '@harni/types';

describe('chatTurns utility', () => {
  it('returns empty array when messages is empty', () => {
    expect(groupMessagesIntoTurns([], false)).toEqual([]);
  });

  it('correctly handles simple Q&A without tools', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Hello, what can you do?',
        timestamp: 1000,
      },
      {
        id: 'msg_asst_1',
        role: 'assistant',
        content: 'I am your coding assistant!',
        timestamp: 1001,
      },
    ];

    const turns = groupMessagesIntoTurns(messages, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage?.content).toBe('Hello, what can you do?');
    expect(turns[0].intermediateCommands).toHaveLength(0);
    expect(turns[0].finalAssistantMessage?.content).toBe('I am your coding assistant!');
    expect(turns[0].isFinished).toBe(true);
  });

  it('groups intermediate tool and command messages into intermediateCommands', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Run tests and fix issues',
        timestamp: 1000,
      },
      {
        id: 'msg_asst_step1',
        role: 'assistant',
        content: '',
        thinking: 'Let me run the test suite.',
        toolCalls: [{ id: 'tc_1', name: 'execute_command', arguments: { command: 'npm test' } }],
        timestamp: 1001,
      },
      {
        id: 'msg_tool_1',
        role: 'tool',
        name: 'execute_command',
        content: 'FAIL src/index.test.ts',
        toolCallId: 'tc_1',
        toolResult: { isError: false, output: 'FAIL src/index.test.ts', summary: 'execute_command (npm test)' },
        timestamp: 1002,
      },
      {
        id: 'msg_tool_2',
        role: 'tool',
        name: 'replace_file_content',
        content: 'Success',
        toolCallId: 'tc_2',
        toolResult: { isError: false, output: 'File updated', summary: 'replace_file_content src/index.ts' },
        timestamp: 1003,
      },
      {
        id: 'msg_asst_final',
        role: 'assistant',
        content: 'All issues fixed and tests pass now!',
        timestamp: 1004,
      },
    ];

    const turns = groupMessagesIntoTurns(messages, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage?.id).toBe('msg_user_1');
    expect(turns[0].intermediateCommands).toHaveLength(3); // asst_step1, tool_1, tool_2
    expect(turns[0].finalAssistantMessage?.id).toBe('msg_asst_final');
    expect(turns[0].finalAssistantMessage?.content).toBe('All issues fixed and tests pass now!');
    expect(turns[0].isFinished).toBe(true);
  });

  it('marks isFinished = false on the latest turn when isBusy is true', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Check directory contents',
        timestamp: 1000,
      },
      {
        id: 'msg_tool_1',
        role: 'tool',
        name: 'list_files',
        content: 'src package.json',
        toolResult: { isError: false, output: 'src\npackage.json', summary: 'list_files' },
        timestamp: 1001,
      },
    ];

    const turns = groupMessagesIntoTurns(messages, true);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage?.id).toBe('msg_user_1');
    expect(turns[0].intermediateCommands).toHaveLength(1);
    expect(turns[0].finalAssistantMessage).toBeUndefined();
    expect(turns[0].isFinished).toBe(false);
  });

  it('handles multi-turn dialogues with previous turns marked isFinished = true', () => {
    const messages: ChatMessage[] = [
      // Turn 1
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Turn 1 prompt',
        timestamp: 1000,
      },
      {
        id: 'msg_tool_1',
        role: 'tool',
        content: 'tool 1 result',
        timestamp: 1001,
      },
      {
        id: 'msg_asst_1',
        role: 'assistant',
        content: 'Turn 1 answer',
        timestamp: 1002,
      },
      // Turn 2 (running)
      {
        id: 'msg_user_2',
        role: 'user',
        content: 'Turn 2 prompt',
        timestamp: 2000,
      },
      {
        id: 'msg_tool_2',
        role: 'tool',
        content: 'tool 2 result',
        timestamp: 2001,
      },
    ];

    const turns = groupMessagesIntoTurns(messages, true);
    expect(turns).toHaveLength(2);

    // Turn 1
    expect(turns[0].userMessage?.content).toBe('Turn 1 prompt');
    expect(turns[0].intermediateCommands).toHaveLength(1);
    expect(turns[0].finalAssistantMessage?.content).toBe('Turn 1 answer');
    expect(turns[0].isFinished).toBe(true);

    // Turn 2
    expect(turns[1].userMessage?.content).toBe('Turn 2 prompt');
    expect(turns[1].intermediateCommands).toHaveLength(1);
    expect(turns[1].finalAssistantMessage).toBeUndefined();
    expect(turns[1].isFinished).toBe(false);
  });

  it('handles leading assistant messages before any user prompt', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg_asst_greeting',
        role: 'assistant',
        content: 'Welcome to Coding Agent!',
        timestamp: 500,
      },
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Hi',
        timestamp: 1000,
      },
      {
        id: 'msg_asst_1',
        role: 'assistant',
        content: 'Hello!',
        timestamp: 1001,
      },
    ];

    const turns = groupMessagesIntoTurns(messages, false);
    expect(turns).toHaveLength(2);
    expect(turns[0].userMessage).toBeUndefined();
    expect(turns[0].finalAssistantMessage?.content).toBe('Welcome to Coding Agent!');
    expect(turns[1].userMessage?.content).toBe('Hi');
    expect(turns[1].finalAssistantMessage?.content).toBe('Hello!');
  });
});
