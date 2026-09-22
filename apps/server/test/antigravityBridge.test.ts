import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AntigravityBridgeManager } from '../src/services/antigravityBridgeManager.js';

describe('Antigravity External Bridge Client', () => {
  let manager: AntigravityBridgeManager;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (AntigravityBridgeManager as any).instance = null;
    manager = AntigravityBridgeManager.getInstance();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses default baseURL or ANTIGRAVITY_BRIDGE_URL env var', () => {
    expect(manager.getBaseURL()).toBe('http://127.0.0.1:8123');
    manager.setBaseURL('http://192.168.1.100:9000/');
    expect(manager.getBaseURL()).toBe('http://192.168.1.100:9000');
  });

  it('checkHealth returns true when bridge responds ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });

    const isHealthy = await manager.checkHealth();
    expect(isHealthy).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8123/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('checkHealth returns false when fetch rejects or is not ok', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await manager.checkHealth()).toBe(false);

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    expect(await manager.checkHealth()).toBe(false);
  });

  it('ensureRunning succeeds when healthy and returns false with lastError when offline', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    const healthy = await manager.ensureRunning();
    expect(healthy).toBe(true);
    expect(manager.getLastError()).toBeNull();

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const failed = await manager.ensureRunning();
    expect(failed).toBe(false);
    expect(manager.getLastError()).toContain('無法連接外部 Antigravity Bridge');
  });
});

