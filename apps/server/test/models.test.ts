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

  it('ANTIGRAVITY_OFFICIAL_MODELS includes gemini-3.8-flash, gemini-3.8-pro and ACP models', () => {
    const ids = ANTIGRAVITY_OFFICIAL_MODELS.map((m) => m.id);
    expect(ids).toContain('gemini-3.8-flash');
    expect(ids).toContain('gemini-3.8-pro');
    expect(ids).toContain('claude-sonnet-5-5:acp');
    expect(ids).toContain('claude-opus-5-5:acp');
    expect(ids).toContain('gpt-oss-120b-medium:acp');
    expect(ids).not.toContain('gemini-3.7-flash');
    expect(ids).not.toContain('gemini-2.5-flash');
    expect(ids).not.toContain('gemini-3.8-flash:acp');
  });

  it('ModelService.fetchModels returns gemini-3.8-flash and ACP models for antigravity provider', async () => {
    const models = await ModelService.fetchModels({ provider: 'antigravity' });
    expect(models.length).toBeGreaterThanOrEqual(5);
    const modelIds = models.map((m) => m.id);
    expect(modelIds).toContain('gemini-3.8-flash');
    expect(modelIds).toContain('gemini-3.8-pro');
    expect(modelIds).toContain('claude-sonnet-5-5:acp');
    expect(modelIds).toContain('claude-opus-5-5:acp');
    expect(modelIds).toContain('gpt-oss-120b-medium:acp');
    expect(modelIds).not.toContain('gemini-3.7-flash');
    expect(modelIds).not.toContain('gemini-2.5-flash');
  });

  it('GET /api/models?provider=antigravity serves updated models list with gemini-3.8 and ACP models', async () => {
    const res = await fetch(`http://localhost:${port}/api/models?provider=antigravity`);
    expect(res.ok).toBe(true);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.models)).toBe(true);
    const ids = json.models.map((m: any) => m.id);
    expect(ids).toContain('gemini-3.8-flash');
    expect(ids).toContain('gemini-3.8-pro');
    expect(ids).toContain('claude-sonnet-5-5:acp');
    expect(ids).toContain('claude-opus-5-5:acp');
    expect(ids).toContain('gpt-oss-120b-medium:acp');
    expect(ids).not.toContain('gemini-3.7-flash');
    expect(ids).not.toContain('gemini-2.5-flash');
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

  it('ModelService.fetchModels normalizes Antigravity bridge models and strips thinking level annotations and badges', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/models')) {
          return {
            ok: true,
            json: async () => ({
              models: [
                { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
                { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
                { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium) (Antigravity)' },
                { id: 'claude-opus-5-5-high', name: 'Claude Opus 5.5 (High)' },
                { id: 'claude-sonnet-5-5-low', name: 'Claude Sonnet 5.5 (Low) (Antigravity)' },
                { id: 'gpt-oss-120b-medium-high', name: 'GPT-OSS 120B (High) (ACP Mode)' },
              ],
            }),
          };
        }
        return originalFetch(url);
      }) as any;

      const models = await ModelService.fetchModels({ provider: 'antigravity' });

      // 1. 絕無任何包含 -low、-high，或思考等級 -medium 的 ID (除 gpt-oss-120b-medium 外)
      const idsWithoutGptOss = models.map((m) => m.id).filter((id) => !id.startsWith('gpt-oss-120b-medium'));
      for (const id of idsWithoutGptOss) {
        expect(id).not.toContain('-low');
        expect(id).not.toContain('-medium');
        expect(id).not.toContain('-high');
      }

      // 2. 絕無任何名稱包含 (Low)、(Medium)、(High)、(Antigravity) 的項目
      for (const m of models) {
        expect(m.name).not.toContain('(Low)');
        expect(m.name).not.toContain('(Medium)');
        expect(m.name).not.toContain('(High)');
        expect(m.name).not.toContain('(Antigravity)');
      }

      // 3. 不重複存在多個 gemini-3.8-flash
      const flashModels = models.filter((m) => m.id === 'gemini-3.8-flash');
      expect(flashModels.length).toBe(1);

      // 4. 新模型 gemini-4-argon 僅保留一筆純淨的模型
      const argonModels = models.filter((m) => m.id === 'gemini-4-argon');
      expect(argonModels.length).toBe(1);
      expect(argonModels[0].name).toBe('Gemini 4 Argon');

      // 5. 官方 ACP 模型直接採用官方定義
      const opusModels = models.filter((m) => m.id === 'claude-opus-5-5:acp');
      expect(opusModels.length).toBe(1);
      expect(opusModels[0].name).toBe('Claude 3.5 Opus (ACP)');

      const sonnetModels = models.filter((m) => m.id === 'claude-sonnet-5-5:acp');
      expect(sonnetModels.length).toBe(1);
      expect(sonnetModels[0].name).toBe('Claude 3.5 Sonnet (ACP)');

      const gptOssModels = models.filter((m) => m.id === 'gpt-oss-120b-medium:acp');
      expect(gptOssModels.length).toBe(1);
      expect(gptOssModels[0].name).toBe('GPT-OSS 120B (ACP)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
