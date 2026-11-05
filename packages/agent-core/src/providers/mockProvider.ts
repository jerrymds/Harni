import {
  BaseLLMProvider,
  type ProviderCompletionResult,
  type ProviderOptions,
  type StreamChunk,
} from './baseProvider.js';
import type { ChatMessage, LLMProviderType, TokenUsage, ToolDefinition } from '@harni/types';

export interface MockScriptStep {
  thought?: string;
  text?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: TokenUsage;
  usageChunk?: TokenUsage;
  latencyMs?: number;
}

export class MockProvider extends BaseLLMProvider {
  public readonly providerType: LLMProviderType = 'ollama';
  public readonly defaultModel = 'mock-model-v1';
  private scriptSteps: MockScriptStep[] = [];
  private stepIndex = 0;

  constructor(options: ProviderOptions & { script?: MockScriptStep[] } = {}) {
    super(options);
    this.model = options.model || this.defaultModel;
    if (options.script) {
      this.scriptSteps = options.script;
    }
  }

  public setScript(script: MockScriptStep[]): void {
    this.scriptSteps = script;
    this.stepIndex = 0;
  }

  public async streamCompletion(
    messages: ChatMessage[],
    _systemPrompt: string,
    _tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    if (signal?.aborted) {
      throw new Error('Subagent execution cancelled');
    }

    // If a custom script is provided, use the current step
    let step: MockScriptStep;
    if (this.scriptSteps.length > 0 && this.stepIndex < this.scriptSteps.length) {
      step = this.scriptSteps[this.stepIndex]!;
      this.stepIndex++;
    } else {
      // Default heuristic response
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'tool') {
        step = {
          thought: 'The tool executed successfully. I will now inform the user.',
          text: `Task executed with result: ${typeof lastMsg.toolResult?.output === 'string' ? lastMsg.toolResult.output.slice(0, 100) : 'Done'}.`,
        };
      } else {
        step = {
          thought: 'I will list the workspace directory to understand the project.',
          text: 'Let me inspect the workspace structure first.',
          toolCalls: [
            {
              id: `mock_call_${Date.now()}`,
              name: 'list_files',
              arguments: { path: '.', recursive: false },
            },
          ],
        };
      }
    }

    if (step.latencyMs && step.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, step.latencyMs);

        const onAbort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('Subagent execution cancelled'));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    // Stream thinking
    if (step.thought) {
      for (const word of step.thought.split(' ')) {
        if (signal?.aborted) {
          throw new Error('Subagent execution cancelled');
        }
        onChunk({ type: 'thinking', thought: word + ' ' });
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    // Stream text
    if (step.text) {
      for (const word of step.text.split(' ')) {
        if (signal?.aborted) {
          throw new Error('Subagent execution cancelled');
        }
        onChunk({ type: 'token', content: word + ' ' });
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    // Emit tool calls
    if (step.toolCalls) {
      for (const tc of step.toolCalls) {
        onChunk({ type: 'tool_call', ...tc });
      }
    }

    if (step.usageChunk) {
      onChunk({ type: 'usage', usage: step.usageChunk });
    }

    return {
      text: step.text || '',
      thinking: step.thought,
      toolCalls: step.toolCalls,
      usage: step.usage || {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };
  }
}
