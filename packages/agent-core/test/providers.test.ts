import { describe, it, expect } from 'vitest';
import { ProviderFactory } from '../src/providers/providerFactory.js';
import { AntigravityProvider } from '../src/providers/antigravityProvider.js';
import { MockProvider } from '../src/providers/mockProvider.js';

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
});
