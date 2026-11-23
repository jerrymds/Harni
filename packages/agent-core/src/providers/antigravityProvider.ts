import type { spawn } from 'node:child_process';
import {
  BaseLLMProvider,
  type ProviderCompletionResult,
  type ProviderOptions,
  type StreamChunk,
} from './baseProvider.js';
import {
  AGY_ACP_SESSION_POOL,
  type AgyAcpSessionPool,
} from './agyAcpSession.js';
import {
  AGY_BUILTIN_OVERLAP_TOOLS,
  buildAgyCompositePrompt,
  buildAgyPromptParts,
  buildAgySessionKey,
} from './agyPromptBuilder.js';
import {
  HARNI_ACP_MCP_BRIDGE,
  type HarniAcpMcpBridge,
  type HarniAcpMcpBridgeHandle,
} from './harniAcpMcpBridge.js';
import { AgyBinaryResolver } from '../utils/agyBinaryResolver.js';
import { normalizeToolCall } from '../tools/toolAdapter.js';
import type {
  ChatMessage,
  LLMProviderType,
  ThinkingDepth,
  TokenUsage,
  ToolDefinition,
} from '@harni/types';

/**
 * 組裝 Antigravity 模型名稱與思考等級。
 *
 * 規則：
 * 1. 若 model 為空，預設回傳 'gemini-3.8-flash-medium'。
 * 2. 若包含 :acp 後綴，先分離後綴；若是 gpt-oss-120b-medium、gemini-pro-orchestrator-* 或已包含 -(low|medium|high|xhigh)，不重複加後綴，維持原名稱。
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

  if (
    base.toLowerCase() === 'gpt-oss-120b-medium' ||
    /^gemini-pro-orchestrator-/i.test(base) ||
    /-(low|medium|high|xhigh)$/i.test(base)
  ) {
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

/**
 * Converts a Harni Antigravity model ID (optionally with `:acp`) into the raw `agy acp` modelId.
 */
export function toAgyAcpModelId(model?: string, depth?: ThinkingDepth): string {
  return composeAntigravityModel(model, depth).replace(/:acp$/i, '');
}

/** 串流 idle timeout：超過此時間未收到任何資料即視為 ACP 逾時並拋錯 (預設 90 秒) */
const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

export interface AntigravityProviderOptions extends ProviderOptions {
  authData?: Record<string, unknown>;
  sessionPool?: AgyAcpSessionPool;
  mcpBridge?: HarniAcpMcpBridge;
  agyPath?: string;
  spawnFn?: typeof spawn;
}

export class AntigravityProvider extends BaseLLMProvider {
  public readonly providerType: LLMProviderType = 'antigravity';
  public readonly defaultModel = 'gemini-3.8-flash';

  /** 可透過環境變數 ANTIGRAVITY_IDLE_TIMEOUT_MS 覆寫的串流 idle timeout */
  private readonly idleTimeoutMs: number;
  private readonly customAuthData?: Record<string, unknown>;
  private readonly sessionPool: AgyAcpSessionPool;
  private readonly mcpBridge: HarniAcpMcpBridge;
  private readonly agyPath?: string;
  private readonly spawnFn?: typeof spawn;

  constructor(options: AntigravityProviderOptions = {}) {
    super(options);
    this.model = options.model || this.defaultModel;
    this.baseURL = options.baseURL || 'agy://acp';
    this.customAuthData = options.authData;
    this.sessionPool = options.sessionPool ?? AGY_ACP_SESSION_POOL;
    this.mcpBridge = options.mcpBridge ?? HARNI_ACP_MCP_BRIDGE;
    this.agyPath = options.agyPath;
    this.spawnFn = options.spawnFn;
    const envTimeout = Number(process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS);
    this.idleTimeoutMs =
      Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_IDLE_TIMEOUT_MS;
  }

