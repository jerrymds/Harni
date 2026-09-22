import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createApp } from '../src/server.js';
import { ModelService, ANTIGRAVITY_OFFICIAL_MODELS } from '../src/services/modelService.js';

describe('ModelService & /api/models API Endpoint', () => {
  const tempDir = path.resolve('temp_server_test_models');
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
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('ANTIGRAVITY_OFFICIAL_MODELS includes gemini-3.8-flash and gemini-3.8-pro', () => {
    const ids = ANTIGRAVITY_OFFICIAL_MODELS.map((m) => m.id);
    expect(ids).toContain('gemini-3.8-flash');
    expect(ids).toContain('gemini-3.8-pro');
    expect(ids).toContain('gemini-3.7-flash');
    expect(ids).toContain('gemini-3.7-pro');
  });

  it('ModelService.fetchModels returns gemini-3.8-flash for antigravity provider', async () => {
    const models = await ModelService.fetchModels({ provider: 'antigravity' });
    expect(models.length).toBeGreaterThanOrEqual(6);
    const modelIds = models.map((m) => m.id);
    expect(modelIds).toContain('gemini-3.8-flash');
    expect(modelIds).toContain('gemini-3.8-pro');
  });

  it('GET /api/models?provider=antigravity serves updated models list with gemini-3.8', async () => {
    const res = await fetch(`http://localhost:${port}/api/models?provider=antigravity`);
    expect(res.ok).toBe(true);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.models)).toBe(true);
    const ids = json.models.map((m: any) => m.id);
    expect(ids).toContain('gemini-3.8-flash');
    expect(ids).toContain('gemini-3.8-pro');
  });

  it('ModelService.fetchModels for cline provider includes cline-pass/ and deepseek/ models and filters out other models', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'deepseek/deepseek-v4.1-flash' },
            { id: 'cline-pass/custom-model' },
            { id: 'openai/gpt-4o' },
            { id: 'anthropic/claude-3-5-sonnet' },
          ],
        }),
      }) as any;

      const models = await ModelService.fetchModels({ provider: 'cline' });
      const ids = models.map((m) => m.id);

      expect(ids).toContain('deepseek/deepseek-v4.1-flash');
      expect(ids).toContain('cline-pass/custom-model');
      expect(ids).toContain('cline-pass/deepseek-v4-pro');
      expect(ids).not.toContain('openai/gpt-4o');
      expect(ids).not.toContain('anthropic/claude-3-5-sonnet');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
