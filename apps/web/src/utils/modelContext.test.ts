import { describe, it, expect } from 'vitest';
import {
  resolveModelContextWindow,
  formatTokenCount,
  PROVIDER_DEFAULT_CONTEXT,
  MODEL_EXACT_CONTEXT,
} from './modelContext.js';

describe('Model Context Window Resolver & Formatting', () => {
  it('resolves explicit contextWindow from ModelInfo with highest priority', () => {
    const custom = {
      id: 'custom-model',
      name: 'Custom',
      contextWindow: 524288,
    };
    expect(resolveModelContextWindow('custom-model', 'custom', custom)).toBe(524288);
  });

  it('resolves Google Antigravity & Gemini models accurately', () => {
    expect(resolveModelContextWindow('gemini-3.7-flash', 'antigravity')).toBe(1048576);
    expect(resolveModelContextWindow('gemini-3.7-pro', 'antigravity')).toBe(2097152);
    expect(resolveModelContextWindow('gemini-2.5-flash', 'antigravity')).toBe(1048576);
    expect(resolveModelContextWindow('gemini-2.5-pro', 'antigravity')).toBe(2097152);
    expect(resolveModelContextWindow('gemini-1.5-pro-preview-0514', 'antigravity')).toBe(2097152);
  });

  it('resolves Anthropic Claude models accurately', () => {
    expect(resolveModelContextWindow('claude-3-7-sonnet-20250219', 'anthropic')).toBe(200000);
    expect(resolveModelContextWindow('claude-sonnet-4-5-20250929', 'anthropic')).toBe(200000);
    expect(resolveModelContextWindow('claude-3-5-haiku-20241022', 'anthropic')).toBe(200000);
  });

  it('resolves OpenAI models accurately', () => {
    expect(resolveModelContextWindow('o3-mini', 'openai')).toBe(200000);
    expect(resolveModelContextWindow('o1', 'openai')).toBe(200000);
    expect(resolveModelContextWindow('gpt-4o', 'openai')).toBe(128000);
    expect(resolveModelContextWindow('gpt-4.5-preview', 'openai')).toBe(128000);
  });

  it('resolves Cline Pass models accurately', () => {
    expect(resolveModelContextWindow('cline-pass/deepseek-v4-pro', 'cline')).toBe(131072);
    expect(resolveModelContextWindow('cline-pass/deepseek-v4-flash', 'cline')).toBe(1048576);
    expect(resolveModelContextWindow('cline-pass/kimi-k3', 'cline')).toBe(200000);
    expect(resolveModelContextWindow('cline-pass/minimax-m3', 'cline')).toBe(1000000);
    expect(resolveModelContextWindow('cline-pass/glm-5.3', 'cline')).toBe(131072);
  });

  it('resolves DeepSeek models accurately including deepseek-v4.1-flash', () => {
    expect(resolveModelContextWindow('deepseek/deepseek-v4.1-flash', 'cline')).toBe(1048576);
    expect(resolveModelContextWindow('deepseek/deepseek-v4-flash', 'cline')).toBe(1048576);
    expect(resolveModelContextWindow('deepseek/deepseek-v4-pro', 'cline')).toBe(131072);
    expect(resolveModelContextWindow('deepseek/deepseek-chat', 'cline')).toBe(65536);
    // Heuristic test for unmapped flash model
    expect(resolveModelContextWindow('deepseek/deepseek-v5-flash', 'cline')).toBe(1048576);
  });

  it('falls back to provider default when model is unknown', () => {
    expect(resolveModelContextWindow('unknown-model-xyz', 'antigravity')).toBe(1048576);
    expect(resolveModelContextWindow('unknown-model-xyz', 'anthropic')).toBe(200000);
    expect(resolveModelContextWindow('unknown-model-xyz', 'ollama')).toBe(32768);
    expect(resolveModelContextWindow('unknown-model-xyz', 'openrouter')).toBe(128000);
    expect(resolveModelContextWindow('unknown-model-xyz', 'opencode')).toBe(128000);
    expect(resolveModelContextWindow('unknown-model-xyz', 'custom')).toBe(128000);
  });

  it('formats token counts correctly', () => {
    expect(formatTokenCount(2097152)).toBe('2.1M');
    expect(formatTokenCount(1048576)).toBe('1.0M');
    expect(formatTokenCount(1000000)).toBe('1M');
    expect(formatTokenCount(200000)).toBe('200k');
    expect(formatTokenCount(128000)).toBe('128k');
    expect(formatTokenCount(65536)).toBe('65.5k');
    expect(formatTokenCount(850)).toBe('850');
  });
});
