import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { MockProvider } from '@harni/agent-core';
import type { ClientMessage, ServerMessage } from '@harni/types';
import { createApp } from '../src/server.js';

describe('Server Session Pub/Sub & Workspace Isolation', () => {
  const tempDir = path.resolve('temp_server_test_isolation');
  let app: any;
  let port: number;

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    app = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath: path.join(tempDir, 'cline-test.db'),
    });
    port = await app.start();
  });

  afterAll(async () => {
    if (app) await app.stop();
    await new Promise((r) => setTimeout(r, 300));
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {}
  });

  it('isolates multi-client session pub/sub without cross-session leakage', async () => {
    const wsClientA = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const wsClientB = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    const clientAMessages: ServerMessage[] = [];
    const clientBMessages: ServerMessage[] = [];

    wsClientA.on('message', (d) => {
      try {
        clientAMessages.push(JSON.parse(d.toString()));
      } catch {}
    });
    wsClientB.on('message', (d) => {
      try {
        clientBMessages.push(JSON.parse(d.toString()));
      } catch {}
    });

    await Promise.all([
      new Promise<void>((res) => wsClientA.on('open', () => res())),
      new Promise<void>((res) => wsClientB.on('open', () => res())),
    ]);

    // Client A subscribes to session_alpha, Client B subscribes to session_beta
    wsClientA.send(JSON.stringify({ type: 'session:subscribe', payload: { sessionId: 'session_alpha' } }));
    wsClientB.send(JSON.stringify({ type: 'session:subscribe', payload: { sessionId: 'session_beta' } }));
    await new Promise((r) => setTimeout(r, 100));

    clientAMessages.length = 0;
    clientBMessages.length = 0;

    const isolatedMockProvider = new MockProvider({
      script: [
        {
          thought: 'Session Alpha confidential thinking chunk.',
          text: 'Session Alpha confidential token stream.',
          toolCalls: [],
        },
      ],
    });

    app.engine.startTask('Execute session alpha task', {
      sessionId: 'session_alpha',
      customProvider: isolatedMockProvider,
    });

    await new Promise((r) => setTimeout(r, 800));

    const clientATokens = clientAMessages.filter((m) => m.type === 'chat:token' && (m.payload as any).sessionId === 'session_alpha');
    const clientAThoughts = clientAMessages.filter((m) => m.type === 'chat:thinking' && (m.payload as any).sessionId === 'session_alpha');
    const clientBTokens = clientBMessages.filter((m) => m.type === 'chat:token');
    const clientBThoughts = clientBMessages.filter((m) => m.type === 'chat:thinking');

    expect(clientATokens.length).toBeGreaterThan(0);
    expect(clientAThoughts.length).toBeGreaterThan(0);
    expect(clientBTokens.length).toBe(0);
    expect(clientBThoughts.length).toBe(0);

    // Test dynamic subscription: Client B subscribes to session_alpha, Client A unsubscribes
    wsClientB.send(JSON.stringify({ type: 'session:subscribe', payload: { sessionId: 'session_alpha' } }));
    wsClientA.send(JSON.stringify({ type: 'session:unsubscribe', payload: { sessionId: 'session_alpha' } }));
    await new Promise((r) => setTimeout(r, 100));

    clientAMessages.length = 0;
    clientBMessages.length = 0;

    const dynamicMockProvider = new MockProvider({
      script: [
        {
          thought: 'Second run in session alpha.',
          text: 'Second run stream.',
          toolCalls: [],
        },
      ],
    });

    app.engine.startTask('Second run in session alpha', {
      sessionId: 'session_alpha',
      customProvider: dynamicMockProvider,
    });

    await new Promise((r) => setTimeout(r, 800));

    const clientATokensAfterUnsub = clientAMessages.filter((m) => m.type === 'chat:token');
    const clientBTokensAfterSub = clientBMessages.filter((m) => m.type === 'chat:token' && (m.payload as any).sessionId === 'session_alpha');

    expect(clientATokensAfterUnsub.length).toBe(0);
    expect(clientBTokensAfterSub.length).toBeGreaterThan(0);

    wsClientA.close();
    wsClientB.close();
  });

  it('handles dynamic workspace switching via workspace:set and isolates concurrent clients', async () => {
    const client1Dir = path.join(tempDir, 'client_workspace_1');
    const client2Dir = path.join(tempDir, 'client_workspace_2');
    await fs.mkdir(client1Dir, { recursive: true });
    await fs.mkdir(client2Dir, { recursive: true });

    await fs.writeFile(path.join(client1Dir, 'c1_initial.txt'), 'C1_DATA', 'utf-8');
    await fs.writeFile(path.join(client2Dir, 'c2_initial.txt'), 'C2_DATA', 'utf-8');

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    const ws1Messages: ServerMessage[] = [];
    const ws2Messages: ServerMessage[] = [];

    ws1.on('message', (d) => {
      try {
        ws1Messages.push(JSON.parse(d.toString()));
      } catch {}
    });
    ws2.on('message', (d) => {
      try {
        ws2Messages.push(JSON.parse(d.toString()));
      } catch {}
    });

    await Promise.all([
      new Promise<void>((res) => ws1.on('open', () => res())),
      new Promise<void>((res) => ws2.on('open', () => res())),
    ]);

    await new Promise((r) => setTimeout(r, 200));
    ws1Messages.length = 0;
    ws2Messages.length = 0;

    ws1.send(JSON.stringify({ type: 'workspace:set', payload: { path: client1Dir } }));
    ws2.send(JSON.stringify({ type: 'workspace:set', payload: { path: client2Dir } }));
    await new Promise((r) => setTimeout(r, 400));

    const c1Info = ws1Messages.filter((m) => m.type === 'workspace:info').pop();
    const c2Info = ws2Messages.filter((m) => m.type === 'workspace:info').pop();

    expect((c1Info?.payload as any)?.rootPath).toBe(client1Dir);
    expect((c2Info?.payload as any)?.rootPath).toBe(client2Dir);

    ws1.send(JSON.stringify({ type: 'file:save', payload: { path: 'c1_saved.txt', content: 'C1_SAVED_CONTENT' } }));
    ws2.send(JSON.stringify({ type: 'file:save', payload: { path: 'c2_saved.txt', content: 'C2_SAVED_CONTENT' } }));
    await new Promise((r) => setTimeout(r, 300));

    const c1Saved = await fs.readFile(path.join(client1Dir, 'c1_saved.txt'), 'utf-8').catch(() => '');
    const c2Saved = await fs.readFile(path.join(client2Dir, 'c2_saved.txt'), 'utf-8').catch(() => '');
    const c1InC2 = await fs.access(path.join(client2Dir, 'c1_saved.txt')).then(() => true).catch(() => false);
    const c2InC1 = await fs.access(path.join(client1Dir, 'c2_saved.txt')).then(() => true).catch(() => false);

    expect(c1Saved).toBe('C1_SAVED_CONTENT');
    expect(c2Saved).toBe('C2_SAVED_CONTENT');
    expect(c1InC2).toBe(false);
    expect(c2InC1).toBe(false);

    ws1.close();
    ws2.close();
  });
});
