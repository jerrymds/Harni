import {
  BaseLLMProvider,
  type ProviderCompletionResult,
  type ProviderOptions,
  type StreamChunk,
} from './baseProvider.js';
import type { ChatMessage, LLMProviderType, ToolCall, ToolDefinition } from '@harni/types';

export class ClineProvider extends BaseLLMProvider {
  public readonly providerType: LLMProviderType = 'cline';
  public readonly defaultModel = 'cline-pass/deepseek-v4-pro';

  constructor(options: ProviderOptions = {}) {
    super(options);
    this.model = options.model || this.defaultModel;
    this.baseURL = options.baseURL || 'https://api.cline.bot/api/v1';
  }

  public async streamCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    const apiKey = this.apiKey || process.env.CLINE_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Cline API Key is required. Set CLINE_API_KEY environment variable or pass apiKey in options.',
      );
    }

    // Format tools for Cline API (OpenAI-compatible function schema)
    const formattedTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Format messages for Cline API
    const isOllama =
      typeof this.baseURL === 'string' &&
      (this.baseURL.includes(':11434') || this.baseURL.toLowerCase().includes('ollama'));

    const formattedMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt ?? '' },
    ];

    for (const msg of messages) {
      if (msg.role === 'user') {
        formattedMessages.push({ role: 'user', content: msg.content ?? '' });
      } else if (msg.role === 'assistant') {
        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: msg.content || (isOllama ? '' : null),
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc: ToolCall) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        formattedMessages.push(assistantMsg);
      } else if (msg.role === 'tool') {
        formattedMessages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content:
            typeof msg.toolResult?.output === 'string'
              ? msg.toolResult.output
              : JSON.stringify(msg.toolResult?.output ?? ''),
        });
      }
    }

    const payload = {
      model: this.model,
      messages: formattedMessages,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      stream: true,
      temperature: this.temperature,
    };

    // Normalize endpoint (ensure we hit /chat/completions)
    const normalizedBaseUrl = (this.baseURL || 'https://api.cline.bot/v1').replace(/\/+$/, '');
    const endpoint = normalizedBaseUrl.endsWith('/chat/completions')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cline API Error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let fullText = '';
    let fullThinking = '';
    const toolCallsMap = new Map<
      number,
      { id: string; name: string; argsString: string }
    >();
    let buffer = '';
    let streamFinished = false;

    while (!streamFinished) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') {
          streamFinished = true;
          break;
        }

        try {
          const chunk = JSON.parse(dataStr);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Standard text delta
          if (delta.content) {
            fullText += delta.content;
            onChunk({ type: 'token', content: delta.content });
          }

          // Reasoning / thinking delta (DeepSeek-R1 / Claude Extended Thinking through gateway)
          if (delta.reasoning_content || delta.thinking) {
            const thought = delta.reasoning_content || delta.thinking;
            fullThinking += thought;
            onChunk({ type: 'thinking', thought });
          }

          // Tool call deltas
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallsMap.get(idx) || {
                id: tc.id || `cline_call_${Date.now()}_${idx}`,
                name: tc.function?.name || '',
                argsString: '',
              };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.argsString += tc.function.arguments;
              toolCallsMap.set(idx, existing);
            }
          }
        } catch {
          // ignore stream parse errors
        }
      }
    }

    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    for (const tc of toolCallsMap.values()) {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(tc.argsString || '{}');
      } catch {
        parsedArgs = { raw: tc.argsString };
      }
      const toolCallObj = { id: tc.id, name: tc.name, arguments: parsedArgs };
      toolCalls.push(toolCallObj);
      onChunk({ type: 'tool_call', ...toolCallObj });
    }

    return {
      text: fullText,
      thinking: fullThinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
