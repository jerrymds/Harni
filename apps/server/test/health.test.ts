import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createApp } from '../src/server.js';

describe('Server Health & Workspace HTTP Endpoints', () => {
  const tempDir = path.resolve('temp_server_test_health');
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
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('GET /health returns status ok', async () => {
    const healthRes = await fetch(`http://localhost:${port}/health`);
    const healthJson = (await healthRes.json()) as any;
    expect(healthRes.ok).toBe(true);
    expect(healthJson.status).toBe('ok');
  });

  it('GET /api/workspace returns workspace files', async () => {
    const wsRes = await fetch(`http://localhost:${port}/api/workspace`);
    const wsJson = (await wsRes.json()) as any;
    expect(wsRes.ok).toBe(true);
    expect(wsJson.totalFiles).toBeGreaterThanOrEqual(1);
  });
});
