import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AcpMcpServerSpec } from './harniAcpMcpBridge.js';

export interface ZedClientInfo {
  name: string;
  title: string;
  version: string;
  _meta: {
    platform: string;
    [key: string]: unknown;
  };
}

/**
 * Builds the Zed client metadata sent during the `agy acp` `initialize` handshake.
 */
export function buildZedClientInfo(overrides?: Partial<ZedClientInfo>): ZedClientInfo {
  return {
    name: overrides?.name || process.env.ANTIGRAVITY_ACP_CLIENT_NAME || 'zed',
    title: overrides?.title || process.env.ANTIGRAVITY_ACP_CLIENT_TITLE || 'Zed',
    version: overrides?.version || process.env.ANTIGRAVITY_ACP_CLIENT_VERSION || '0.180.0',
    _meta: {
      platform: process.platform,
      ...(overrides?._meta || {}),
    },
  };
}

export const DEFAULT_ISOLATED_GEMINI_DIR = path.join(os.tmpdir(), 'harni_agy_gemini_isolated');

export interface AgyAcpPermissionOption {
  optionId?: string;
  id?: string;
  kind?: string;
  name?: string;
}

export interface AgyAcpPermissionRequest {
  permissionId?: string;
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  title?: string;
  options?: AgyAcpPermissionOption[];
}

export interface AgyAcpPermissionDecision {
  approved: boolean;
  feedback?: string;
}

export type AgyAcpTurnEvent =
  | { type: 'token'; content: string }
  | { type: 'thinking'; thought: string }
  | {
      type: 'acp_tool';
      toolCallId: string;
      name: string;
      title: string;
      status: string;
      arguments?: Record<string, unknown>;
      output?: string;
    }
  | {
      type: 'usage';
      usage: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
    }
  | {
      type: 'result';
      text: string;
      stopReason: string;
      incompleteTools: string[];
    };

export interface AgyAcpSessionOptions {
  agyPath: string;
  spawnFn?: typeof spawn;
  dangerouslySkipPermissions?: boolean;
  interactivePermissions?: boolean;
  disableBuiltinTools?: boolean;
  geminiDir?: string;
  startupTimeoutMs?: number;
  turnTimeoutMs?: number;
  clientInfo?: ZedClientInfo;
  agent?: string;
  addDirs?: string[];
  workspaceDir?: string;
  model?: string;
  systemPrompt?: string;
  sessionId?: string;
  subagentId?: string;
  mcpServers?: AcpMcpServerSpec[];
  mcpToolsSignature?: string;
  internalMcpServerName?: string;
  bridgedToolNames?: string[];
}

