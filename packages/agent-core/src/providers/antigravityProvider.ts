import {
  BaseLLMProvider,
  type ProviderCompletionResult,
  type ProviderOptions,
  type StreamChunk,
} from './baseProvider.js';
import { normalizeToolCall } from '../tools/toolAdapter.js';
import type { ChatMessage, LLMProviderType, ThinkingDepth, ToolDefinition } from '@harni/types';

/**
 * 組裝 Antigravity 模型名稱與思考等級。
 *
 * 規則：
 * 1. 若 model 為空，預設回傳 'gemini-3.8-flash-medium'。
 * 2. 若包含 :acp 後綴，先分離後綴；若是 gpt-oss-120b-medium 或已包含 -(low|medium|high)，不重複加後綴，維持原名稱。
 * 3. 思考等級映射：'low' ➜ 'low'；'high' 或 'ultra' ➜ 'high'；'medium'、'off' 或預設 ➜ 'medium'。
 * 4. 組裝成 `${base}-${targetDepth}`，並視情況補回 :acp（例如 claude-sonnet-5-5-high:acp）。
 */
export function composeAntigravityModel(model?: string, depth?: ThinkingDepth): string {
  const trimmed = (model || '').trim();
  if (!trimmed) {
    return 'gemini-3.8-flash-medium';
  }

  const hasAcp = trimmed.toLowerCase().endsWith(':acp');
  const base = hasAcp ? trimmed.slice(0, -4) : trimmed;

  if (base.toLowerCase() === 'gpt-oss-120b-medium' || /-(low|medium|high)$/i.test(base)) {
    return trimmed;
  }

  let targetDepth = 'medium';
  if (depth === 'low') {
    targetDepth = 'low';
  } else if (depth === 'high' || depth === 'ultra') {
    targetDepth = 'high';
  } else {
    targetDepth = 'medium';
  }

  const composed = `${base}-${targetDepth}`;
  return hasAcp ? `${composed}:acp` : composed;
}

/** 串流 idle timeout：超過此時間未收到任何資料即視為 Bridge 卡住並拋錯 (預設 90 秒) */
const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

export interface AntigravityProviderOptions extends ProviderOptions {
  authData?: Record<string, unknown>;
}

export class AntigravityProvider extends BaseLLMProvider {
  public readonly providerType: LLMProviderType = 'antigravity';
  public readonly defaultModel = 'gemini-3.8-flash';

  /** 可透過環境變數 ANTIGRAVITY_IDLE_TIMEOUT_MS 覆寫的串流 idle timeout */
  private readonly idleTimeoutMs: number;
  private readonly customAuthData?: Record<string, unknown>;

  constructor(options: AntigravityProviderOptions = {}) {
    super(options);
    this.model = options.model || this.defaultModel;
    this.baseURL = (options.baseURL || process.env.ANTIGRAVITY_BRIDGE_URL || 'http://127.0.0.1:8123').replace(/\/+$/, '');
    this.customAuthData = options.authData;
    this.requestApproval = options.requestApproval;
    const envTimeout = Number(process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS);
    this.idleTimeoutMs =
      Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_IDLE_TIMEOUT_MS;
  }

  public async streamCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    const url = `${this.baseURL}/api/chat`;

    let authData: Record<string, unknown> = { ...(this.customAuthData || {}) };
    const effectiveKey =
      this.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.ANTIGRAVITY_API_KEY;

    if (effectiveKey) {
      try {
        const parsed = JSON.parse(effectiveKey);
        if (typeof parsed === 'object' && parsed !== null) {
          authData = { ...authData, ...parsed };
        } else {
          authData = { ...authData, token: effectiveKey, apiKey: effectiveKey };
        }
      } catch {
        authData = { ...authData, token: effectiveKey, apiKey: effectiveKey };
      }
    }

    const modelForcesAcp = (this.model || '').toLowerCase().includes(':acp');
    const rawAuthMode = String(
      (authData as any)?.agy_mode || (authData as any)?.mode || '',
    ).toLowerCase();
    const rawEnvMode = String(
      process.env.ANTIGRAVITY_AGY_MODE ||
        process.env.ANTIGRAVITY_EXECUTION_MODE ||
        '',
    ).toLowerCase();
    const configuredMode: 'acp' | 'direct' =
      this.antigravityMode === 'direct' || this.antigravityMode === 'acp'
        ? this.antigravityMode
        : rawAuthMode === 'direct' || rawAuthMode === 'acp'
          ? (rawAuthMode as 'acp' | 'direct')
          : rawEnvMode === 'direct'
            ? 'direct'
            : 'acp';
    const isAcp = modelForcesAcp || configuredMode === 'acp';

