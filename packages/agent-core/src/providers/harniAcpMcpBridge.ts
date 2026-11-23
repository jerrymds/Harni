import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ToolDefinition, ToolResult } from '@harni/types';

export const HARNI_ACP_MCP_SERVER_NAME = 'harni';
export const HARNI_ACP_MCP_TOOL_PREFIX = 'mcp_harni_';

export interface AcpMcpServerSpec {
  name: string;
  type: 'http';
  url: string;
  headers: Array<{ name: string; value: string }>;
}

export interface HarniAcpMcpBridgeHandler {
  getTools: () => ToolDefinition[];
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    meta: { toolCallId: string; signal?: AbortSignal },
  ) => Promise<ToolResult>;
}

export interface HarniAcpMcpBridgeHandle {
  bridgeId: string;
  serverName: string;
  serverSpec: AcpMcpServerSpec;
  getToolNames: () => string[];
  hasActiveCalls: () => boolean;
  updateHandler: (handler: HarniAcpMcpBridgeHandler) => void;
  dispose: () => void;
}

export interface HarniAcpMcpBridgeOptions {
  serverName?: string;
  heartbeatIntervalMs?: number;
  maxBodyBytes?: number;
}

interface BridgeEntry {
  key: string;
  bridgeId: string;
  token: string;
  serverSpec: AcpMcpServerSpec;
  handler: HarniAcpMcpBridgeHandler;
  sessionId?: string;
  subagentId?: string;
  activeCalls: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const MCP_PATH_PATTERN = /^\/mcp\/([a-f0-9]+)$/;

function sendJsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendJsonRpcError(
  res: http.ServerResponse,
  statusCode: number,
  id: unknown,
  code: number,
  message: string,
): void {
  sendJsonResponse(res, statusCode, {
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: { code, message },
  });
}

function verifyBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader || typeof authHeader !== 'string') {
    return false;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match) {
    return false;
  }
  const providedBuf = Buffer.from(match[1]!, 'utf8');
  const expectedBuf = Buffer.from(expectedToken, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Zero-dependency in-process Streamable HTTP MCP server bound strictly to 127.0.0.1:0.
 * Bridges Harni tools (e.g. `invoke_subagent`) to `agy acp` sessions with Bearer auth,
 * SSE keepalive/progress heartbeats, and response-close abort propagation.
 */
export class HarniAcpMcpBridge {
  public readonly serverName: string;

  private readonly heartbeatIntervalMs: number;
  private readonly maxBodyBytes: number;
  private readonly entriesByKey = new Map<string, BridgeEntry>();
  private readonly entriesById = new Map<string, BridgeEntry>();
  private server: http.Server | null = null;
  private port: number | null = null;
  private startPromise: Promise<number> | null = null;

  constructor(options: HarniAcpMcpBridgeOptions = {}) {
    this.serverName = options.serverName || HARNI_ACP_MCP_SERVER_NAME;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  private async ensureStarted(): Promise<number> {
    if (this.port !== null && this.server?.listening) {
      return this.port;
    }
    if (this.startPromise) {
      return await this.startPromise;
    }

    this.startPromise = new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      const onError = (err: Error) => {
        server.removeListener('listening', onListening);
        if (this.server !== server) {
          server.close();
          reject(err);
          return;
        }
        this.server = null;
        this.port = null;
        this.startPromise = null;
        reject(err);
      };

      const onListening = () => {
        server.removeListener('error', onError);
        if (this.server !== server) {
          server.close();
          this.startPromise = null;
          reject(new Error('HarniAcpMcpBridge closed during startup'));
          return;
        }
        const addr = server.address() as AddressInfo | null;
        if (!addr || typeof addr.port !== 'number') {
          this.startPromise = null;
          reject(new Error('Failed to bind HarniAcpMcpBridge HTTP server'));
          return;
        }
        server.unref();
        this.port = addr.port;
        resolve(addr.port);
      };

      this.server = server;
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });

    return await this.startPromise;
  }

  public async register(
    key: string,
    handler: HarniAcpMcpBridgeHandler,
    meta?: { sessionId?: string; subagentId?: string },
  ): Promise<HarniAcpMcpBridgeHandle> {
    const port = await this.ensureStarted();
    let entry = this.entriesByKey.get(key);

    if (entry) {
      entry.handler = handler;
      entry.sessionId = meta?.sessionId;
      entry.subagentId = meta?.subagentId;
    } else {
      const bridgeId = crypto.randomBytes(12).toString('hex');
      const token = crypto.randomBytes(32).toString('hex');
      const serverSpec: AcpMcpServerSpec = {
        name: this.serverName,
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp/${bridgeId}`,
        headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
      };
      entry = {
        key,
        bridgeId,
        token,
        serverSpec,
        handler,
        sessionId: meta?.sessionId,
        subagentId: meta?.subagentId,
        activeCalls: 0,
      };
      this.entriesByKey.set(key, entry);
      this.entriesById.set(bridgeId, entry);
    }

    const boundEntry = entry;
    return {
      bridgeId: boundEntry.bridgeId,
      serverName: this.serverName,
      serverSpec: {
        ...boundEntry.serverSpec,
        headers: boundEntry.serverSpec.headers.map((h) => ({ ...h })),
      },
      getToolNames: () => boundEntry.handler.getTools().map((t) => t.name),
      hasActiveCalls: () => boundEntry.activeCalls > 0,
      updateHandler: (nextHandler: HarniAcpMcpBridgeHandler) => {
        boundEntry.handler = nextHandler;
      },
      dispose: () => {
        this.unregister(key);
      },
    };
  }

  public unregister(key: string): void {
    const existing = this.entriesByKey.get(key);
    if (!existing) return;
    this.entriesByKey.delete(key);
    this.entriesById.delete(existing.bridgeId);
  }

  public unregisterBySessionId(sessionId: string): void {
    for (const [key, entry] of Array.from(this.entriesByKey.entries())) {
      if (entry.sessionId === sessionId) {
        this.entriesByKey.delete(key);
        this.entriesById.delete(entry.bridgeId);
      }
    }
  }

  public unregisterBySubagentId(subagentId: string): void {
    for (const [key, entry] of Array.from(this.entriesByKey.entries())) {
      if (entry.subagentId === subagentId) {
        this.entriesByKey.delete(key);
        this.entriesById.delete(entry.bridgeId);
      }
    }
  }

  public hasActiveCalls(key?: string): boolean {
    if (key !== undefined) {
      return (this.entriesByKey.get(key)?.activeCalls ?? 0) > 0;
    }
    for (const entry of this.entriesByKey.values()) {
      if (entry.activeCalls > 0) {
        return true;
      }
    }
    return false;
  }

  public async close(): Promise<void> {
    this.entriesByKey.clear();
    this.entriesById.clear();
    this.startPromise = null;
    this.port = null;

    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const pathname = (req.url || '').split('?')[0] || '';
    const match = MCP_PATH_PATTERN.exec(pathname);
    const entry = match ? this.entriesById.get(match[1]!) : undefined;

    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    if (!verifyBearerToken(req.headers.authorization, entry.token)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized');
      return;
    }

    if (req.method === 'DELETE') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, {
        Allow: 'POST, DELETE',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Method Not Allowed');
      return;
    }

    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader !== undefined) {
      const declaredLen = Number(contentLengthHeader);
      if (Number.isFinite(declaredLen) && declaredLen > this.maxBodyBytes) {
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Payload Too Large');
        return;
      }
    }

    let rawBody: string;
    try {
      rawBody = await this.readBody(req);
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 413) {
        if (!res.writableEnded && !res.destroyed) {
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Payload Too Large');
        }
        return;
      }
      sendJsonRpcError(res, 400, null, -32700, 'Failed to read request body');
      return;
    }

    let msg: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJsonRpcError(res, 400, null, -32700, 'Invalid JSON-RPC payload');
        return;
      }
      msg = parsed as Record<string, unknown>;
    } catch {
      sendJsonRpcError(res, 400, null, -32700, 'Parse error');
      return;
    }

    // Notifications (no id) return 202 empty body
    if (msg.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }

    const method = typeof msg.method === 'string' ? msg.method : '';

    if (method === 'server/discover') {
      sendJsonRpcError(res, 200, msg.id, -32601, 'Method not found');
      return;
    }

    if (method === 'initialize') {
      sendJsonResponse(res, 200, {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.serverName, version: '1.0.0' },
        },
      });
      return;
    }

    if (method === 'ping') {
      sendJsonResponse(res, 200, {
        jsonrpc: '2.0',
        id: msg.id,
        result: {},
      });
      return;
    }

    if (method === 'tools/list') {
      const tools = entry.handler.getTools();
      sendJsonResponse(res, 200, {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: {
              type: 'object',
              properties: t.parameters?.properties || {},
              ...(t.parameters?.required ? { required: t.parameters.required } : {}),
            },
          })),
        },
      });
      return;
    }

    if (method === 'tools/call') {
      await this.handleToolsCall(req, res, entry, msg);
      return;
    }

    sendJsonRpcError(res, 200, msg.id, -32601, `Method not found: ${method}`);
  }

  private async handleToolsCall(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    entry: BridgeEntry,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const params =
      msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)
        ? (msg.params as Record<string, unknown>)
        : {};
    const toolName = typeof params.name === 'string' ? params.name : '';
    const toolArgs =
      params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
    const rawMeta =
      params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta)
        ? (params._meta as Record<string, unknown>)
        : undefined;
    const progressToken = rawMeta?.progressToken as string | number | undefined;

    const wantsSse =
      String(req.headers.accept || '').includes('text/event-stream') || Boolean(progressToken);

    const writeRpcResponse = (mcpResult: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      const rpcResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: mcpResult,
      };
      if (wantsSse) {
        res.write(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`);
        res.end();
      } else {
        sendJsonResponse(res, 200, rpcResponse);
      }
    };

    const availableTools = entry.handler.getTools();
    const isKnownTool = availableTools.some((t) => t.name === toolName);
    if (!isKnownTool) {
      if (wantsSse) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }
      writeRpcResponse({
        content: [{ type: 'text', text: `Unknown bridged Harni tool: ${toolName}` }],
        isError: true,
      });
      return;
    }

    entry.activeCalls++;
    const reqAbortController = new AbortController();
    // CRITICAL: Listen only on res.close (not req.close, which fires right after body read)
    const onResClose = () => {
      if (!res.writableEnded) {
        reqAbortController.abort();
      }
    };
    res.on('close', onResClose);

    let heartbeatTimer: NodeJS.Timeout | undefined;
    let progressStep = 0;

    if (wantsSse) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      heartbeatTimer = setInterval(() => {
        if (res.writableEnded || res.destroyed) return;
        if (progressToken !== undefined) {
          progressStep++;
          const notif = {
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: progressStep,
            },
          };
          res.write(`event: message\ndata: ${JSON.stringify(notif)}\n\n`);
        } else {
          res.write(': keepalive\n\n');
        }
      }, this.heartbeatIntervalMs);
      if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }
    }

    try {
      const toolCallId =
        msg.id !== undefined ? `acp_mcp_${String(msg.id)}` : `acp_mcp_${Date.now()}`;
      const result = await entry.handler.executeTool(toolName, toolArgs, {
        toolCallId,
        signal: reqAbortController.signal,
      });

      const text =
        typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
      writeRpcResponse({
        content: [{ type: 'text', text }],
        ...(result.isError ? { isError: true } : {}),
      });
    } catch (err: unknown) {
      const errText = err instanceof Error ? err.message : String(err);
      writeRpcResponse({
        content: [{ type: 'text', text: errText }],
        isError: true,
      });
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      res.removeListener('close', onResClose);
      entry.activeCalls = Math.max(0, entry.activeCalls - 1);
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let rejected = false;

      req.on('data', (chunk: Buffer | string) => {
        if (rejected) return;
        const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
        totalBytes += buf.length;
        if (totalBytes > this.maxBodyBytes) {
          rejected = true;
          const err = Object.assign(new Error('Payload Too Large'), { statusCode: 413 });
          req.resume();
          reject(err);
          return;
        }
        chunks.push(buf);
      });

      req.on('end', () => {
        if (rejected) return;
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      req.on('error', (err) => {
        if (rejected) return;
        rejected = true;
        reject(err);
      });
    });
  }
}

export const HARNI_ACP_MCP_BRIDGE = new HarniAcpMcpBridge();
