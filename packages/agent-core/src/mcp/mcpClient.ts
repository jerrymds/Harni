import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  McpServerConfig,
  McpToolInfo,
  McpToolResult,
} from './mcpTypes.js';
import {
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  MCP_PROTOCOL_VERSION,
} from './mcpTypes.js';

/** JSON-RPC 2.0 request envelope */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 notification envelope (no id, no response expected) */
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_INIT_TIMEOUT_MS = 30_000;
const DEFAULT_LIST_TIMEOUT_MS = 30_000;

/**
 * Minimal Model Context Protocol stdio client.
 * Spawns the MCP server as a child process and communicates over stdin/stdout
 * using JSON-RPC 2.0 framed messages (`Content-Length: <n>\r\n\r\n<json>`).
 */
export class McpClient {
  public readonly serverName: string;

  private config: McpServerConfig;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private stderrTail = '';

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  /** Whether a child process is currently alive. */
  public get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Determine if shell wrapper is needed for this command on Windows. */
  private needsShell(command: string): boolean {
    if (process.platform !== 'win32') return false;
    // .cmd / .bat / .ps1 scripts always require cmd.exe to resolve.
    const ext = command.toLowerCase().split('.').pop();
    if (ext === 'cmd' || ext === 'bat' || ext === 'ps1') return true;
    // Bare names on Windows may resolve to .cmd wrappers like npx.cmd.
    if (!command.includes('/') && !command.includes('\\')) {
      const bare = command.toLowerCase().replace(/\.exe$/, '');
      if (['npx', 'npm', 'pnpm', 'yarn', 'tsx', 'uvx', 'bun', 'bunx'].includes(bare)) return true;
    }
    return false;
  }

