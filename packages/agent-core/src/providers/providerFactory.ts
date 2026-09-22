import { AnthropicProvider } from './anthropicProvider.js';
import { AntigravityProvider } from './antigravityProvider.js';
import { BaseLLMProvider, type ProviderOptions } from './baseProvider.js';
import { ClineProvider } from './clineProvider.js';
import { MockProvider, type MockScriptStep } from './mockProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import type { LLMProviderType } from '@harni/types';

export class ProviderFactory {
  public static create(
    type: LLMProviderType,
    options: ProviderOptions & { mockScript?: MockScriptStep[] } = {},
  ): BaseLLMProvider {
    switch (type) {
      case 'cline':
        return new ClineProvider(options);
      case 'anthropic':
        return new AnthropicProvider(options);
      case 'antigravity':
        if (options.mockScript) {
          return new MockProvider({ ...options, script: options.mockScript });
        }
        return new AntigravityProvider(options);
      case 'openai':
      case 'ollama':
      case 'openrouter':
      case 'opencode':
      case 'custom':
        if (options.mockScript) {
          return new MockProvider({ ...options, script: options.mockScript });
        }
        return new OpenAIProvider(type, options);
      default:
        throw new Error(`Unsupported LLM provider type: ${type}`);
    }
  }
}
