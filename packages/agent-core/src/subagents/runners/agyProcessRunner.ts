import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface AgyProcessRunnerOptions {
  binaryPath?: string;
  prompt: string;
  workspaceRoot?: string;
  conversationId?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  mode?: 'accept-edits' | 'plan';
  dangerouslySkipPermissions?: boolean;
  timeoutMs?: number;
  onToken?: (text: string, isThinking?: boolean) => void;
  onTool?: (payload: {
    toolName: string;
    summary?: string;
    status: 'start' | 'complete' | 'error';
  }) => void;
  onInit?: (data: { conversationId: string; tools?: string[] }) => void;
  signal?: AbortSignal;
}

export interface AgyUsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
}

export interface AgyProcessResult {
  conversationId: string;
  status: 'SUCCESS' | 'ERROR' | 'CANCELLED';
  response: string;
  durationSeconds?: number;
  usage?: AgyUsageInfo;
  error?: string;
}

export class AgyBinaryResolver {
  private static cachedPath: string | null = null;

  public static async resolve(customPath?: string): Promise<string> {
    if (customPath) {
      try {
        await fs.access(customPath);
        return customPath;
      } catch {
        throw new Error(`自訂的 agy 執行檔路徑不存在：${customPath}`);
      }
    }

    if (this.cachedPath) {
      try {
        await fs.access(this.cachedPath);
        return this.cachedPath;
      } catch {
        this.cachedPath = null;
      }
    }

    // 1. Check environment variable
    if (process.env.AGY_BIN_PATH) {
      try {
        await fs.access(process.env.AGY_BIN_PATH);
        this.cachedPath = process.env.AGY_BIN_PATH;
        return this.cachedPath;
      } catch {
        // Continue searching
      }
    }

    // 2. Check standard ~/.gemini/bin/agy(.exe)
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'agy.exe' : 'agy';
    const defaultGeminiBin = path.join(homeDir, '.gemini', 'bin', binaryName);

    try {
      await fs.access(defaultGeminiBin);
      this.cachedPath = defaultGeminiBin;
      return defaultGeminiBin;
    } catch {
      // Continue
    }

    // 3. Fallback to binary name expecting PATH resolution
    return binaryName;
  }
}