type QueueItem =
  | { kind: 'rpc'; msg: Record<string, any> }
  | { kind: 'noise'; line: string }
  | { kind: 'stderr'; line: string }
  | { kind: 'eof'; code: number | null; error?: Error };

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function createAbortError(message = 'Antigravity ACP operation aborted'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/**
 * Zero-polling async queue supporting timeout and AbortSignal cancellation.
 */
class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<{
    resolve: (item: T) => void;
    reject: (err: Error) => void;
    cleanup: () => void;
  }> = [];

  public push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.cleanup();
      waiter.resolve(item);
      return;
    }
    this.items.push(item);
  }

  public shiftSync(): T | undefined {
    return this.items.shift();
  }

  public drain(): T[] {
    if (this.items.length === 0) return [];
    const drained = this.items;
    this.items = [];
    return drained;
  }

  public next(timeoutMs?: number, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    if (this.items.length > 0) {
      return Promise.resolve(this.items.shift()!);
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        removeWaiter();
        cleanup();
        reject(createAbortError());
      };

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const entry = {
        resolve: (item: T) => {
          if (settled) return;
          settled = true;
          resolve(item);
        },
        reject: (err: Error) => {
          if (settled) return;
          settled = true;
          reject(err);
        },
        cleanup,
      };

      const removeWaiter = () => {
        const idx = this.waiters.indexOf(entry);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
        }
      };

      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          removeWaiter();
          cleanup();
          reject(new TimeoutError(`Queue wait timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.waiters.push(entry);
    });
  }
}

function resolveGeminiDir(explicit?: string): string {
  if (explicit === '') {
    return '';
  }
  return explicit ?? (process.env.ANTIGRAVITY_GEMINI_DIR || DEFAULT_ISOLATED_GEMINI_DIR);
}

function deduplicateDirs(addDirs?: string[], workspaceDir?: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of [...(addDirs || []), ...(workspaceDir ? [workspaceDir] : [])]) {
    const trimmed = (dir || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function isAuthErrorText(text: string): boolean {
  return /(?:unauthenticated|unauthorized|not logged in|login required|oauth|credential|auth(?:entication)?\s+(?:failed|required|expired)|401)/i.test(
    text,
  );
}

function formatAcpError(baseMsg: string, stderrTail: string[], cause?: unknown): Error {
  const tailText = stderrTail.length > 0 ? `\nStderr: ${stderrTail.join('\n')}` : '';
  const combined = `${baseMsg}${tailText}`;
  const authHint = isAuthErrorText(combined)
    ? '\n提示：請先於終端機執行 `agy acp --login` 或確認本機 `agy` 登入狀態。'
    : '';
  return new Error(`${combined}${authHint}`, cause !== undefined ? { cause } : undefined);
}

function selectPermissionOptionId(
  rawOptions: AgyAcpPermissionOption[],
  approved: boolean,
): string {
  const normalized = rawOptions
    .map((opt) => ({
      id: String(opt.optionId || opt.id || ''),
      kind: String(opt.kind || '').toLowerCase(),
      name: String(opt.name || '').toLowerCase(),
    }))
    .filter((o) => o.id.length > 0);

  if (approved) {
    const allowOnce = normalized.find(
      (o) =>
        o.kind === 'allow_once' ||
        o.id.toLowerCase() === 'allow_once' ||
        o.id.toLowerCase() === 'allow-once',
    );
    if (allowOnce) return allowOnce.id;

    const allowAny = normalized.find(
      (o) => o.kind.includes('allow') || o.id.toLowerCase().includes('allow') || o.name.includes('allow'),
    );
    if (allowAny) return allowAny.id;

    return 'allow_once';
  }

  const denyMatch = normalized.find(
    (o) =>
      o.kind === 'reject_once' ||
      o.kind === 'deny' ||
      o.kind.includes('reject') ||
      o.kind.includes('deny') ||
      o.id.toLowerCase().includes('deny') ||
      o.id.toLowerCase().includes('reject'),
  );
  if (denyMatch) return denyMatch.id;

  return 'deny';
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
  }
  return '';
}

function extractOutputText(content: unknown): string | undefined {
  if (content === undefined || content === null) return undefined;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => extractTextContent(item))
      .filter((part) => part.length > 0);
    if (parts.length > 0) return parts.join('\n');
    return content.length > 0 ? JSON.stringify(content) : undefined;
  }
  if (typeof content === 'object') {
    const text = extractTextContent(content);
    if (text) return text;
    return JSON.stringify(content);
  }
  return String(content);
}

function normalizeUsage(rawUsage: Record<string, unknown> | undefined): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
} | null {
  if (!rawUsage || typeof rawUsage !== 'object') return null;
  const promptTokens =
    typeof rawUsage.promptTokens === 'number'
      ? rawUsage.promptTokens
      : typeof rawUsage.prompt_tokens === 'number'
        ? rawUsage.prompt_tokens
        : typeof rawUsage.inputTokens === 'number'
          ? rawUsage.inputTokens
          : typeof rawUsage.input_tokens === 'number'
            ? rawUsage.input_tokens
            : undefined;
  const completionTokens =
    typeof rawUsage.completionTokens === 'number'
      ? rawUsage.completionTokens
      : typeof rawUsage.completion_tokens === 'number'
        ? rawUsage.completion_tokens
        : typeof rawUsage.outputTokens === 'number'
          ? rawUsage.outputTokens
          : typeof rawUsage.output_tokens === 'number'
            ? rawUsage.output_tokens
            : undefined;
  const totalTokens =
    typeof rawUsage.totalTokens === 'number'
      ? rawUsage.totalTokens
      : typeof rawUsage.total_tokens === 'number'
        ? rawUsage.total_tokens
        : promptTokens !== undefined || completionTokens !== undefined
          ? (promptTokens || 0) + (completionTokens || 0)
          : undefined;
  const cacheReadTokens =
    typeof rawUsage.cacheReadTokens === 'number'
      ? rawUsage.cacheReadTokens
      : typeof rawUsage.cache_read_tokens === 'number'
        ? rawUsage.cache_read_tokens
        : typeof rawUsage.cachedReadTokens === 'number'
          ? rawUsage.cachedReadTokens
          : undefined;
  const cacheWriteTokens =
    typeof rawUsage.cacheWriteTokens === 'number'
      ? rawUsage.cacheWriteTokens
      : typeof rawUsage.cache_write_tokens === 'number'
        ? rawUsage.cache_write_tokens
        : typeof rawUsage.cachedWriteTokens === 'number'
          ? rawUsage.cachedWriteTokens
          : undefined;

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheWriteTokens === undefined
  ) {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
  };
}

/**
 * Manages a persistent `agy acp` stdio child process and JSON-RPC 2.0 session.
 */
export class AgyAcpSession {
  public readonly agyPath: string;
  public readonly dangerouslySkipPermissions: boolean;
  public readonly interactivePermissions: boolean;
  public readonly disableBuiltinTools: boolean;
  public readonly geminiDir: string;
  public readonly startupTimeoutMs: number;
  public readonly turnTimeoutMs: number;
  public readonly clientInfo: ZedClientInfo;
  public readonly agent?: string;
  public readonly addDirs: string[];
  public readonly workspaceDir?: string;
  public readonly sessionId?: string;
  public readonly subagentId?: string;
  public readonly mcpServers: AcpMcpServerSpec[];
  public readonly mcpToolsSignature: string;
  public readonly internalMcpServerName?: string;
  public readonly bridgedToolNames: ReadonlySet<string>;

  public model?: string;
  public systemPrompt?: string;
  public acpSessionId: string | null = null;
  public availableModels: unknown[] = [];
  public turnCount = 0;
  public lastUsed = Date.now();

  private readonly spawnFn: typeof spawn;
  private proc: ChildProcess | null = null;
  private queue = new AsyncQueue<QueueItem>();
  private stderrTail: string[] = [];
  private nextRpcId = 1;
  private exited = false;
  private closed = false;
  private _isBusy = false;
  private turnLock: Promise<void> = Promise.resolve();

  constructor(options: AgyAcpSessionOptions) {
    this.agyPath = options.agyPath;
    this.spawnFn = options.spawnFn ?? spawn;
    this.dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? false;
    this.interactivePermissions = options.interactivePermissions ?? false;
    this.disableBuiltinTools = options.disableBuiltinTools ?? false;
    this.geminiDir = resolveGeminiDir(options.geminiDir);
    const envStartup = Number(process.env.ANTIGRAVITY_ACP_STARTUP_TIMEOUT_MS);
    this.startupTimeoutMs =
      options.startupTimeoutMs ??
      (Number.isFinite(envStartup) && envStartup > 0 ? envStartup : 30_000);
    const envTurn = Number(process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS);
    this.turnTimeoutMs =
      options.turnTimeoutMs ?? (Number.isFinite(envTurn) && envTurn > 0 ? envTurn : 90_000);
    this.clientInfo = options.clientInfo ?? buildZedClientInfo();
    this.agent = options.agent;
    this.workspaceDir = options.workspaceDir;
    this.addDirs = deduplicateDirs(options.addDirs, options.workspaceDir);
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.sessionId = options.sessionId;
    this.subagentId = options.subagentId;
    this.mcpServers = options.mcpServers ? [...options.mcpServers] : [];
    this.mcpToolsSignature = options.mcpToolsSignature ?? '';
    this.internalMcpServerName = options.internalMcpServerName;
    this.bridgedToolNames = new Set(options.bridgedToolNames || []);
  }

  public get isAlive(): boolean {
    return (
      this.proc !== null &&
      !this.exited &&
      !this.closed &&
      Boolean(this.proc.stdin && !this.proc.stdin.destroyed && this.proc.stdin.writable)
    );
  }

  public get isBusy(): boolean {
    return this._isBusy;
  }

  public buildCommand(): string[] {
    const cmd: string[] = [this.agyPath, 'acp'];

    if (this.dangerouslySkipPermissions && !this.interactivePermissions) {
      cmd.push('--dangerously-skip-permissions');
    }
    if (this.geminiDir) {
      cmd.push('--gemini-dir', this.geminiDir);
    }
    for (const dir of this.addDirs) {
      cmd.push('--add-dir', dir);
    }
    if (this.agent) {
      cmd.push('--agent', this.agent);
    }

    return cmd;
  }

  public async start(): Promise<void> {
    if (this.isAlive && this.acpSessionId) {
      return;
    }

    if (this.geminiDir) {
      try {
        fs.mkdirSync(this.geminiDir, { recursive: true });
      } catch {
        // Ignore directory creation errors (e.g., restricted or mocked environments)
      }
    }

    this.queue = new AsyncQueue<QueueItem>();
    this.stderrTail = [];
    this.exited = false;
    this.closed = false;
    this.acpSessionId = null;

    const cmd = this.buildCommand();
    const validCwd =
      this.workspaceDir && fs.existsSync(this.workspaceDir) ? this.workspaceDir : process.cwd();

    let proc: ChildProcess;
    try {
      proc = this.spawnFn(cmd[0]!, cmd.slice(1), {
        cwd: validCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: process.env,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new Error(`找不到 Antigravity CLI 執行檔 (${this.agyPath})。請確認已安裝 agy CLI。`, {
          cause: err,
        });
      }
      throw err;
    }

    this.proc = proc;
    this.attachProcessListeners(proc);

    try {
      // Step 1: initialize (Zed simulation)
      await this.sendRpcRequest(
        'initialize',
        {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: this.clientInfo,
        },
        this.startupTimeoutMs,
      );

      // Step 2: session/new
      const sessionCwd = this.workspaceDir || validCwd || process.cwd();
      const newSessionResult = await this.sendRpcRequest(
        'session/new',
        {
          cwd: sessionCwd,
          mcpServers: this.mcpServers,
          additionalDirectories: this.addDirs,
          additional_directories: this.addDirs,
          additionalDirs: this.addDirs,
          _meta: {
            antigravity: {
              disableBuiltInTools: this.disableBuiltinTools,
              ...(this.systemPrompt?.trim()
                ? { systemPrompt: { append: this.systemPrompt.trim() } }
                : {}),
            },
          },
        },
        this.startupTimeoutMs,
      );

      this.acpSessionId =
        typeof newSessionResult?.sessionId === 'string' ? newSessionResult.sessionId : null;
      this.availableModels = Array.isArray(newSessionResult?.models?.availableModels)
        ? newSessionResult.models.availableModels
        : [];

      if (!this.acpSessionId) {
        throw new Error('Antigravity ACP handshake succeeded without returning a sessionId.');
      }

      // Step 3: session/set_model
      if (this.model) {
        await this.sendRpcRequest(
          'session/set_model',
          {
            sessionId: this.acpSessionId,
            modelId: this.model.replace(/:acp$/i, ''),
          },
          this.startupTimeoutMs,
        );
      }

      this.lastUsed = Date.now();
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  public async setModel(model: string): Promise<void> {
    this.model = model;
    if (this.isAlive && this.acpSessionId) {
      await this.sendRpcRequest(
        'session/set_model',
        {
          sessionId: this.acpSessionId,
          modelId: model.replace(/:acp$/i, ''),
        },
        this.startupTimeoutMs,
      );
    }
  }

  public async *sendTurn(
    prompt: string,
    options?: {
      model?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
      hasActiveInternalToolCalls?: () => boolean;
      onPermissionRequest?: (req: AgyAcpPermissionRequest) => Promise<AgyAcpPermissionDecision>;
    },
  ): AsyncGenerator<AgyAcpTurnEvent> {
    const releaseLock = await this.acquireTurnLock();
    this._isBusy = true;

    const signal = options?.signal;
    const onAbort = () => {
      void this.cancelTurn();
    };

    try {
      if (signal?.aborted) {
        throw createAbortError();
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (!this.isAlive) {
        await this.start();
      }

      if (signal?.aborted) {
        throw createAbortError();
      }

      if (options?.model && options.model !== this.model) {
        await this.setModel(options.model);
      }

      if (signal?.aborted) {
        throw createAbortError();
      }

      if (this.turnCount > 0) {
        this.queue.drain();
      }

      const promptReqId = this.nextRpcId++;
      this.writeRpc({
        jsonrpc: '2.0',
        id: promptReqId,
        method: 'session/prompt',
        params: {
          sessionId: this.acpSessionId,
          prompt: [{ type: 'text', text: prompt }],
        },
      });

      const timeoutMs = options?.timeoutMs ?? this.turnTimeoutMs;
      let accumulatedText = '';
      const inProgressTools = new Map<string, string>();
      const inProgressToolNames = new Map<string, string>();

      const handleUpdateNotification = (
        msg: Record<string, any>,
      ): AgyAcpTurnEvent[] => {
        const params = (msg.params || {}) as Record<string, any>;
        const update = (params.update || params) as Record<string, any>;
        const updateKind = String(update.sessionUpdate || update.kind || '');

        if (updateKind === 'agent_message_chunk') {
          const text = extractTextContent(update.content);
          if (!text) return [];
          accumulatedText += text;
          return [{ type: 'token', content: text }];
        }

        if (updateKind === 'agent_thought_chunk') {
          const thought = extractTextContent(update.content);
          if (!thought) return [];
          return [{ type: 'thinking', thought }];
        }

        if (updateKind === 'tool_call' || updateKind === 'tool_call_update') {
          const statusRaw = String(update.status || updateKind);
          const statusLower = statusRaw.toLowerCase();
          const tcId = String(update.toolCallId || update.id || '').trim();
          const rawTitle =
            typeof update.title === 'string' && update.title.trim() ? update.title.trim() : '';
          const rawName =
            typeof update.name === 'string' && update.name.trim()
              ? update.name.trim()
              : typeof update.toolName === 'string' && update.toolName.trim()
                ? update.toolName.trim()
                : '';
          const rawKind =
            typeof update.kind === 'string' && update.kind.trim() ? update.kind.trim() : '';
          const existingTitle = tcId ? inProgressTools.get(tcId) : undefined;
          const existingToolName = tcId ? inProgressToolNames.get(tcId) : undefined;
          const title = rawTitle || rawName || existingTitle || rawKind || tcId || 'tool';
          const resolvedToolName = rawName || existingToolName || rawTitle || rawKind || 'tool';
          const key = tcId || title;

          if (
            statusLower === 'in_progress' ||
            statusLower === 'pending' ||
            statusLower === 'running' ||
            (updateKind === 'tool_call' &&
              statusLower !== 'completed' &&
              statusLower !== 'failed' &&
              statusLower !== 'error' &&
              statusLower !== 'cancelled' &&
              statusLower !== 'canceled')
          ) {
            inProgressTools.set(key, title);
            inProgressToolNames.set(key, resolvedToolName);
          } else if (
            statusLower === 'completed' ||
            statusLower === 'failed' ||
            statusLower === 'error' ||
            statusLower === 'cancelled' ||
            statusLower === 'canceled'
          ) {
            if (tcId && inProgressTools.has(tcId)) {
              inProgressTools.delete(tcId);
            } else {
              for (const [k, val] of inProgressTools.entries()) {
                if (val === title) {
                  inProgressTools.delete(k);
                  break;
                }
              }
            }
            if (tcId) {
              inProgressToolNames.delete(tcId);
            } else {
              inProgressToolNames.delete(title);
            }
          }

          const rawArgs = update.args ?? update.arguments ?? update.rawInput;
          const parsedArgs =
            rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
              ? (rawArgs as Record<string, unknown>)
              : undefined;
          const parsedOutput = extractOutputText(update.output ?? update.content);

          return [
            {
              type: 'thinking',
              thought: `[ACP Tool ${statusRaw}: ${title}]\n`,
            },
            {
              type: 'acp_tool',
              toolCallId: tcId || title,
              name: resolvedToolName,
              title,
              status: statusRaw,
              ...(parsedArgs ? { arguments: parsedArgs } : {}),
              ...(parsedOutput !== undefined ? { output: parsedOutput } : {}),
            },
          ];
        }

        return [];
      };

      while (true) {
        let item: QueueItem;
        try {
          item = await this.queue.next(timeoutMs, signal);
        } catch (err) {
          if (err instanceof TimeoutError) {
            if (options?.hasActiveInternalToolCalls?.()) {
              continue;
            }
            void this.cancelTurn();
            throw new Error(
              `Antigravity ACP 串流逾時：超過 ${Math.round(timeoutMs / 1000)} 秒未收到任何資料。`,
              { cause: err },
            );
          }
          if ((err as Error)?.name === 'AbortError') {
            void this.cancelTurn();
          }
          throw err;
        }

        if (item.kind === 'eof') {
          if (item.error && (item.error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`找不到 Antigravity CLI 執行檔 (${this.agyPath})。`, {
              cause: item.error,
            });
          }
          throw formatAcpError(
            `Antigravity ACP process exited unexpectedly (code: ${item.code ?? 'null'})`,
            this.stderrTail,
            item.error,
          );
        }

        if (item.kind !== 'rpc') {
          continue;
        }

        const msg = item.msg;

        // Server-to-client RPC request
        if (msg.id !== undefined && typeof msg.method === 'string') {
          if (msg.method === 'session/request_permission') {
            const params = (msg.params || {}) as Record<string, any>;
            const rawOptions = Array.isArray(params.options)
              ? (params.options as AgyAcpPermissionOption[])
              : [];
            const toolCall = (params.toolCall || params.tool_call || params.tool || {}) as Record<
              string,
              any
            >;
            const toolCallId = String(
              toolCall.toolCallId || toolCall.id || params.toolCallId || msg.id,
            );
            const name = String(toolCall.name || toolCall.toolName || params.name || 'tool');
            const rawArgs =
              toolCall.arguments || toolCall.args || toolCall.input || params.arguments || {};
            const args =
              rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
                ? (rawArgs as Record<string, unknown>)
                : {};
            const title =
              typeof toolCall.title === 'string'
                ? toolCall.title
                : typeof params.title === 'string'
                  ? params.title
                  : name;

            let decision: AgyAcpPermissionDecision;
            if (this.internalMcpServerName && name.startsWith(`mcp_${this.internalMcpServerName}_`)) {
              decision = { approved: true };
            } else if (
              this.interactivePermissions &&
              !this.disableBuiltinTools &&
              this.bridgedToolNames.has(name)
            ) {
              decision = { approved: false };
            } else if (this.interactivePermissions && !this.disableBuiltinTools) {
              if (options?.onPermissionRequest) {
                try {
                  decision = await options.onPermissionRequest({
                    permissionId: String(params.permissionId || msg.id),
                    toolCallId,
                    name,
                    arguments: args,
                    title,
                    options: rawOptions,
                  });
                } catch {
                  decision = { approved: false };
                }
              } else {
                decision = { approved: false };
              }
            } else {
              decision = { approved: this.dangerouslySkipPermissions };
            }

            const chosenId = selectPermissionOptionId(rawOptions, decision.approved);
            yield {
              type: 'thinking',
              thought: `[ACP Tool 權限已${decision.approved ? '核准' : '拒絕'}: ${title || name}]\n`,
            };

            this.writeRpc({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                outcome: {
                  outcome: 'selected',
                  optionId: chosenId,
                },
              },
            });
          } else {
            this.writeRpc({
              jsonrpc: '2.0',
              id: msg.id,
              error: {
                code: -32601,
                message: `Method not found: ${msg.method}`,
              },
            });
          }
          continue;
        }

        // Notification
        if (msg.method === 'session/update' && msg.id === undefined) {
          for (const ev of handleUpdateNotification(msg)) {
            yield ev;
          }
          continue;
        }

        // Final response to session/prompt
        if (msg.id === promptReqId) {
          if (msg.error) {
            const errMsg =
              typeof msg.error.message === 'string'
                ? msg.error.message
                : JSON.stringify(msg.error);
            throw formatAcpError(`Antigravity ACP Error: ${errMsg}`, this.stderrTail);
          }

          // Drain any synchronous pending session/update notifications already queued
          for (const pending of this.queue.drain()) {
            if (
              pending.kind === 'rpc' &&
              pending.msg.method === 'session/update' &&
              pending.msg.id === undefined
            ) {
              for (const ev of handleUpdateNotification(pending.msg)) {
                yield ev;
              }
            }
          }

          const usage = normalizeUsage(msg.result?.usage);
          if (usage) {
            yield { type: 'usage', usage };
          }

          this.turnCount++;
          this.lastUsed = Date.now();
          yield {
            type: 'result',
            text: accumulatedText,
            stopReason: String(msg.result?.stopReason || 'end_turn'),
            incompleteTools: Array.from(inProgressTools.values()),
          };
          return;
        }
      }
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      this._isBusy = false;
      releaseLock();
    }
  }

  public async cancelTurn(): Promise<void> {
    if (this.isAlive && this.acpSessionId) {
      try {
        this.writeRpc({
          jsonrpc: '2.0',
          method: 'session/cancel',
          params: { sessionId: this.acpSessionId },
        });
      } catch {
        // Ignore write error on dead pipe
      }
    }
    this.queue.drain();
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const proc = this.proc;
    this.proc = null;

    if (!proc) return;

    if (!this.exited && proc.stdin && !proc.stdin.destroyed && proc.stdin.writable) {
      if (this.acpSessionId) {
        try {
          proc.stdin.write(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'session/close',
              params: { sessionId: this.acpSessionId },
            }) + '\n',
          );
        } catch {
          // Ignore
        }
      }
      try {
        proc.stdin.end();
      } catch {
        // Ignore
      }
    }

    if (!this.exited) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          proc.removeListener('exit', finish);
          proc.removeListener('close', finish);
          resolve();
        };
        const timer = setTimeout(finish, 300);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
        proc.once('exit', finish);
        proc.once('close', finish);
      });
    }

    if (!this.exited) {
      if (this.spawnFn === spawn && process.platform === 'win32' && proc.pid) {
        try {
          const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.unref();
        } catch {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Ignore
          }
        }
      } else {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
    }
  }

  private attachProcessListeners(proc: ChildProcess): void {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let eofEmitted = false;

    const emitEof = (code: number | null, error?: Error) => {
      this.exited = true;
      if (eofEmitted) return;
      eofEmitted = true;
      this.queue.push({ kind: 'eof', code, error });
    };

    const pushStdoutLine = (rawLine: string) => {
      const trimmed = rawLine.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.queue.push({ kind: 'rpc', msg: parsed as Record<string, any> });
          return;
        }
      } catch {
        // Non-JSON line treated as noise
      }
      this.queue.push({ kind: 'noise', line: trimmed });
    };

    const pushStderrLine = (rawLine: string) => {
      const trimmed = rawLine.trim();
      if (!trimmed) return;
      this.stderrTail.push(trimmed);
      if (this.stderrTail.length > 20) {
        this.stderrTail.shift();
      }
      this.queue.push({ kind: 'stderr', line: trimmed });
    };

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        pushStdoutLine(line);
      }
    });

    proc.stdout?.on('end', () => {
      if (stdoutBuffer.trim()) {
        pushStdoutLine(stdoutBuffer);
        stdoutBuffer = '';
      }
    });

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        pushStderrLine(line);
      }
    });

    proc.stderr?.on('end', () => {
      if (stderrBuffer.trim()) {
        pushStderrLine(stderrBuffer);
        stderrBuffer = '';
      }
    });

    proc.on('error', (err: Error) => {
      emitEof(null, err);
    });

    proc.on('exit', (code) => {
      emitEof(code);
    });

    proc.on('close', (code) => {
      emitEof(code);
    });
  }

  private writeRpc(payload: Record<string, unknown>): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed || !this.proc.stdin.writable) {
      throw new Error('Antigravity ACP stdin is not writable.');
    }
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  private async sendRpcRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, any>> {
    const id = this.nextRpcId++;
    this.writeRpc({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    const deadline = Date.now() + timeoutMs;
    while (true) {
      const remaining = Math.max(1, deadline - Date.now());
      let item: QueueItem;
      try {
        item = await this.queue.next(remaining);
      } catch (err) {
        if (err instanceof TimeoutError) {
          throw formatAcpError(
            `Antigravity ACP handshake timeout waiting for '${method}'`,
            this.stderrTail,
            err,
          );
        }
        throw err;
      }

      if (item.kind === 'eof') {
        if (item.error && (item.error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`找不到 Antigravity CLI 執行檔 (${this.agyPath})。請確認已安裝 agy CLI。`, {
            cause: item.error,
          });
        }
        throw formatAcpError(
          `Antigravity ACP exited during '${method}' (code: ${item.code ?? 'null'})`,
          this.stderrTail,
          item.error,
        );
      }

      if (item.kind !== 'rpc') {
        continue;
      }

      const msg = item.msg;
      if (msg.id === id) {
        if (msg.error) {
          const errMsg =
            typeof msg.error.message === 'string' ? msg.error.message : JSON.stringify(msg.error);
          throw formatAcpError(`Antigravity ACP '${method}' failed: ${errMsg}`, this.stderrTail);
        }
        return (msg.result || {}) as Record<string, any>;
      }
    }
  }

  private acquireTurnLock(): Promise<() => void> {
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.turnLock;
    this.turnLock = prev.then(() => nextLock);
    return prev.then(() => release);
  }
}

function normalizeWorkspaceForMatch(dir?: string): string {
  return dir ? path.resolve(dir) : '';
}

function getMcpServerUrlsSignature(servers?: AcpMcpServerSpec[]): string {
  if (!servers || servers.length === 0) return '';
  return servers
    .map((s) => `${s.name}:${s.url}`)
    .sort()
    .join('|');
}

/**
 * Pool for reusing warm `agy acp` stdio sessions across turns while isolating workspaces and policies.
 */
export class AgyAcpSessionPool {
  private readonly sessions = new Map<string, AgyAcpSession>();
  private readonly maxSessions: number;
  private readonly idleTimeoutMs: number;

  constructor(maxSessions = 12, idleTimeoutMs = 600_000) {
    this.maxSessions = maxSessions;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  public async getOrCreateSession(
    sessionKey: string,
    options: AgyAcpSessionOptions,
  ): Promise<{ session: AgyAcpSession; isNew: boolean }> {
    await this.reapIdleSessions();

    const existing = this.sessions.get(sessionKey);
    if (existing) {
      const targetGeminiDir = resolveGeminiDir(options.geminiDir);
      const targetWorkspace = normalizeWorkspaceForMatch(options.workspaceDir);
      const existingWorkspace = normalizeWorkspaceForMatch(existing.workspaceDir);
      const targetMcpSignature = options.mcpToolsSignature ?? '';
      const targetMcpUrls = getMcpServerUrlsSignature(options.mcpServers);
      const existingMcpUrls = getMcpServerUrlsSignature(existing.mcpServers);
      const matches =
        existing.isAlive &&
        existingWorkspace === targetWorkspace &&
        existing.geminiDir === targetGeminiDir &&
        existing.disableBuiltinTools === (options.disableBuiltinTools ?? false) &&
        existing.dangerouslySkipPermissions === (options.dangerouslySkipPermissions ?? false) &&
        existing.interactivePermissions === (options.interactivePermissions ?? false) &&
        existing.mcpToolsSignature === targetMcpSignature &&
        existingMcpUrls === targetMcpUrls;

      if (matches) {
        existing.lastUsed = Date.now();
        return { session: existing, isNew: false };
      }

      this.sessions.delete(sessionKey);
      await existing.close();
    }

    if (this.sessions.size >= this.maxSessions) {
      await this.evictOldestNonBusy();
    }

    const session = new AgyAcpSession(options);
    await session.start();
    this.sessions.set(sessionKey, session);
    return { session, isNew: true };
  }

  public async evictSession(sessionKey: string): Promise<void> {
    const existing = this.sessions.get(sessionKey);
    if (!existing) return;
    this.sessions.delete(sessionKey);
    await existing.close();
  }

  public async evictByPrefix(prefix: string): Promise<void> {
    const matches: Array<[string, AgyAcpSession]> = [];
    for (const [key, session] of this.sessions.entries()) {
      if (key.startsWith(prefix)) {
        matches.push([key, session]);
      }
    }
    for (const [key, session] of matches) {
      this.sessions.delete(key);
      await session.close();
    }
  }

  public async evictBySessionId(sessionId: string): Promise<void> {
    const matches: Array<[string, AgyAcpSession]> = [];
    for (const [key, session] of this.sessions.entries()) {
      if (session.sessionId === sessionId) {
        matches.push([key, session]);
      }
    }
    for (const [key, session] of matches) {
      this.sessions.delete(key);
      await session.close();
    }
  }

  public async evictBySubagentId(subagentId: string): Promise<void> {
    const matches: Array<[string, AgyAcpSession]> = [];
    for (const [key, session] of this.sessions.entries()) {
      if (session.subagentId === subagentId) {
        matches.push([key, session]);
      }
    }
    for (const [key, session] of matches) {
      this.sessions.delete(key);
      await session.close();
    }
  }

  public async shutdown(): Promise<void> {
    const all = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled(all.map((s) => s.close()));
  }

  public getStats(): {
    activeSessions: number;
    maxSessions: number;
    keys: string[];
  } {
    return {
      activeSessions: this.sessions.size,
      maxSessions: this.maxSessions,
      keys: Array.from(this.sessions.keys()),
    };
  }

  private async reapIdleSessions(): Promise<void> {
    const now = Date.now();
    const expired: Array<[string, AgyAcpSession]> = [];
    for (const [key, session] of this.sessions.entries()) {
      if (!session.isAlive || (!session.isBusy && now - session.lastUsed > this.idleTimeoutMs)) {
        expired.push([key, session]);
      }
    }
    for (const [key, session] of expired) {
      this.sessions.delete(key);
      await session.close();
    }
  }

  private async evictOldestNonBusy(): Promise<void> {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, session] of this.sessions.entries()) {
      if (!session.isBusy && session.lastUsed < oldestTime) {
        oldestTime = session.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const target = this.sessions.get(oldestKey);
      this.sessions.delete(oldestKey);
      if (target) {
        await target.close();
      }
    }
  }
}

export const AGY_ACP_SESSION_POOL = new AgyAcpSessionPool();
