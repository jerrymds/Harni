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
    if (!type || typeof type !== 'string') {
      throw new Error(`Unsupported LLM provider type: ${String(type)}`);
    }

    if (type === 'cline') {
      return new ClineProvider(options);
    }

    if (type === 'anthropic' || type.startsWith('anthropic-')) {
      return new AnthropicProvider(options);
    }

    if (type === 'antigravity') {
      if (options.mockScript) {
        return new MockProvider({ ...options, script: options.mockScript });
      }
      return new AntigravityProvider(options);
    }

    if (options.mockScript) {
      return new MockProvider({ ...options, script: options.mockScript });
    }

    return new OpenAIProvider(type, options);
  }
}
