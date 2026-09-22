import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  createApp,
  readRequestBody,
  readJsonBody,
  PayloadTooLargeError,
  DEFAULT_MAX_BODY_SIZE,
} from '../src/server.js';

describe('Request Body Length Limits & DoS / OOM Protection', () => {
  const tempDir = path.resolve('temp_server_test_dos');
  let app: any;
  let port: number;

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    app = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath: path.join(tempDir, 'cline-body-test.db'),
      maxBodySize: 1024, // 1 KB limit
    });
    port = await app.start();
  });

  afterAll(async () => {
    if (app) await app.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('validates default max body size and error class', () => {
    expect(DEFAULT_MAX_BODY_SIZE).toBe(10 * 1024 * 1024);
    const testError = new PayloadTooLargeError();
    expect(testError.statusCode).toBe(413);
    expect(testError.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('readJsonBody rejects when stream data exceeds limit', async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.headers = {};
    let mockReqPaused = false;
    mockReq.pause = () => { mockReqPaused = true; };
    mockReq.resume = () => {};

    const readPromise = readJsonBody(mockReq, { maxBodySize: 50 });
    mockReq.emit('data', Buffer.from('{"key":"' + 'a'.repeat(60) + '"}'));

    await expect(readPromise).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(mockReqPaused).toBe(true);
  });

  it('readRequestBody rejects on oversized stream data', async () => {
    const mockFormReq = new EventEmitter() as any;
    mockFormReq.headers = {};
    let mockFormPaused = false;
    mockFormReq.pause = () => { mockFormPaused = true; };
    mockFormReq.resume = () => {};

    const formPromise = readRequestBody(mockFormReq, { maxBodySize: 30 });
    mockFormReq.emit('data', 'data=' + 'x'.repeat(40));

    await expect(formPromise).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(mockFormPaused).toBe(true);
  });

  it('rejects oversized HTTP payloads with 413 Payload Too Large', async () => {
    const validRes = await fetch(`http://127.0.0.1:${port}/api/db/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'small-folder-1', name: 'Valid Folder' }),
    });
    expect(validRes.status).toBe(200);

    const oversizedPayload = JSON.stringify({
      id: 'huge-folder',
      name: 'Huge',
      data: 'x'.repeat(2048),
    });
    const oversizedRes = await fetch(`http://127.0.0.1:${port}/api/db/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedPayload,
    });
    expect(oversizedRes.status).toBe(413);
    const oversizedJson = (await oversizedRes.json()) as any;
    expect(oversizedJson.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
