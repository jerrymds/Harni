import { describe, it, expect, vi } from 'vitest';
import { ProviderFactory } from '../src/providers/providerFactory.js';
import { AntigravityProvider } from '../src/providers/antigravityProvider.js';
import { MockProvider } from '../src/providers/mockProvider.js';
import { OpenAIProvider } from '../src/providers/openaiProvider.js';
import type { ChatMessage } from '@harni/types';

describe('ProviderFactory & Providers', () => {
  it('creates AntigravityProvider instance with default model', () => {
    const agProvider = ProviderFactory.create('antigravity');
    expect(agProvider).toBeInstanceOf(AntigravityProvider);
    expect(agProvider.defaultModel).toBe('gemini-3.7-flash');
  });

  it('creates OpenRouter and OpenCode provider instances with default endpoints', () => {
    const openrouter = ProviderFactory.create('openrouter');
    expect(openrouter.providerType).toBe('openrouter');
    expect(openrouter.defaultModel).toBe('anthropic/claude-3.5-sonnet');
    expect(openrouter.baseURL).toBe('https://openrouter.ai/api/v1');

    const opencode = ProviderFactory.create('opencode');
    expect(opencode.providerType).toBe('opencode');
    expect(opencode.defaultModel).toBe('claude-fable-5');
    expect(opencode.baseURL).toBe('https://opencode.ai/zen/v1');
  });

  it('creates and executes MockProvider script', async () => {
    const mock = new MockProvider({
      script: [{ thought: 'thinking', text: 'hello' }],
    });
    const chunks: any[] = [];
    const result = await mock.streamCompletion([], 'sys', [], (chunk) => {
      chunks.push(chunk);
    });
    expect(result.text).toBe('hello');
    expect(result.thinking).toBe('thinking');
    expect(chunks.some((c) => c.type === 'thinking')).toBe(true);
    expect(chunks.some((c) => c.type === 'token')).toBe(true);
  });

  it('formats assistant messages with empty string instead of null for Ollama provider', async () => {
    const ollamaProvider = new OpenAIProvider('ollama', {
      baseURL: 'http://localhost:11434/v1',
    });

    let capturedPayload: any = null;
    const encoder = new TextEncoder();
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedPayload = JSON.parse(options.body as string);
      return {
        ok: true,
        body: fakeStream,
      } as any;
    });

    try {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'read_file',
              arguments: { path: 'test.txt' },
            },
          ],
        },
      ];

      await ollamaProvider.streamCompletion(messages, 'system prompt', [], () => {});

      expect(capturedPayload).not.toBeNull();
      const assistantMsg = capturedPayload.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      // Ollama expects content to be string (""), not null (<nil>)
      expect(assistantMsg.content).toBe('');
      expect(typeof assistantMsg.content).toBe('string');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('formats assistant messages with null for standard OpenAI provider when content is empty', async () => {
    const openaiProvider = new OpenAIProvider('openai', {
      apiKey: 'test-key',
    });

    let capturedPayload: any = null;
    const encoder = new TextEncoder();
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedPayload = JSON.parse(options.body as string);
      return {
        ok: true,
        body: fakeStream,
      } as any;
    });

    try {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'read_file',
              arguments: { path: 'test.txt' },
            },
          ],
        },
      ];

      await openaiProvider.streamCompletion(messages, 'system prompt', [], () => {});

      expect(capturedPayload).not.toBeNull();
      const assistantMsg = capturedPayload.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

