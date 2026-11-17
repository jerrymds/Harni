import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createApp } from '../src/server.js';
import type { WorkflowPluginMetadata } from '@harni/types';

describe('Server Plugins REST Endpoints', () => {
  const tempDir = path.resolve('temp_server_test_plugins');
  const dbPath = path.join(tempDir, 'plugins-test.db');
  let app: any;
  let port: number;

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    app = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath,
    });
    port = await app.start();
  });

  afterAll(async () => {
    if (app) await app.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('GET /api/plugins returns all 7 built-in plugins with metadata', async () => {
    const res = await fetch(`http://localhost:${port}/api/plugins`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { plugins: WorkflowPluginMetadata[] };
    expect(Array.isArray(data.plugins)).toBe(true);
    expect(data.plugins.length).toBe(7);

    const ids = data.plugins.map((p) => p.id);
    expect(ids).toContain('harni.git-workspace');
    expect(ids).toContain('harni.rules-skills');
    expect(ids).toContain('harni.experience-learning');
    expect(ids).toContain('harni.tool-guard');
    expect(ids).toContain('harni.syntax-diagnostics');
    expect(ids).toContain('harni.auto-test-repair');
    expect(ids).toContain('harni.rate-limit-diagnostics');

    // Confirm metadata properties
    const diag = data.plugins.find((p) => p.id === 'harni.syntax-diagnostics');
    expect(diag).toBeDefined();
    expect(diag?.enabled).toBe(true);
    expect(diag?.priority).toBe(60);
    expect(diag?.category).toBe('diagnostics');
    expect(diag?.applyToSubagents).toBe(true);
  });

  it('POST /api/plugins/toggle toggles a plugin, persists to DB, and restores in a new app instance', async () => {
    // 1. Toggle harni.syntax-diagnostics to false
    const toggleRes = await fetch(`http://localhost:${port}/api/plugins/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'harni.syntax-diagnostics', enabled: false }),
    });
    expect(toggleRes.ok).toBe(true);
    const toggleData = (await toggleRes.json()) as {
      success: boolean;
      plugins: WorkflowPluginMetadata[];
    };
    expect(toggleData.success).toBe(true);
    const updatedDiag = toggleData.plugins.find((p) => p.id === 'harni.syntax-diagnostics');
    expect(updatedDiag?.enabled).toBe(false);

    // Verify GET /api/plugins also reflects this change
    const getRes = await fetch(`http://localhost:${port}/api/plugins`);
    const getData = (await getRes.json()) as { plugins: WorkflowPluginMetadata[] };
    const fetchedDiag = getData.plugins.find((p) => p.id === 'harni.syntax-diagnostics');
    expect(fetchedDiag?.enabled).toBe(false);

    // 2. Start a second app instance with the same DB to verify restoration
    const app2 = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath,
    });
    const port2 = await app2.start();

    try {
      const restoredRes = await fetch(`http://localhost:${port2}/api/plugins`);
      expect(restoredRes.ok).toBe(true);
      const restoredData = (await restoredRes.json()) as { plugins: WorkflowPluginMetadata[] };
      const restoredDiag = restoredData.plugins.find((p) => p.id === 'harni.syntax-diagnostics');
      expect(restoredDiag?.enabled).toBe(false);
    } finally {
      await app2.stop();
    }
  });

  it('POST /api/plugins/toggle returns 400 for invalid body', async () => {
    // Missing enabled
    const res1 = await fetch(`http://localhost:${port}/api/plugins/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'harni.syntax-diagnostics' }),
    });
    expect(res1.status).toBe(400);

    // Empty id
    const res2 = await fetch(`http://localhost:${port}/api/plugins/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '', enabled: true }),
    });
    expect(res2.status).toBe(400);

    // Non-boolean enabled
    const res3 = await fetch(`http://localhost:${port}/api/plugins/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'harni.syntax-diagnostics', enabled: 'yes' }),
    });
    expect(res3.status).toBe(400);
  });

  it('POST /api/plugins/toggle returns 404 for unknown plugin id', async () => {
    const res = await fetch(`http://localhost:${port}/api/plugins/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'nonexistent.plugin', enabled: false }),
    });
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('nonexistent.plugin');
  });
});
