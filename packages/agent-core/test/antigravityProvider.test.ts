import { describe, it, expect, vi, afterEach } from 'vitest';
import { AntigravityProvider } from '../src/providers/antigravityProvider.js';

/**
 * 建立一個「永遠不回應」的 SSE stream，模擬 Bridge 卡住的情況。
 * reader.read() 會一直 pending，直到被 cancel 或 timeout 觸發。
 */
function createStalledStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // 故意不 push 任何資料，也不 close —— 模擬 Bridge 卡住
      // 保留 controller 引用以便測試中可主動關閉
      (controller as any).__stalled = true;
    },
    cancel() {
      // 允許被 reader.cancel() 取消
    },
  });
}

/** 建立一個正常回應的 SSE stream（發送 token 後結束） */
function createNormalStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"token","content":"hello"}\n\n'));
      controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
      controller.close();
    },
  });
}

describe('AntigravityProvider idle timeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS;
  });

  it('正常串流不受影響（收到 token 並完成）', async () => {
    const provider = new AntigravityProvider({ baseURL: 'http://127.0.0.1:8123' });

    // Mock global fetch 回傳正常 stream
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: createNormalStream(),
      } as unknown as Response),
    );

    const chunks: any[] = [];
    const result = await provider.streamCompletion([], 'sys', [], (chunk) => chunks.push(chunk));

    expect(result.text).toBe('hello');
    expect(chunks.some((c) => c.type === 'token')).toBe(true);
  });

  it('Bridge 卡住時，超過 idle timeout 會拋出明確錯誤', async () => {
    // 用極短的 timeout (50ms) 加速測試
    process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS = '50';
    const provider = new AntigravityProvider({ baseURL: 'http://127.0.0.1:8123' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: createStalledStream(),
      } as unknown as Response),
    );

    await expect(provider.streamCompletion([], 'sys', [], () => {})).rejects.toThrow(
      /Antigravity Bridge 串流逾時/,
    );
  });

  it('環境變數未設定時使用預設 90 秒', () => {
    const provider = new AntigravityProvider({ baseURL: 'http://127.0.0.1:8123' });
    expect((provider as any).idleTimeoutMs).toBe(90_000);
  });

  it('環境變數可覆寫 idle timeout', () => {
    process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS = '5000';
    const provider = new AntigravityProvider({ baseURL: 'http://127.0.0.1:8123' });
    expect((provider as any).idleTimeoutMs).toBe(5000);
  });

  it('無效的環境變數值會回退到預設', () => {
    process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS = 'abc';
    const provider = new AntigravityProvider({ baseURL: 'http://127.0.0.1:8123' });
    expect((provider as any).idleTimeoutMs).toBe(90_000);
  });
});
