import { describe, it, expect } from 'vitest';
import { ContextManager } from '../src/index.js';

describe('ContextManager', () => {
  it('records messages and estimates tokens', () => {
    const ctx = new ContextManager();
    ctx.addMessage({ id: '1', role: 'user', content: 'Hello Agent', timestamp: Date.now() });
    ctx.addMessage({ id: '2', role: 'assistant', content: 'Hello User! I can help you code.', timestamp: Date.now() });

    expect(ctx.getMessages().length).toBe(2);
    expect(ctx.estimateTokens()).toBeGreaterThan(0);
  });

  it('allows clearing and resetting context', () => {
    const ctx = new ContextManager();
    ctx.addMessage({ id: '1', role: 'user', content: 'Hello', timestamp: Date.now() });
    expect(ctx.getMessages().length).toBe(1);

    ctx.clear();
    expect(ctx.getMessages().length).toBe(0);
  });

  it('prunes oversized tool message content even in early turns when exceeding maxContextTokens', () => {
    // Set a lower threshold for test
    const ctx = new ContextManager({ maxContextTokens: 1000 });
    ctx.addMessage({ id: '1', role: 'user', content: 'Search for 0050', timestamp: Date.now() });
    ctx.addMessage({ id: '2', role: 'assistant', content: 'Calling tool', timestamp: Date.now() });

    const hugeOutput = 'MATCH_LINE '.repeat(3000); // 33,000 chars => ~8,250 tokens
    ctx.addMessage({
      id: '3',
      role: 'tool',
      content: hugeOutput,
      toolCallId: 'call_1',
      toolResult: { toolCallId: 'call_1', isError: false, output: hugeOutput },
      timestamp: Date.now(),
    });

    const messages = ctx.getMessages();
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    // Tool message content should have been truncated
    expect(toolMsg!.content.length).toBeLessThan(hugeOutput.length);
    expect(toolMsg!.content).toContain('Context 管理器自動壓縮');
    // toolResult.output should also be compressed
    expect(typeof toolMsg!.toolResult?.output).toBe('string');
    expect(toolMsg!.toolResult!.output).toContain('Context 管理器自動壓縮');
  });
});