export class AgyProcessRunner {
  /**
   * Filter and sanitize model names to prevent passing incompatible proxy/external model identifiers to agy.exe
   */
  public static sanitizeModel(model?: string): string | undefined {
    if (!model) return undefined;
    const trimmed = model.trim();
    // Strip common provider prefixes if user passed e.g. "antigravity/gemini-3.7-flash"
    const cleaned = trimmed.replace(/^(antigravity|google|gemini)\//i, '');

    // Check if it's a known agy model
    if (
      cleaned.startsWith('gemini-') ||
      cleaned.startsWith('claude-') ||
      cleaned.startsWith('gpt-oss-')
    ) {
      return cleaned;
    }

    // External provider models (e.g. cline-pass/*, openai/*, etc.) should not be passed to agy.exe
    return undefined;
  }

  /**
   * Execute an agy command turn using stream-json format
   */
  public static async run(options: AgyProcessRunnerOptions): Promise<AgyProcessResult> {
    const binary = await AgyBinaryResolver.resolve(options.binaryPath);
    const args: string[] = ['--print', options.prompt, '--output-format', 'stream-json'];

    // Auto-approve tool permissions if headless (default true)
    if (options.dangerouslySkipPermissions !== false) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.workspaceRoot) {
      args.push('--add-dir', options.workspaceRoot);
    }

    if (options.conversationId) {
      args.push('--conversation', options.conversationId);
    }

    const sanitizedModel = AgyProcessRunner.sanitizeModel(options.model);
    if (sanitizedModel) {
      args.push('--model', sanitizedModel);
    }

    // --effort is supported on Gemini reasoning models or when using agy's default Gemini model
    const supportsEffort = !sanitizedModel || sanitizedModel.startsWith('gemini-');
    if (options.effort && supportsEffort) {
      args.push('--effort', options.effort);
    }

    if (options.mode) {
      args.push('--mode', options.mode);
    }

    const timeoutMs = options.timeoutMs ?? 300_000; // 預設 5 分鐘
    const cwd = options.workspaceRoot || process.cwd();

    return new Promise<AgyProcessResult>((resolve, reject) => {
      let child: ChildProcess | null = null;
      let timer: NodeJS.Timeout | null = null;
      let buffer = '';
      let detectedConversationId = options.conversationId || '';
      let finalResponse = '';
      let finalUsage: AgyUsageInfo | undefined;
      let finalStatus: 'SUCCESS' | 'ERROR' | 'CANCELLED' = 'SUCCESS';
      let durationSeconds: number | undefined;
      let stderrBuffer = '';
      let isSettled = false;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const killProcessTree = () => {
        if (!child || !child.pid) return;
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          // Ignore kill error
        }
      };

      if (options.signal) {
        if (options.signal.aborted) {
          return resolve({
            conversationId: detectedConversationId,
            status: 'CANCELLED',
            response: 'Task was cancelled before execution.',
          });
        }
        options.signal.addEventListener('abort', () => {
          if (!isSettled) {
            isSettled = true;
            cleanup();
            killProcessTree();
            resolve({
              conversationId: detectedConversationId,
              status: 'CANCELLED',
              response: finalResponse || 'Task cancelled by user.',
            });
          }
        });
      }

      timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          killProcessTree();
          resolve({
            conversationId: detectedConversationId,
            status: 'ERROR',
            response: finalResponse || 'Agy process execution timed out.',
            error: `Timeout exceeded (${Math.round(timeoutMs / 1000)}s)`,
          });
        }
      }, timeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      try {
        child = spawn(binary, args, {
          cwd,
          windowsHide: true,
          env: {
            ...process.env,
            PAGER: 'cat',
          },
        });
      } catch (err: unknown) {
        cleanup();
        const msg = err instanceof Error ? err.message : String(err);
        return reject(new Error(`Failed to spawn agy process (${binary}): ${msg}`));
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.event === 'init') {
              if (data.conversation_id) {
                detectedConversationId = data.conversation_id;
              }
              options.onInit?.({
                conversationId: data.conversation_id,
                tools: data.init?.tools,
              });
            } else if (data.event === 'step_update') {
              const su = data.step_update || {};
              if (su.conversation_id) {
                detectedConversationId = su.conversation_id;
              }

              if (su.step_type === 'agent_response' && su.text_delta) {
                finalResponse += su.text_delta;
                options.onToken?.(su.text_delta, false);
              } else if (
                su.step_type === 'tool' ||
                su.step_type === 'tool_call' ||
                Boolean(su.tool_call) ||
                Boolean(su.tool_name)
              ) {
                const toolName =
                  su.tool_name ||
                  su.tool_call?.name ||
                  su.tool_info?.name ||
                  'tool';
                let summary = `Executing tool: ${toolName}`;

                const rawParams =
                  su.tool_info?.parameters ||
                  su.tool_call?.parameters ||
                  su.parameters;

                if (rawParams && typeof rawParams === 'object') {
                  const p = rawParams as Record<string, unknown>;
                  if (p.AbsolutePath) {
                    const rel = String(p.AbsolutePath).replace(/\\/g, '/');
                    summary = `${toolName}: ${rel.split('/').slice(-3).join('/')}`;
                  } else if (p.command || p.CommandLine) {
                    summary = `${toolName}: ${String(p.command || p.CommandLine).slice(0, 60)}`;
                  } else if (p.query) {
                    summary = `${toolName}: ${String(p.query).slice(0, 60)}`;
                  } else if (p.TargetFile) {
                    const rel = String(p.TargetFile).replace(/\\/g, '/');
                    summary = `${toolName}: ${rel.split('/').slice(-3).join('/')}`;
                  } else {
                    summary = `${toolName}: ${JSON.stringify(rawParams).slice(0, 60)}`;
                  }
                }

                const isComplete = su.state === 'DONE';
                options.onTool?.({
                  toolName,
                  summary,
                  status: isComplete ? 'complete' : 'start',
                });
              }

              if (su.usage) {
                finalUsage = {
                  inputTokens: su.usage.input_tokens,
                  outputTokens: su.usage.output_tokens,
                  thinkingTokens: su.usage.thinking_tokens,
                  cacheReadTokens: su.usage.cache_read_tokens,
                  totalTokens: su.usage.total_tokens,
                };
              }
            } else if (data.event === 'result') {
              const res = data.result || {};
              if (res.conversation_id) {
                detectedConversationId = res.conversation_id;
              }
              if (res.response) {
                finalResponse = res.response;
              }
              if (res.status === 'ERROR') {
                finalStatus = 'ERROR';
              } else {
                finalStatus = 'SUCCESS';
              }
              if (typeof res.duration_seconds === 'number') {
                durationSeconds = res.duration_seconds;
              }
              if (res.usage) {
                finalUsage = {
                  inputTokens: res.usage.input_tokens,
                  outputTokens: res.usage.output_tokens,
                  thinkingTokens: res.usage.thinking_tokens,
                  cacheReadTokens: res.usage.cache_read_tokens,
                  totalTokens: res.usage.total_tokens,
                };
              }
            }
          } catch {
            // Non-JSON line or partial, fallback
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          reject(new Error(`agy process encountered an error: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();

        // Process leftover buffer
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer.trim());
            if (data.event === 'result' && data.result?.response) {
              finalResponse = data.result.response;
            }
          } catch {
            // ignore
          }
        }

        if (code !== 0 && finalStatus !== 'SUCCESS') {
          resolve({
            conversationId: detectedConversationId,
            status: 'ERROR',
            response: finalResponse || stderrBuffer || `agy exited with code ${code}`,
            error: stderrBuffer || `Process exited with code ${code}`,
            durationSeconds,
            usage: finalUsage,
          });
        } else {
          resolve({
            conversationId: detectedConversationId,
            status: finalStatus,
            response: finalResponse,
            durationSeconds,
            usage: finalUsage,
          });
        }
      });
    });
  }
}
