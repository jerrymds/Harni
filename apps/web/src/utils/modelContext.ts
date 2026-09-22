import type { LLMProviderType, ModelInfo } from '@harni/types';

/**
 * Default context window sizes per provider when neither ModelInfo nor exact model is matched.
 */
export const PROVIDER_DEFAULT_CONTEXT: Record<LLMProviderType, number> = {
  antigravity: 1048576, // 1M tokens default for Google Antigravity / Gemini
  anthropic: 200000,   // 200k tokens default for Claude 3.5 / 3.7
  cline: 131072,       // 128k/131k default for Cline Pass models
  openai: 128000,      // 128k default for GPT-4o
  ollama: 32768,       // 32k default for local Ollama
  openrouter: 128000,  // 128k default for OpenRouter
  opencode: 128000,    // 128k default for OpenCode
  custom: 128000,      // 128k default for custom endpoints
};

/**
 * Exact preset context window definitions for well-known models across all providers.
 */
export const MODEL_EXACT_CONTEXT: Record<string, number> = {
  // Google Antigravity / Gemini 3.x & 2.x
  'gemini-3.8-pro': 2097152,
  'gemini-3.8-flash': 1048576,
  'gemini-3.7-pro': 2097152,
  'gemini-3.7-flash': 1048576,
  'gemini-2.5-pro': 2097152,
  'gemini-2.5-flash': 1048576,
  'gemini-2.0-flash': 1048576,
  'gemini-2.0-flash-thinking-exp': 1048576,
  'gemini-1.5-pro': 2097152,
  'gemini-1.5-flash': 1048576,

  // Cline Pass Official Models
  'cline-pass/deepseek-v4-pro': 131072,
  'cline-pass/deepseek-v4-flash': 1048576,
  'cline-pass/kimi-k2.7-code': 200000,
  'cline-pass/kimi-k3': 200000,
  'cline-pass/kimi-k2.6': 200000,
  'cline-pass/glm-5.3': 131072,
  'cline-pass/glm-5.2': 131072,
  'cline-pass/qwen3.8-max': 131072,
  'cline-pass/qwen3.7-max': 131072,
  'cline-pass/qwen3.7-plus': 131072,
  'cline-pass/minimax-m3': 1000000,
  'cline-pass/mimo-v2.5-pro': 131072,
  'cline-pass/mimo-v2.5': 131072,

  // Anthropic Claude Official & OAuth
  'claude-sonnet-4-5-20250929': 200000,
  'claude-opus-4-1-20250805': 200000,
  'claude-3-7-sonnet-20250219': 200000,
  'claude-3-7-sonnet': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-5-haiku': 200000,
  'claude-3-opus-20240229': 200000,

  // OpenAI Models
  'gpt-4.5-preview': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'o1': 200000,
  'o1-mini': 128000,
  'o1-preview': 128000,
  'o3-mini': 200000,

  // DeepSeek Official & Gateway Models
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  'deepseek/deepseek-chat': 65536,
  'deepseek/deepseek-r1': 65536,
  'deepseek/deepseek-v4.1-flash': 1048576,
  'deepseek/deepseek-v4-flash': 1048576,
  'deepseek/deepseek-v4-pro': 131072,
  'deepseek-v4.1-flash': 1048576,
  'deepseek-v4-flash': 1048576,
  'deepseek-v4-pro': 131072,
};

/**
 * Resolves the maximum context window for a given model and provider.
 * Follows a 4-tier resolution hierarchy:
 * 1. Explicit modelInfo.contextWindow (if > 0)
 * 2. Exact match in MODEL_EXACT_CONTEXT
 * 3. Pattern / family heuristic match (e.g. Gemini Pro -> 2M, Claude -> 200k, MiniMax -> 1M)
 * 4. Provider default fallback (PROVIDER_DEFAULT_CONTEXT)
 */
export function resolveModelContextWindow(
  selectedModel?: string,
  selectedProvider?: LLMProviderType,
  modelInfo?: ModelInfo,
): number {
  // 1. Explicit modelInfo from backend / API
  if (modelInfo?.contextWindow && modelInfo.contextWindow > 0) {
    return modelInfo.contextWindow;
  }

  const modelId = (selectedModel || '').toLowerCase().trim();

  // 2. Exact match
  if (modelId && MODEL_EXACT_CONTEXT[modelId]) {
    return MODEL_EXACT_CONTEXT[modelId];
  }

  // 3. Pattern / family matching
  if (modelId) {
    if (modelId.includes('gemini') && (modelId.includes('pro') || modelId.includes('ultra') || modelId.includes('1.5-pro') || modelId.includes('2.5-pro') || modelId.includes('3.7-pro'))) {
      return 2097152;
    }
    if (modelId.includes('gemini')) {
      return 1048576;
    }
    if (modelId.includes('claude')) {
      return 200000;
    }
    if (modelId.includes('minimax')) {
      return 1000000;
    }
    if (modelId.includes('kimi') || modelId.includes('moonshot')) {
      return 200000;
    }
    if (modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.includes('o3-mini') || modelId.includes('o1-mini')) {
      return modelId.includes('mini') ? 128000 : 200000;
    }
    if (modelId.includes('gpt-4') || modelId.includes('gpt-4o') || modelId.includes('gpt-4.5')) {
      return 128000;
    }
    if (modelId.includes('qwen') || modelId.includes('glm') || modelId.includes('mimo')) {
      return 131072;
    }
    if (modelId.includes('deepseek')) {
      if (modelId.includes('flash')) {
        return 1048576;
      }
      if (modelId.includes('v4') || modelId.includes('pro')) {
        return 131072;
      }
      return 65536;
    }
    if (modelId.includes('llama-3.1') || modelId.includes('llama-3.2') || modelId.includes('llama-3.3')) {
      return 128000;
    }
  }

  // 4. Provider fallback
  if (selectedProvider && PROVIDER_DEFAULT_CONTEXT[selectedProvider]) {
    return PROVIDER_DEFAULT_CONTEXT[selectedProvider];
  }

  return 128000;
}

/**
 * Formats token count numbers to human-readable strings (e.g. 1.0M, 200k, 128k).
 */
export function formatTokenCount(num: number): string {
  if (num >= 1_000_000) {
    const val = num / 1_000_000;
    return `${val.toFixed(num % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (num >= 1_000) {
    const val = num / 1_000;
    return `${val.toFixed(num % 1_000 === 0 ? 0 : 1)}k`;
  }
  return `${num}`;
}
