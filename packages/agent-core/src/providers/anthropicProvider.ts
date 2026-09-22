import {
  BaseLLMProvider,
  type ProviderCompletionResult,
  type ProviderOptions,
  type StreamChunk,
} from './baseProvider.js';
import type { ChatMessage, LLMProviderType, ToolDefinition } from '@harni/types';

/** First system block Anthropic requires for Claude Code OAuth tokens. */
const CLAUDE_CODE_SYSTEM_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

export class AnthropicProvider extends BaseLLMProvider {
  public readonly providerType: LLMProviderType = 'anthropic';
  public readonly defaultModel = 'claude-3-5-sonnet-20241022';

  private readonly oauth: boolean;

  constructor(options: ProviderOptions = {}) {
    super(options);
    this.model = options.model || this.defaultModel;
    this.baseURL = options.baseURL || 'https://api.anthropic.com/v1';
    this.oauth = Boolean(options.anthropicOAuth);
  }

  public async streamCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    const apiKey = this.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API Key is required. Set ANTHROPIC_API_KEY environment variable or pass apiKey.');
    }
    const isOAuth = this.oauth || apiKey.startsWith('sk-ant-oat');

    // Format tools for Anthropic
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    // Format messages for Anthropic
    const formattedMessages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<Record<string, unknown>>;
    }> = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        formattedMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const contentBlocks: Array<Record<string, unknown>> = [];
        if (msg.thinking) {
          contentBlocks.push({ type: 'thinking', thinking: msg.thinking });
        }
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        formattedMessages.push({ role: 'assistant', content: contentBlocks.length > 0 ? contentBlocks : msg.content });
      } else if (msg.role === 'tool') {
        formattedMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              is_error: msg.toolResult?.isError ?? false,
              content: typeof msg.toolResult?.output === 'string'
                ? msg.toolResult.output
                : JSON.stringify(msg.toolResult?.output ?? ''),
            },
          ],
        });
      }
    }

    // Claude Code OAuth tokens require the Claude Code identity as the first
    // system block; a plain string system prompt is rejected.
    const system = isOAuth
      ? [
          { type: 'text', text: CLAUDE_CODE_SYSTEM_IDENTITY },
          { type: 'text', text: systemPrompt },
        ]
      : systemPrompt;

    const payload = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: formattedMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      stream: true,
    };

    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    if (isOAuth) {
      headers.authorization = `Bearer ${apiKey}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
    } else {
      headers['x-api-key'] = apiKey;
    }

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (isOAuth && (response.status === 401 || response.status === 403)) {
        throw new Error(
          `Claude 訂閱登入失效或無權限 (${response.status})。請於「設定 → 模型」重新登入 Claude。訊息：${errorText.slice(0, 300)}`,
        );
      }
      throw new Error(`Anthropic API Error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let fullText = '';
    let fullThinking = '';
    const toolCallsMap = new Map<number, { id: string; name: string; argsString: string }>();
    let currentBlockType: string | null = null;
    let currentBlockIndex = 0;

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') break;

        try {
          const event = JSON.parse(dataStr);
          if (event.type === 'content_block_start') {
            currentBlockIndex = event.index;
            currentBlockType = event.content_block?.type;
            if (currentBlockType === 'tool_use') {
              toolCallsMap.set(currentBlockIndex, {
                id: event.content_block.id,
                name: event.content_block.name,
                argsString: '',
              });
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta') {
              const text = event.delta.text;
              fullText += text;
              onChunk({ type: 'token', content: text });
            } else if (event.delta?.type === 'thinking_delta') {
              const thought = event.delta.thinking;
              fullThinking += thought;
              onChunk({ type: 'thinking', thought });
            } else if (event.delta?.type === 'input_json_delta') {
              const existing = toolCallsMap.get(currentBlockIndex);
              if (existing) {
                existing.argsString += event.delta.partial_json;
              }
            }
          }
        } catch {
          // ignore parse errors in SSE line
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
