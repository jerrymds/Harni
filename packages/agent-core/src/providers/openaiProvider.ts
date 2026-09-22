import * as crypto from 'node:crypto';
import {
  BaseLLMProvider,
  type ProviderCompletionResult,
  type ProviderOptions,
  type StreamChunk,
} from './baseProvider.js';
import type { ChatMessage, LLMProviderType, ToolCall, ToolDefinition } from '@harni/types';

export class OpenAIProvider extends BaseLLMProvider {
  public readonly providerType: LLMProviderType;
  public readonly defaultModel: string;
  private readonly oauth: boolean;
  private readonly accountId?: string;

  constructor(
    providerType: LLMProviderType = 'openai',
    options: ProviderOptions = {},
  ) {
    super(options);
    this.oauth = Boolean(options.openaiOAuth);
    this.accountId = options.openaiAccountId;
    this.providerType = providerType;

    if (providerType === 'ollama') {
      this.defaultModel = 'llama3.3';
      this.baseURL = options.baseURL || 'http://localhost:11434/v1';
    } else if (providerType === 'openrouter') {
      this.defaultModel = 'anthropic/claude-3.5-sonnet';
      this.baseURL = options.baseURL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    } else if (providerType === 'opencode') {
      this.defaultModel = 'claude-fable-5';
      this.baseURL = options.baseURL || process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1';
    } else if (providerType === 'custom') {
      this.defaultModel = options.model || 'default-model';
      this.baseURL = options.baseURL || process.env.CUSTOM_BASE_URL || 'http://localhost:8000/v1';
    } else {
      this.defaultModel = 'gpt-4o';
      this.baseURL = options.baseURL || 'https://api.openai.com/v1';
    }

    if (this.baseURL && !this.baseURL.startsWith('http://') && !this.baseURL.startsWith('https://')) {
      this.baseURL = this.baseURL.includes('localhost') || this.baseURL.includes('127.0.0.1')
        ? `http://${this.baseURL}`
        : `https://${this.baseURL}`;
    }
    this.baseURL = this.baseURL.replace(/\/+$/, '');

    this.model = options.model || this.defaultModel;
  }

  public async streamCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    const apiKey =
      this.apiKey ||
      (this.providerType === 'custom'
        ? process.env.CUSTOM_API_KEY || 'custom'
        : this.providerType === 'ollama'
          ? 'ollama'
          : this.providerType === 'openrouter'
            ? process.env.OPENROUTER_API_KEY
            : this.providerType === 'opencode'
              ? process.env.OPENCODE_API_KEY
              : process.env.OPENAI_API_KEY) ||
      '';

    if (!apiKey && this.providerType !== 'ollama' && this.providerType !== 'custom') {
      throw new Error(`${this.providerType} API Key is required.`);
    }

    if (this.providerType === 'openai' && this.oauth) {
      return this.streamCodexSubscription(messages, systemPrompt, tools, apiKey, onChunk, signal);
    }

    // Format OpenAI tools
    const formattedTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Format OpenAI messages
    const formattedMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      if (msg.role === 'user') {
        formattedMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: msg.content || null,
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

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.providerType} API Error (${response.status}): ${errorText}`,
      );
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
          const chunk = JSON.parse(dataStr);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Standard text
          if (delta.content) {
            fullText += delta.content;
            onChunk({ type: 'token', content: delta.content });
          }

          // Reasoning content (DeepSeek-R1 / OpenAI reasoning / OpenRouter delta.reasoning)
          const reasoning = delta.reasoning_content || delta.reasoning;
          if (reasoning) {
            fullThinking += reasoning;
            onChunk({ type: 'thinking', thought: reasoning });
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallsMap.get(idx) || {
                id: tc.id || `call_${Date.now()}_${idx}`,
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
          // ignore parsing error in chunk line
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

  private async streamCodexSubscription(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    accessToken: string,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    const input: Array<Record<string, unknown>> = [];
    for (const msg of messages) {
      if (msg.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: msg.toolCallId,
          output: typeof msg.toolResult?.output === 'string'
            ? msg.toolResult.output : JSON.stringify(msg.toolResult?.output ?? ''),
        });
        continue;
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        if (msg.content) input.push({ role: 'assistant', content: msg.content });
        for (const tc of msg.toolCalls) {
          input.push({ type: 'function_call', call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) });
        }
        continue;
      }
      input.push({ role: msg.role === 'system' ? 'developer' : msg.role, content: msg.content });
    }

    const formattedTools = tools.map((tool) => ({
      type: 'function', name: tool.name, description: tool.description,
      parameters: tool.parameters, strict: false,
    }));
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      originator: 'codex_cli_rs',
      'user-agent': 'codex-cli',
      'x-client-request-id': crypto.randomUUID(),
    };
    if (this.accountId) headers['ChatGPT-Account-ID'] = this.accountId;

    const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST', headers, signal,
      body: JSON.stringify({
        model: this.model || 'gpt-5.3-codex', instructions: systemPrompt, input,
        tools: formattedTools.length ? formattedTools : undefined,
        tool_choice: formattedTools.length ? 'auto' : undefined,
        parallel_tool_calls: true, stream: true, store: false,
        reasoning: this.thinkingDepth === 'off' ? undefined : { effort: this.thinkingDepth === 'ultra' ? 'high' : this.thinkingDepth, summary: 'auto' },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        detail = parsed.detail || parsed.error?.message || parsed.message || errorText;
      } catch {}
      throw new Error(`OpenAI 訂閱 API Error (${response.status}): ${String(detail).slice(0, 500)}`);
    }
    if (!response.body) throw new Error('OpenAI 訂閱回應內容為空');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let fullThinking = '';
    let completed = false;
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const event = JSON.parse(raw);
          if (event.type === 'response.output_text.delta' && event.delta) {
            fullText += event.delta;
            onChunk({ type: 'token', content: event.delta });
          } else if ((event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') && event.delta) {
            fullThinking += event.delta;
            onChunk({ type: 'thinking', thought: event.delta });
          } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(event.item.arguments || '{}'); } catch { args = { raw: event.item.arguments || '' }; }
            const call = { id: event.item.call_id || event.item.id, name: event.item.name, arguments: args };
            toolCalls.push(call);
            onChunk({ type: 'tool_call', ...call });
          } else if (event.type === 'response.completed' && event.response?.usage) {
            completed = true;
            const usage = event.response.usage;
            onChunk({ type: 'usage', usage: {
              promptTokens: usage.input_tokens || 0,
              completionTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
            } });
          } else if (event.type === 'response.completed') {
            completed = true;
          } else if (event.type === 'error') {
            throw new Error(event.message || event.error?.message || 'OpenAI 串流發生錯誤');
          } else if (event.type === 'response.failed') {
            throw new Error(event.response?.error?.message || 'OpenAI 無法產生回應');
          } else if (event.type === 'response.incomplete') {
            throw new Error(event.response?.incomplete_details?.reason || 'OpenAI 回應未完成');
          }
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
    if (!completed && !fullText && !toolCalls.length) {
      throw new Error('OpenAI 訂閱串流在沒有完成事件的情況下中斷。');
    }
    return { text: fullText, thinking: fullThinking || undefined, toolCalls: toolCalls.length ? toolCalls : undefined };
  }
}
