import {
  BaseLLMProvider,
  type ProviderCompletionResult,
  type ProviderOptions,
  type StreamChunk,
} from './baseProvider.js';
import type { ChatMessage, LLMProviderType, ToolDefinition } from '@harni/types';

export interface MockScriptStep {
  thought?: string;
  text?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
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
  ): Promise<ProviderCompletionResult> {
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

    // Stream thinking
    if (step.thought) {
      for (const word of step.thought.split(' ')) {
        onChunk({ type: 'thinking', thought: word + ' ' });
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    // Stream text
    if (step.text) {
      for (const word of step.text.split(' ')) {
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

    return {
      text: step.text || '',
      thinking: step.thought,
      toolCalls: step.toolCalls,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };
  }
}
