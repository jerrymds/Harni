import * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@harni/types';
import {
  HARNI_ACP_MCP_SERVER_NAME,
  HARNI_ACP_MCP_TOOL_PREFIX,
  HarniAcpMcpBridge,
  type AcpMcpServerSpec,
} from '../src/providers/harniAcpMcpBridge.js';

function requestRaw(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: options.method ?? 'POST',
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

function authHeader(spec: AcpMcpServerSpec): Record<string, string> {
  const h = spec.headers.find((item) => item.name.toLowerCase() === 'authorization');
  return h ? { Authorization: h.value } : {};
}

describe('HarniAcpMcpBridge', () => {
  const bridges: HarniAcpMcpBridge[] = [];

  afterEach(async () => {
    while (bridges.length > 0) {
      const b = bridges.pop()!;
      await b.close();
    }
  });

  const sampleTools: ToolDefinition[] = [
    {
      name: 'invoke_subagent',
      description: 'Spawn subagent',
      parameters: {
        type: 'object',
        properties: {
          subagents: { type: 'array', description: 'List' },
        },
        required: ['subagents'],
      },
    },
  ];

  it('binds strictly to 127.0.0.1, enforces Bearer auth, path, method, maxBodyBytes, and JSON parse', async () => {
    const bridge = new HarniAcpMcpBridge({ maxBodyBytes: 128 });
    bridges.push(bridge);

    expect(HARNI_ACP_MCP_SERVER_NAME).toBe('harni');
    expect(HARNI_ACP_MCP_TOOL_PREFIX).toBe('mcp_harni_');

    const handle = await bridge.register('sess-key-1', {
      getTools: () => sampleTools,
      executeTool: async (_name, _args, meta) => ({
        toolCallId: meta.toolCallId,
        output: 'ok',
      }),
    });

    const parsedUrl = new URL(handle.serverSpec.url);
    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(Number(parsedUrl.port)).toBeGreaterThan(0);
    expect(handle.serverSpec.type).toBe('http');
    expect(handle.serverSpec.name).toBe('harni');

    // Warm reuse on same key keeps bridgeId and URL stable
    const handleReused = await bridge.register('sess-key-1', {
      getTools: () => sampleTools,
      executeTool: async (_name, _args, meta) => ({
        toolCallId: meta.toolCallId,
        output: 'ok2',
      }),
    });
    expect(handleReused.bridgeId).toBe(handle.bridgeId);
    expect(handleReused.serverSpec.url).toBe(handle.serverSpec.url);

    // 404 on wrong path / unknown bridgeId
    const wrongPath = await requestRaw(
      `http://127.0.0.1:${parsedUrl.port}/mcp/deadbeef0000`,
      {
        method: 'POST',
        headers: { ...authHeader(handle.serverSpec), 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(wrongPath.status).toBe(404);

    // 401 on missing or wrong Bearer token
    const missingAuth = await requestRaw(handle.serverSpec.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(missingAuth.status).toBe(401);

    const wrongAuth = await requestRaw(handle.serverSpec.url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(wrongAuth.status).toBe(401);

    // 405 on GET (after auth)
    const getRes = await requestRaw(handle.serverSpec.url, {
      method: 'GET',
      headers: authHeader(handle.serverSpec),
    });
    expect(getRes.status).toBe(405);

    // 200 on DELETE (after auth)
    const delRes = await requestRaw(handle.serverSpec.url, {
      method: 'DELETE',
      headers: authHeader(handle.serverSpec),
    });
    expect(delRes.status).toBe(200);

    // 413 on body > maxBodyBytes
    const oversized = await requestRaw(handle.serverSpec.url, {
      method: 'POST',
      headers: { ...authHeader(handle.serverSpec), 'Content-Type': 'application/json' },
      body: 'x'.repeat(256),
    });
    expect(oversized.status).toBe(413);

    // 400 with -32700 on invalid JSON
    const badJson = await requestRaw(handle.serverSpec.url, {
      method: 'POST',
      headers: { ...authHeader(handle.serverSpec), 'Content-Type': 'application/json' },
      body: '{invalid',
    });
    expect(badJson.status).toBe(400);
    expect(JSON.parse(badJson.body).error.code).toBe(-32700);
  });

  it('handles full MCP JSON-RPC lifecycle including JSON and SSE tools/call + progress heartbeats', async () => {
    const bridge = new HarniAcpMcpBridge({ heartbeatIntervalMs: 25 });
    bridges.push(bridge);

    const executeTool = vi.fn(async (name: string, args: Record<string, unknown>, meta: { toolCallId: string }) => {
      if (args.delayMs) {
        await new Promise((r) => setTimeout(r, Number(args.delayMs)));
      }
      return {
        toolCallId: meta.toolCallId,
        output: `executed:${name}:${JSON.stringify(args)}`,
      };
    });

    const handle = await bridge.register('lifecycle-key', {
      getTools: () => sampleTools,
      executeTool,
    });

    const headers = {
      ...authHeader(handle.serverSpec),
      'Content-Type': 'application/json',
    };

    // server/discover -> -32601
    const discoverRes = await requestRaw(handle.serverSpec.url, {
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' }),
    });
    expect(discoverRes.status).toBe(200);
    expect(JSON.parse(discoverRes.body).error.code).toBe(-32601);

    // initialize
    const initRes = await requestRaw(handle.serverSpec.url, {
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize' }),
    });
    expect(initRes.status).toBe(200);
    expect(JSON.parse(initRes.body).result).toMatchObject({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'harni', version: '1.0.0' },
    });

    // notifications/initialized -> 202 empty
    const notifRes = await requestRaw(handle.serverSpec.url, {
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(notifRes.status).toBe(202);
    expect(notifRes.body).toBe('');

    // ping -> {}
    const pingRes = await requestRaw(handle.serverSpec.url, {
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
    });
    expect(pingRes.status).toBe(200);
    expect(JSON.parse(pingRes.body).result).toEqual({});

    // tools/list
    const listRes = await requestRaw(handle.serverSpec.url, {
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
    });
    expect(listRes.status).toBe(200);
    const listPayload = JSON.parse(listRes.body);
    expect(listPayload.result.tools).toHaveLength(1);
    expect(listPayload.result.tools[0].name).toBe('invoke_subagent');
    expect(listPayload.result.tools[0].inputSchema.required).toEqual(['subagents']);

    // tools/call (unknown tool)
    const unknownRes = await requestRaw(handle.serverSpec.url, {
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'non_existent', arguments: {} },
      }),
    });
    expect(unknownRes.status).toBe(200);
    expect(JSON.parse(unknownRes.body).result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Unknown bridged Harni tool: non_existent' }],
    });

    // tools/call (JSON response)
    const callJsonRes = await requestRaw(handle.serverSpec.url, {
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'invoke_subagent', arguments: { hello: 'world' } },
      }),
    });
    expect(callJsonRes.status).toBe(200);
    expect(JSON.parse(callJsonRes.body).result).toEqual({
      content: [{ type: 'text', text: 'executed:invoke_subagent:{"hello":"world"}' }],
    });

    // tools/call (SSE text/event-stream + progressToken heartbeat)
    const callSseRes = await requestRaw(handle.serverSpec.url, {
      headers: {
        ...headers,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'invoke_subagent',
          arguments: { delayMs: 85 },
          _meta: { progressToken: 'prog_1' },
        },
      }),
    });
    expect(callSseRes.status).toBe(200);
    expect(callSseRes.headers['content-type']).toContain('text/event-stream');
    expect(callSseRes.body).toContain('notifications/progress');
    expect(callSseRes.body).toContain('"progressToken":"prog_1"');
    const dataPayloads = callSseRes.body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    const finalRpc = dataPayloads.find((p) => p.id === 7);
    expect(finalRpc?.result).toEqual({
      content: [{ type: 'text', text: 'executed:invoke_subagent:{"delayMs":85}' }],
    });
  });

  it('tracks hasActiveCalls, aborts signal on client disconnect (only on res close), and supports unregisterBySessionId/SubagentId', async () => {
    const bridge = new HarniAcpMcpBridge();
    bridges.push(bridge);

    let abortedObserved = false;
    let activeInsideTool = false;
    let releaseTool!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      void bridge
        .register(
          'abort-key',
          {
            getTools: () => sampleTools,
            executeTool: async (_name, _args, meta) => {
              activeInsideTool = bridge.hasActiveCalls('abort-key') && bridge.hasActiveCalls();
              meta.signal?.addEventListener('abort', () => {
                abortedObserved = true;
              });
              resolve();
              await new Promise<void>((r) => {
                releaseTool = r;
              });
              return { toolCallId: meta.toolCallId, output: 'done' };
            },
          },
          { sessionId: 'sess-A', subagentId: 'sub-A' },
        )
        .then(async (handle) => {
          const url = new URL(handle.serverSpec.url);
          const req = http.request({
            hostname: url.hostname,
            port: Number(url.port),
            path: url.pathname,
            method: 'POST',
            headers: {
              ...authHeader(handle.serverSpec),
              'Content-Type': 'application/json',
            },
          });
          req.on('error', () => {});
          req.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'invoke_subagent', arguments: {} },
            }),
          );
          req.end();

          await toolStarted;
          expect(activeInsideTool).toBe(true);
          // Body has already finished; req.close did NOT abort prematurely
          expect(abortedObserved).toBe(false);

          // Now forcibly destroy the client socket before response ends
          req.destroy();
          await vi.waitFor(() => {
            expect(abortedObserved).toBe(true);
          });
          releaseTool();
          await vi.waitFor(() => {
            expect(bridge.hasActiveCalls()).toBe(false);
          });
        });
    });

    await toolStarted;
    await vi.waitFor(() => {
      expect(bridge.hasActiveCalls()).toBe(false);
    });

    // Verify unregisterBySessionId and unregisterBySubagentId
    const h1 = await bridge.register(
      'k-sess',
      { getTools: () => sampleTools, executeTool: async () => ({ toolCallId: '1', output: 'ok' }) },
      { sessionId: 'sess-1' },
    );
    const h2 = await bridge.register(
      'k-sub',
      { getTools: () => sampleTools, executeTool: async () => ({ toolCallId: '2', output: 'ok' }) },
      { sessionId: 'sess-2', subagentId: 'sub-2' },
    );

    bridge.unregisterBySessionId('sess-1');
    const r1 = await requestRaw(h1.serverSpec.url, {
      headers: { ...authHeader(h1.serverSpec), 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(r1.status).toBe(404);

    bridge.unregisterBySubagentId('sub-2');
    const r2 = await requestRaw(h2.serverSpec.url, {
      headers: { ...authHeader(h2.serverSpec), 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(r2.status).toBe(404);
  });
});
