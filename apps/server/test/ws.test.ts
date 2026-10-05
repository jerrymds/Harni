import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { MockProvider } from '@harni/agent-core';
import type { ClientMessage, ServerMessage } from '@harni/types';
import { createApp } from '../src/server.js';

describe('Server WebSocket Protocol & Agent Flow', () => {
  const tempDir = path.resolve('temp_server_test_ws');
  let app: any;
  let port: number;

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'Sample content for testing', 'utf-8');
    app = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath: path.join(tempDir, 'cline-test.db'),
    });
    port = await app.start();
  });

  afterAll(async () => {
    if (app) await app.stop();
    await new Promise((r) => setTimeout(r, 200));
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {}
  });

  it('connects to WebSocket and receives workspace info/tree', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', (err) => reject(err));
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const receivedMessages: ServerMessage[] = [];
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as ServerMessage;
        receivedMessages.push(parsed);
      } catch {}
    });

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (
        receivedMessages.some((m) => m.type === 'workspace:info') &&
        receivedMessages.some((m) => m.type === 'workspace:tree')
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(receivedMessages.some((m) => m.type === 'workspace:info')).toBe(true);
    expect(receivedMessages.some((m) => m.type === 'workspace:tree')).toBe(true);

    ws.close();
  });

  it('performs file:save and file:open over WebSocket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    const receivedMessages: ServerMessage[] = [];
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as ServerMessage;
        receivedMessages.push(parsed);
      } catch {}
    });

    const saveMsg: ClientMessage = {
      type: 'file:save',
      payload: { path: 'created_via_ws.txt', content: 'Created by WebSocket Client' },
    };
    ws.send(JSON.stringify(saveMsg));
    
    let fileContent = '';
    const startSave = Date.now();
    while (Date.now() - startSave < 2000) {
      fileContent = await fs.readFile(path.join(tempDir, 'created_via_ws.txt'), 'utf-8').catch(() => '');
      if (fileContent === 'Created by WebSocket Client') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fileContent).toBe('Created by WebSocket Client');

    const openMsg: ClientMessage = {
      type: 'file:open',
      payload: { path: 'created_via_ws.txt' },
    };
    ws.send(JSON.stringify(openMsg));

    const startOpen = Date.now();
    while (Date.now() - startOpen < 2000) {
      if (receivedMessages.some((m) => m.type === 'file:content' && (m.payload as any).path === 'created_via_ws.txt')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    const contentReceived = receivedMessages.find(
      (m) => m.type === 'file:content' && (m.payload as any).path === 'created_via_ws.txt',
    );
    expect(contentReceived).toBeDefined();
    expect((contentReceived?.payload as any).content).toBe('Created by WebSocket Client');

    ws.close();
  });

  it('runs agent task loop over WebSocket with tool execution', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    const receivedMessages: ServerMessage[] = [];
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as ServerMessage;
        receivedMessages.push(parsed);
      } catch {}
    });

    const mockProvider = new MockProvider({
      script: [
        {
          thought: 'WebSocket agent task running.',
          text: 'Starting file generation.',
          toolCalls: [
            {
              id: 'ws_call_1',
              name: 'write_to_file',
              arguments: { path: 'agent_output.txt', content: 'Agent generated content via WS!' },
            },
          ],
        },
        {
          thought: 'Agent task complete.',
          text: 'All tasks completed successfully.',
        },
      ],
    });

    app.engine.startTask('Generate file via WS agent', {
      customProvider: mockProvider,
    });

    const startTask = Date.now();
    while (Date.now() - startTask < 3000) {
      if (receivedMessages.some((m) => m.type === 'task:status' && (m.payload as any).status === 'completed')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(receivedMessages.some((m) => m.type === 'chat:token')).toBe(true);
    expect(receivedMessages.some((m) => m.type === 'chat:thinking')).toBe(true);
    expect(receivedMessages.some((m) => m.type === 'tool:result')).toBe(true);
    expect(
      receivedMessages.some((m) => m.type === 'task:status' && (m.payload as any).status === 'completed'),
    ).toBe(true);

    const agentCreated = await fs.readFile(path.join(tempDir, 'agent_output.txt'), 'utf-8');
    expect(agentCreated).toBe('Agent generated content via WS!');

    ws.close();
  });

  it('prioritizes stored provider API key over client-passed apiKey for built-in providers', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    // Save a valid key in DB for 'cline'
    app.dbService.setApiKey('cline', 'sk_stored_in_db_12345');

    const startTaskSpy = vi.spyOn(app.engine, 'startTask').mockImplementation(async () => {});

    // Client erroneously sends another apiKey (e.g. FreeToken customApiKey)
    const promptMsg: ClientMessage = {
      type: 'user:prompt',
      payload: {
        sessionId: 'sess_provider_test',
        prompt: 'test prompt',
        provider: 'cline',
        apiKey: 'erroneous_client_custom_api_key',
      },
    };
    ws.send(JSON.stringify(promptMsg));

    await new Promise((r) => setTimeout(r, 400));

    expect(startTaskSpy).toHaveBeenCalled();
    const calledOptions = startTaskSpy.mock.calls[0]?.[1];
    expect(calledOptions?.provider).toBe('cline');
    expect(calledOptions?.apiKey).toBe('sk_stored_in_db_12345');

    // For 'custom' provider, client-passed apiKey should be respected
    startTaskSpy.mockClear();
    const customPromptMsg: ClientMessage = {
      type: 'user:prompt',
      payload: {
        sessionId: 'sess_custom_test',
        prompt: 'test custom prompt',
        provider: 'custom',
        apiKey: 'user_provided_custom_key',
      },
    };
    ws.send(JSON.stringify(customPromptMsg));

    await new Promise((r) => setTimeout(r, 400));

    expect(startTaskSpy).toHaveBeenCalled();
    const calledCustomOptions = startTaskSpy.mock.calls[0]?.[1];
    expect(calledCustomOptions?.provider).toBe('custom');
    expect(calledCustomOptions?.apiKey).toBe('user_provided_custom_key');

    startTaskSpy.mockRestore();
    ws.close();
  });
});