  private resolveAuthData(): Record<string, unknown> {
    let authData: Record<string, unknown> = { ...(this.customAuthData || {}) };
    if (this.apiKey) {
      try {
        const parsed = JSON.parse(this.apiKey);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          authData = { ...authData, ...(parsed as Record<string, unknown>) };
        }
      } catch {
        // Plain API key string is ignored for direct agy acp OAuth
      }
    }
    return authData;
  }

  public async streamCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult> {
    const authData = this.resolveAuthData();

    const explicitSkip =
      authData.dangerously_skip_permissions !== undefined
        ? Boolean(authData.dangerously_skip_permissions)
        : undefined;
    const explicitInteractive =
      authData.interactive_permissions !== undefined
        ? Boolean(authData.interactive_permissions)
        : undefined;

    let dangerouslySkipPermissions: boolean;
    let interactivePermissions: boolean;

    if (explicitSkip !== undefined || explicitInteractive !== undefined) {
      dangerouslySkipPermissions = explicitSkip ?? !explicitInteractive;
      interactivePermissions = explicitInteractive ?? !dangerouslySkipPermissions;
    } else if (this.autoApprove === true) {
      dangerouslySkipPermissions = true;
      interactivePermissions = false;
    } else if (this.autoApprove === false) {
      dangerouslySkipPermissions = false;
      interactivePermissions = true;
    } else {
      interactivePermissions = Boolean(this.requestApproval);
      dangerouslySkipPermissions = !interactivePermissions;
    }

    const modelForcesAcp = (this.model || '').toLowerCase().includes(':acp');
    const authModeDirect =
      String(authData.agy_mode || authData.mode || '').toLowerCase() === 'direct';
    const isDirectMode =
      !modelForcesAcp && (this.antigravityMode === 'direct' || authModeDirect);

    const disableBuiltinTools =
      authData.disable_builtin_tools !== undefined
        ? Boolean(authData.disable_builtin_tools)
        : isDirectMode;
    const allowTools =
      authData.allow_tools !== undefined
        ? Boolean(authData.allow_tools)
        : !disableBuiltinTools;

    const toolPolicy: 'allow' | 'deny' = allowTools ? 'allow' : 'deny';
    let bridgeTools: ToolDefinition[] = [];
    let bridgedToolNames: string[] = [];
    let mcpToolsSignature = '';
    let preamble: string;
    let turns: string[];

    if (toolPolicy === 'allow' && this.executeAcpTool) {
      bridgeTools = tools.filter((t) => !AGY_BUILTIN_OVERLAP_TOOLS.has(t.name));
      bridgedToolNames = bridgeTools.map((t) => t.name).sort();
      mcpToolsSignature = bridgedToolNames.join(',');
      const built = buildAgyPromptParts(messages, systemPrompt, tools, toolPolicy, {
        acpMcpServerName: bridgeTools.length > 0 ? this.mcpBridge.serverName : undefined,
        acpMcpToolNames: bridgedToolNames,
        disableSubagents: !tools.some((t) => t.name === 'invoke_subagent'),
      });
      preamble = built.preamble;
      turns = built.turns;
    } else {
      const built = buildAgyPromptParts(messages, systemPrompt, tools, toolPolicy);
      preamble = built.preamble;
      turns = built.turns;
    }

    if (turns.length === 0) {
      return { text: '' };
    }

    const acpModelId = toAgyAcpModelId(this.model || this.defaultModel, this.thinkingDepth);
    const agyPath = await AgyBinaryResolver.resolve(this.agyPath);
    const sessionKey = buildAgySessionKey({
      sessionId: this.sessionId,
      subagentId: this.subagentId,
      workspaceRoot: this.workspaceRoot,
      systemPrompt: preamble,
      messages,
    });

    let bridgeHandle: HarniAcpMcpBridgeHandle | undefined;
    if (toolPolicy === 'allow' && this.executeAcpTool) {
      if (bridgeTools.length > 0) {
        const executeTool = this.executeAcpTool;
        bridgeHandle = await this.mcpBridge.register(
          sessionKey,
          {
            getTools: () => bridgeTools,
            executeTool,
          },
          { sessionId: this.sessionId, subagentId: this.subagentId },
        );
      } else {
        this.mcpBridge.unregister(sessionKey);
      }
    } else {
      this.mcpBridge.unregister(sessionKey);
    }

    const geminiDir =
      typeof authData.gemini_dir === 'string'
        ? authData.gemini_dir
        : typeof authData.geminiDir === 'string'
          ? authData.geminiDir
          : undefined;

    const { session, isNew } = await this.sessionPool.getOrCreateSession(sessionKey, {
      agyPath,
      spawnFn: this.spawnFn,
      model: acpModelId,
      systemPrompt: preamble,
      workspaceDir: this.workspaceRoot,
      sessionId: this.sessionId,
      subagentId: this.subagentId,
      mcpServers: bridgeHandle ? [bridgeHandle.serverSpec] : [],
      mcpToolsSignature,
      internalMcpServerName: bridgeHandle?.serverName,
      bridgedToolNames,
      geminiDir,
      dangerouslySkipPermissions,
      interactivePermissions,
      disableBuiltinTools,
      turnTimeoutMs: this.idleTimeoutMs,
    });

    const lastTurn = turns[turns.length - 1]!;
    const currentPrompt =
      (isNew || session.turnCount === 0) && turns.length > 1
        ? buildAgyCompositePrompt(messages, lastTurn)
        : lastTurn;

    let fullText = '';
    let fullThinking = '';
    let lastUsage: Partial<TokenUsage> | undefined;
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

    for await (const event of session.sendTurn(currentPrompt, {
      model: acpModelId,
      timeoutMs: this.idleTimeoutMs,
      signal,
      hasActiveInternalToolCalls: bridgeHandle ? () => bridgeHandle.hasActiveCalls() : undefined,
      onPermissionRequest: this.requestApproval
        ? async (req) => {
            return await this.requestApproval!({
              toolCallId: req.toolCallId,
              name: req.name,
              arguments: req.arguments,
              title: req.title,
            });
          }
        : undefined,
    })) {
      if (event.type === 'token') {
        fullText += event.content;
        onChunk({ type: 'token', content: event.content });
      } else if (event.type === 'thinking') {
        fullThinking += event.thought;
        onChunk({ type: 'thinking', thought: event.thought });
      } else if (event.type === 'acp_tool') {
        onChunk(event);
      } else if (event.type === 'usage') {
        lastUsage = event.usage;
        onChunk({ type: 'usage', usage: event.usage });
      } else if (event.type === 'result') {
        if (!fullText && event.text) {
          fullText = event.text;
        }
      }
    }

    if (fullText.trim()) {
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
      ...(lastUsage ? { usage: lastUsage } : {}),
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
