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

    const providerOptions: ProviderOptions = {
      ...options,
      sessionId: options.sessionId,
    };

    if (type === 'cline') {
      return new ClineProvider(providerOptions);
    }

    if (type === 'anthropic' || type.startsWith('anthropic-')) {
      return new AnthropicProvider(providerOptions);
    }

    if (type === 'antigravity') {
      if (options.mockScript) {
        return new MockProvider({ ...providerOptions, script: options.mockScript });
      }
      return new AntigravityProvider(providerOptions);
    }

    if (options.mockScript) {
      return new MockProvider({ ...providerOptions, script: options.mockScript });
    }

    return new OpenAIProvider(type, providerOptions);
  }
}