    const defaultToolSettings = isAcp
      ? {
          agy_mode: 'acp',
          disable_builtin_tools: false,
          allow_tools: true,
          dangerously_skip_permissions: true,
          interactive_permissions: false,
        }
      : {
          agy_mode: 'direct',
          disable_builtin_tools: true,
          allow_tools: false,
        };

    const acpSyncRule =
      '\n\n[ACP_SYNC_EXECUTION_RULE] When using run_command for builds/tests/checks, set WaitMsBeforeAsync to 10000 to wait synchronously whenever possible. Never finish your turn after launching a command or build check with an interim status message; inspect background task output via manage_task and complete all requested edits before ending your turn.';
    const baseSystemPrompt = systemPrompt || '';
    const effectiveSystemPrompt =
      isAcp && !baseSystemPrompt.includes('[ACP_SYNC_EXECUTION_RULE]')
        ? `${baseSystemPrompt}${acpSyncRule}`
        : systemPrompt;

    const payload = {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        name: m.name,
        thinking: m.thinking,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        toolResult: m.toolResult,
      })),
      systemPrompt: effectiveSystemPrompt,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      model: composeAntigravityModel(this.model || this.defaultModel, this.thinkingDepth),
      thinkingDepth: this.thinkingDepth,
      workspaceRoot: this.workspaceRoot,
      authData: {
        ...defaultToolSettings,
        ...authData,
        ...(this.sessionId ? { conversation_id: this.sessionId, sessionId: this.sessionId } : {}),
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...(this.sessionId ? { 'x-session-id': this.sessionId, 'x-conversation-id': this.sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (fetchErr: any) {
      throw new Error(
        `無法連接 Antigravity Bridge 服務 (${this.baseURL})：${fetchErr.message || '連線失敗'}。` +
          '請確認外部 Antigravity Bridge 服務是否已啟動（預設為 http://127.0.0.1:8123），或於設定中檢查 Bridge Base URL。',
        { cause: fetchErr },
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Antigravity Bridge Error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Antigravity Bridge response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let fullText = '';
    let fullThinking = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let buffer = '';

    let isStreamDone = false;

    // --- Idle timeout 防護：避免 Bridge 卡住時 reader.read() 無限等待 ---
    const readWithIdleTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
      new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          // 主動取消串流，避免資源洩漏
          reader.cancel().catch(() => {});
          reject(
            new Error(
              `Antigravity Bridge 串流逾時：超過 ${Math.round(this.idleTimeoutMs / 1000)} 秒未收到任何資料，` +
                'Bridge 可能已卡住。請檢查 Bridge 服務狀態後重試。',
            ),
          );
        }, this.idleTimeoutMs);
        // 不阻止 Node.js process 正常退出
        if (typeof (timer as NodeJS.Timeout).unref === 'function') {
          (timer as NodeJS.Timeout).unref();
        }

        reader.read().then(
          (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
          },
          (err: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          },
        );
      });

    while (!isStreamDone) {
      const { done, value } = await readWithIdleTimeout();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (!dataStr.trim()) continue;
        if (dataStr === '[DONE]') {
          isStreamDone = true;
          break;
        }

        let chunk: any;
        try {
          chunk = JSON.parse(dataStr);
        } catch {
          continue;
        }

        if (chunk.type === 'done') {
          isStreamDone = true;
          break;
        }
        if (chunk.type === 'error') {
          throw new Error(chunk.message || 'Antigravity bridge stream error');
        }
        if (chunk.type === 'token' && typeof chunk.content === 'string') {
          fullText += chunk.content;
          onChunk({ type: 'token', content: chunk.content });
        } else if (chunk.type === 'thinking' && typeof chunk.thought === 'string') {
          fullThinking += chunk.thought;
          onChunk({ type: 'thinking', thought: chunk.thought });
        } else if (chunk.type === 'tool_call' && chunk.name) {
          const thoughtSig = chunk.thoughtSignature || chunk.thought_signature;
          const normalized = normalizeToolCall(chunk.name, chunk.arguments || {});
          const tcObj = {
            id: chunk.id || `ag_call_${Date.now()}_${toolCalls.length}`,
            name: normalized.name,
            arguments: normalized.arguments,
            ...(thoughtSig ? { thoughtSignature: thoughtSig } : {}),
          };
          toolCalls.push(tcObj);
          onChunk({ type: 'tool_call', ...tcObj });
        } else if (chunk.type === 'usage' && chunk.usage) {
          onChunk({ type: 'usage', usage: chunk.usage });
        } else if (chunk.type === 'permission_request') {
          let approved = false;
          let feedback: string | undefined;
          if (this.requestApproval) {
            try {
              const approval = await this.requestApproval({
                toolCallId: chunk.toolCallId || chunk.permissionId,
                name: chunk.name || 'tool',
                arguments: chunk.arguments || {},
                title: chunk.title,
              });
              approved = approval.approved;
              feedback = approval.feedback;
            } catch (approvalErr) {
              console.error('[AntigravityProvider] requestApproval threw error:', approvalErr);
              approved = false;
            }
          }
          try {
            await fetch(`${this.baseURL}/api/permission_response`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
                ...(this.sessionId ? { 'x-session-id': this.sessionId, 'x-conversation-id': this.sessionId } : {}),
              },
              body: JSON.stringify({
                permissionId: chunk.permissionId,
                approved,
                optionId: approved ? 'allow' : 'deny',
                feedback,
              }),
            });
          } catch (err) {
            console.error('Failed to send permission response to Bridge:', err);
          }
        }
      }
      if (isStreamDone) {
        break;
      }
    }

    // Fallback: If no structured toolCalls were yielded, but fullText contains text-formatted tool calls
    // e.g. "Calling tool replace_file_content with arguments: {...}"
    if (toolCalls.length === 0 && fullText.trim()) {
      const extracted = AntigravityProvider.extractTextToolCalls(fullText);
      for (const call of extracted) {
        toolCalls.push(call);
        onChunk({ type: 'tool_call', ...call });
      }
    }

    return {
      text: fullText,
      thinking: fullThinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * Sanitizes malformed JSON strings emitted by LLMs in text-formatted tool calls.
   * Scans char-by-char tracking string literals and escapes unescaped raw newlines/control characters
   * and non-standard backslash escapes (e.g. \`, \s, \S, \', \d, etc.).
   */
  public static sanitizeMalformedJson(raw: string): string {
    let result = '';
    let inString = false;
    const len = raw.length;

    for (let i = 0; i < len; i++) {
      const ch = raw[i];

      if (!inString) {
        if (ch === '"') {
          inString = true;
        }
        result += ch;
        continue;
      }

      // Inside string literal
      if (ch === '"') {
        inString = false;
        result += ch;
        continue;
      }

      if (ch === '\\') {
        const next = i + 1 < len ? raw[i + 1] : '';
        if (
          next === '"' ||
          next === '\\' ||
          next === '/' ||
          next === 'b' ||
          next === 'f' ||
          next === 'n' ||
          next === 'r' ||
          next === 't'
        ) {
          result += '\\' + next;
          i++;
          continue;
        }
        if (
          next === 'u' &&
          i + 5 < len &&
          /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))
        ) {
          result += raw.slice(i, i + 6);
          i += 5;
          continue;
        }
        // Invalid JSON escape sequence -> escape the backslash itself so next char is processed normally
        result += '\\\\';
        continue;
      }

      // Unescaped control characters in JSON string (< 0x20)
      const code = ch.charCodeAt(0);
      if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        result += '\\r';
      } else if (ch === '\t') {
        result += '\\t';
      } else if (code < 0x20) {
        result += '\\u' + code.toString(16).padStart(4, '0');
      } else {
        result += ch;
      }
    }

    return result;
  }

  /**
   * Extracts one or more text-formatted tool calls (`Calling tool <name> with arguments: {...}`)
   * using balanced brace counting so trailing prose/code with `}` or multiple tool calls do not corrupt JSON.parse.
   */
  public static extractTextToolCalls(
    text: string,
  ): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
    const results: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    if (!text || !/calling tool\s+/i.test(text)) {
      return results;
    }

    const pattern = /Calling tool [`']?([a-zA-Z0-9_-]+)[`']?\s+with arguments:\s*/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const toolName = match[1]?.trim();
      const jsonStart = pattern.lastIndex;
      if (!toolName || jsonStart >= text.length || text[jsonStart] !== '{') {
        continue;
      }

      let depth = 0;
      let inString = false;
      let escape = false;
      let jsonEnd = -1;

      for (let i = jsonStart; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\' && inString) {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
            if (depth === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }
      }

      const tryParseCandidate = (str: string): Record<string, unknown> | null => {
        try {
          const parsed = JSON.parse(str);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          try {
            const sanitized = AntigravityProvider.sanitizeMalformedJson(str);
            const parsed = JSON.parse(sanitized);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            return null;
          }
        }
        return null;
      };

      let parsedArgs: Record<string, unknown> | null = null;
      let usedEnd = jsonEnd;

      if (jsonEnd !== -1) {
        const rawJson = text.slice(jsonStart, jsonEnd);
        parsedArgs = tryParseCandidate(rawJson);
      } else if (depth > 0) {
        const rawJson = text.slice(jsonStart);
        parsedArgs = tryParseCandidate(rawJson);
        if (!parsedArgs) {
          const suffixes = ['"}', '"\n}', '}', '"}}', '}}'];
          for (const suffix of suffixes) {
            parsedArgs = tryParseCandidate(rawJson + suffix);
            if (parsedArgs) {
              usedEnd = text.length;
              break;
            }
          }
        } else {
          usedEnd = text.length;
        }
      }

      if (parsedArgs && typeof parsedArgs === 'object') {
        const normalized = normalizeToolCall(
          toolName,
          parsedArgs,
        );
        results.push({
          id: `ag_call_text_${Date.now()}_${results.length}`,
          name: normalized.name,
          arguments: normalized.arguments,
        });
        if (usedEnd !== -1) {
          pattern.lastIndex = usedEnd;
        }
      }
    }

    return results;
  }

  private static normalizeAcpToolTitle(title: string): string {
    return title
      .replace(/^File\s+/i, '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .trim();
  }

  private static findMatchingAcpToolIndex(activeTools: string[], title: string): number {
    const exactIdx = activeTools.lastIndexOf(title);
    if (exactIdx !== -1) {
      return exactIdx;
    }

    const normTarget = AntigravityProvider.normalizeAcpToolTitle(title);
    if (normTarget) {
      for (let i = activeTools.length - 1; i >= 0; i--) {
        const normActive = AntigravityProvider.normalizeAcpToolTitle(activeTools[i]);
        if (
          normActive &&
          (normActive === normTarget ||
            normTarget.endsWith(`/${normActive}`) ||
            normActive.endsWith(`/${normTarget}`))
        ) {
          return i;
        }
      }
    }

    if (title.trim().toLowerCase() === 'tool' && activeTools.length > 0) {
      return activeTools.length - 1;
    }

    return -1;
  }

  /**
   * 從 thinking 文字中解析並追蹤 ACP 工具的狀態更新，回傳結束時仍處於執行中（in_progress / pending / running）的工具名稱清單。
   */
  public static extractIncompleteAcpTools(thinking?: string): string[] {
    if (!thinking) {
      return [];
    }

    const activeTools: string[] = [];
    const pattern = /\[ACP Tool\s+([a-zA-Z0-9_-]+):\s*([^\]]+)\]/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(thinking)) !== null) {
      const status = match[1].trim().toLowerCase();
      const title = match[2].trim();

      if (status === 'in_progress' || status === 'pending' || status === 'running') {
        if (!activeTools.includes(title)) {
          activeTools.push(title);
        }
      } else if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'error' ||
        status === 'cancelled' ||
        status === 'canceled'
      ) {
        const idx = AntigravityProvider.findMatchingAcpToolIndex(activeTools, title);
        if (idx !== -1) {
          activeTools.splice(idx, 1);
        }
      } else if (status === 'auto_resumed') {
        const parts = title
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        for (const part of parts) {
          const idx = AntigravityProvider.findMatchingAcpToolIndex(activeTools, part);
          if (idx !== -1) {
            activeTools.splice(idx, 1);
          }
        }
      }
    }

    return activeTools;
  }
}