  /**
   * Spawn the server process and run the MCP handshake:
   * `initialize` request -> `notifications/initialized` notification.
   */
  public async start(): Promise<void> {
    if (this.child) return;
    this.buffer = '';
    this.stderrTail = '';

    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      shell: this.needsShell(this.config.command),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.onStdout(chunk.toString('utf8'));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrTail = `${this.stderrTail}${text}`.slice(-8000);
      if (text.trim()) {
        console.warn(`[Mcp:${this.serverName}] stderr: ${text.trim()}`);
      }
    });

    child.on('error', (err) => {
      this.rejectAllPending(
        new Error(`MCP server '${this.serverName}' failed to spawn: ${err.message}`),
      );
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      this.rejectAllPending(
        new Error(
          `MCP server '${this.serverName}' exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'})${this.stderrTail ? ` - stderr: ${this.stderrTail}` : ''}`,
        ),
      );
    });

    try {
      await this.sendRequest('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
      });
      this.sendNotification('notifications/initialized');
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  /** Fetch the list of tools exposed by this server. */
  public async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.sendRequest('tools/list', {}, DEFAULT_LIST_TIMEOUT_MS)) as
      | { tools?: McpToolInfo[] }
      | undefined;
    return Array.isArray(result?.tools) ? result!.tools! : [];
  }

  /** Invoke a tool on the remote server. */
  public async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const result = (await this.sendRequest(
      'tools/call',
      { name, arguments: arguments_ },
      this.config.callTimeoutMs ?? 120_000,
    )) as McpToolResult | undefined;
    if (!result || typeof result !== 'object') {
      return { content: [{ type: 'text', text: String(result ?? '') }] };
    }
    return result;
  }

  /** Send a JSON-RPC request and await its matching response. */
  private sendRequest(
    method: string,
    params: unknown,
    timeoutMs: number = DEFAULT_INIT_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error(`MCP server '${this.serverName}' is not running`));
    }

    const id = ++this.nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request timed out after ${timeoutMs}ms (method '${method}', server '${this.serverName}')`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };
      this.writeMessage(request);
    });
  }
/** Send a fire-and-forget JSON-RPC notification. */
  private sendNotification(method: string, params?: unknown): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.writeMessage(notification);
  }

  private writeMessage(message: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
      this.rejectAllPending(new Error(`MCP server '${this.serverName}' is not running`));
      return;
    }
    const json = JSON.stringify(message);
    // Standard MCP stdio transport is newline-delimited JSON.
    this.child.stdin.write(`${json}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    this.parseBuffer();
  }

  /** Incremental parser supporting both standard newline-delimited JSON and Content-Length framing. */
  private parseBuffer(): void {
    while (this.buffer.length > 0) {
      // Skip leading whitespace / blank lines
      const trimmedStart = this.buffer.search(/\S/);
      if (trimmedStart === -1) {
        this.buffer = '';
        return;
      }
      if (trimmedStart > 0) {
        this.buffer = this.buffer.slice(trimmedStart);
      }

      // Check if buffer starts with Content-Length header
      if (/^content-length:/i.test(this.buffer)) {
        // Headers may end with \r\r\n\r\r\n (Windows), \r\n\r\n, or \n\n
        const headerEndMatch = /(\r?\r?\n\r?\r?\n)/.exec(this.buffer);
        if (!headerEndMatch) {
          if (this.buffer.length > 16384) {
            this.buffer = this.buffer.slice(-4096);
          }
          return;
        }

        const headerEnd = headerEndMatch.index;
        const separatorLength = headerEndMatch[0].length;
        const header = this.buffer.slice(0, headerEnd);
        const lengthMatch = /^content-length:\s*(\d+)/i.exec(header);
        if (!lengthMatch) {
          this.buffer = this.buffer.slice(headerEnd + separatorLength);
          continue;
        }

        const contentLength = parseInt(lengthMatch[1], 10);
        const payloadStart = headerEnd + separatorLength;

        const byteBuf = Buffer.from(this.buffer, 'utf8');
        const headerBytes = Buffer.byteLength(this.buffer.slice(0, payloadStart), 'utf8');
        if (byteBuf.length < headerBytes + contentLength) {
          return;
        }

        const rawPayload = byteBuf.subarray(headerBytes, headerBytes + contentLength).toString('utf8');
        this.buffer = byteBuf.subarray(headerBytes + contentLength).toString('utf8');
        this.handlePayload(rawPayload);
        continue;
      }

      // Standard MCP stdio transport: newline-delimited JSON (ndjson)
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        if (this.buffer.length > 65536) {
          this.buffer = this.buffer.slice(-16384);
        }
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) continue;

      if (line.startsWith('{') && line.endsWith('}')) {
        this.handlePayload(line);
      } else {
        console.warn(`[Mcp:${this.serverName}] stdout non-JSON ignored: ${line.slice(0, 120)}`);
      }
    }
  }

  private handlePayload(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[Mcp:${this.serverName}] Non-JSON payload dropped: ${raw.slice(0, 200)}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    const msg = parsed as { id?: unknown; result?: unknown; error?: unknown };
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);

      const errObj = msg.error as { message?: string } | undefined;
      if (errObj) {
        pending.reject(new Error(`MCP error (server '${this.serverName}'): ${errObj.message ?? JSON.stringify(msg.error)}`));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  public async stop(): Promise<void> {
    this.rejectAllPending(new Error(`MCP server '${this.serverName}' stopped`));
    const child = this.child;
    if (!child) return;
    this.child = null;
    try { child.stdin.end(); } catch { /* stdin may already be closed */ }

    const forceKill = () => {
      if (child.exitCode !== null) return;
      if (process.platform === 'win32' && child.pid) {
        const { exec } = require('node:child_process') as typeof import('node:child_process');
        exec(`taskkill /pid ${child.pid} /T /F`);
      } else {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }
    };

    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      const grace = setTimeout(() => { forceKill(); resolve(); }, 500);
      child.once('exit', () => { clearTimeout(grace); resolve(); });
    });
  }

  public getStderrTail(): string {
    return this.stderrTail;
  }
}