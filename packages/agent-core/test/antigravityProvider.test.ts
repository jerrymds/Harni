import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AntigravityProvider, composeAntigravityModel } from '../src/providers/antigravityProvider.js';
import { AgentCoreEngine, MockProvider } from '../src/index.js';

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

  it('正確解析帶有後續文字大括號與多重工具呼叫的文字格式 tool call', () => {
    const textWithTrailingBraces =
      'Calling tool `replace_file_content` with arguments: {"path": "src/index.ts", "content": "export function main() { return { ok: true }; }"}\n' +
      '已完成修改 `export function main() { return { ok: true }; }`。';

    const single = AntigravityProvider.extractTextToolCalls(textWithTrailingBraces);
    expect(single.length).toBe(1);
    expect(single[0].name).toBe('edit_file');
    expect(single[0].arguments).toEqual({
      path: 'src/index.ts',
      content: 'export function main() { return { ok: true }; }',
    });

    const multiCallsText =
      'Calling tool `read_file` with arguments: {"path": "package.json"}\n' +
      'Calling tool `read_file` with arguments: {"path": "tsconfig.json"}\n';

    const multi = AntigravityProvider.extractTextToolCalls(multiCallsText);
    expect(multi.length).toBe(2);
    expect(multi[0].arguments).toEqual({ path: 'package.json' });
    expect(multi[1].arguments).toEqual({ path: 'tsconfig.json' });
  });

  it('streamCompletion 發送的 payload 包含動態組裝的思考等級模型名稱', async () => {
    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'gemini-3.8-pro',
      thinkingDepth: 'high',
    });

    let capturedOptions: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return {
          ok: true,
          body: createNormalStream(),
        } as unknown as Response;
      }),
    );

    await provider.streamCompletion([], 'system prompt', [], () => {});

    expect(capturedOptions).toBeDefined();
    const body = JSON.parse(capturedOptions.body);
    expect(body.model).toBe('gemini-3.8-pro-high');
    expect(body.thinkingDepth).toBe('high');
  });

  it('streamCompletion 發送 ACP 模型時正確保留 :acp 後綴並組裝思考等級', async () => {
    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'claude-sonnet-5-5:acp',
      thinkingDepth: 'low',
    });

    let capturedOptions: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return {
          ok: true,
          body: createNormalStream(),
        } as unknown as Response;
      }),
    );

    await provider.streamCompletion([], 'system prompt', [], () => {});

    expect(capturedOptions).toBeDefined();
    const body = JSON.parse(capturedOptions.body);
    expect(body.model).toBe('claude-sonnet-5-5-low:acp');
  });
});

describe('composeAntigravityModel', () => {
  it('當 model 為空時，預設回傳 gemini-3.8-flash-medium', () => {
    expect(composeAntigravityModel('')).toBe('gemini-3.8-flash-medium');
    expect(composeAntigravityModel('   ')).toBe('gemini-3.8-flash-medium');
    expect(composeAntigravityModel(undefined)).toBe('gemini-3.8-flash-medium');
  });

  it('正確將標準模型與思考等級組裝', () => {
    expect(composeAntigravityModel('gemini-3.8-flash', 'low')).toBe('gemini-3.8-flash-low');
    expect(composeAntigravityModel('gemini-3.8-flash', 'medium')).toBe('gemini-3.8-flash-medium');
    expect(composeAntigravityModel('gemini-3.8-flash', 'high')).toBe('gemini-3.8-flash-high');
    expect(composeAntigravityModel('gemini-3.8-flash', 'ultra')).toBe('gemini-3.8-flash-high');
    expect(composeAntigravityModel('gemini-3.8-flash', 'off')).toBe('gemini-3.8-flash-medium');
    expect(composeAntigravityModel('gemini-3.8-flash', undefined)).toBe('gemini-3.8-flash-medium');
    expect(composeAntigravityModel('gemini-3.8-pro', 'high')).toBe('gemini-3.8-pro-high');
  });

  it('正確處理帶有 :acp 後綴的模型，並將 :acp 補回在尾端', () => {
    expect(composeAntigravityModel('claude-sonnet-5-5:acp', 'high')).toBe('claude-sonnet-5-5-high:acp');
    expect(composeAntigravityModel('claude-sonnet-5-5:acp', 'low')).toBe('claude-sonnet-5-5-low:acp');
    expect(composeAntigravityModel('claude-sonnet-5-5:acp', 'ultra')).toBe('claude-sonnet-5-5-high:acp');
    expect(composeAntigravityModel('claude-sonnet-5-5:acp', 'off')).toBe('claude-sonnet-5-5-medium:acp');
    expect(composeAntigravityModel('claude-sonnet-5-5:acp', 'medium')).toBe('claude-sonnet-5-5-medium:acp');
    expect(composeAntigravityModel('claude-opus-5-5:acp', 'high')).toBe('claude-opus-5-5-high:acp');
  });

  it('若模型已包含 -(low|medium|high)，維持原名稱不重複加後綴', () => {
    expect(composeAntigravityModel('gemini-3.8-flash-low', 'high')).toBe('gemini-3.8-flash-low');
    expect(composeAntigravityModel('gemini-3.8-flash-medium', 'high')).toBe('gemini-3.8-flash-medium');
    expect(composeAntigravityModel('gemini-3.8-flash-high', 'low')).toBe('gemini-3.8-flash-high');
    expect(composeAntigravityModel('claude-sonnet-5-5-high:acp', 'low')).toBe('claude-sonnet-5-5-high:acp');
    expect(composeAntigravityModel('claude-sonnet-5-5-medium:acp', 'high')).toBe('claude-sonnet-5-5-medium:acp');
  });

  it('gpt-oss-120b-medium 或其 :acp 模式維持原名稱', () => {
    expect(composeAntigravityModel('gpt-oss-120b-medium', 'high')).toBe('gpt-oss-120b-medium');
    expect(composeAntigravityModel('gpt-oss-120b-medium', 'low')).toBe('gpt-oss-120b-medium');
    expect(composeAntigravityModel('gpt-oss-120b-medium:acp', 'high')).toBe('gpt-oss-120b-medium:acp');
    expect(composeAntigravityModel('gpt-oss-120b-medium:acp', 'low')).toBe('gpt-oss-120b-medium:acp');
  });
});

describe('AntigravityProvider ACP and tool settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS;
  });

  it('Direct 模式傳遞 disable_builtin_tools: true, allow_tools: false, agy_mode: direct', async () => {
    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'gemini-3.8-flash',
      antigravityMode: 'direct',
    });

    let capturedOptions: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return {
          ok: true,
          body: createNormalStream(),
        } as unknown as Response;
      }),
    );

    await provider.streamCompletion([], 'system prompt', [], () => {});

    expect(capturedOptions).toBeDefined();
    const body = JSON.parse(capturedOptions.body);
    expect(body.authData.agy_mode).toBe('direct');
    expect(body.authData.disable_builtin_tools).toBe(true);
    expect(body.authData.allow_tools).toBe(false);
  });

  it('ACP 模型 (:acp) 傳遞 disable_builtin_tools: false, allow_tools: true, dangerously_skip_permissions: true', async () => {
    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'claude-sonnet-5-5:acp',
    });

    let capturedOptions: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return {
          ok: true,
          body: createNormalStream(),
        } as unknown as Response;
      }),
    );

    await provider.streamCompletion([], 'system prompt', [], () => {});

    expect(capturedOptions).toBeDefined();
    const body = JSON.parse(capturedOptions.body);
    expect(body.authData.agy_mode).toBe('acp');
    expect(body.authData.disable_builtin_tools).toBe(false);
    expect(body.authData.allow_tools).toBe(true);
    expect(body.authData.dangerously_skip_permissions).toBe(true);
    expect(body.authData.interactive_permissions).toBe(false);
  });

  it('authData 中包含 agy_mode: "acp" 時亦判斷為 ACP 模式', async () => {
    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'gemini-3.8-flash',
      authData: { agy_mode: 'acp' },
    });

    let capturedOptions: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return {
          ok: true,
          body: createNormalStream(),
        } as unknown as Response;
      }),
    );

    await provider.streamCompletion([], 'system prompt', [], () => {});

    expect(capturedOptions).toBeDefined();
    const body = JSON.parse(capturedOptions.body);
    expect(body.authData.agy_mode).toBe('acp');
    expect(body.authData.disable_builtin_tools).toBe(false);
    expect(body.authData.allow_tools).toBe(true);
    expect(body.authData.dangerously_skip_permissions).toBe(true);
    expect(body.authData.interactive_permissions).toBe(false);
  });

  it('外部明確指定的 authData 設定能優先覆蓋預設值', async () => {
    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'claude-sonnet-5-5:acp',
      authData: {
        disable_builtin_tools: true,
        allow_tools: false,
        dangerously_skip_permissions: false,
      },
    });

    let capturedOptions: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return {
          ok: true,
          body: createNormalStream(),
        } as unknown as Response;
      }),
    );

    await provider.streamCompletion([], 'system prompt', [], () => {});

    expect(capturedOptions).toBeDefined();
    const body = JSON.parse(capturedOptions.body);
    expect(body.authData.disable_builtin_tools).toBe(true);
    expect(body.authData.allow_tools).toBe(false);
    expect(body.authData.dangerously_skip_permissions).toBe(false);
  });
});

describe('AntigravityProvider Mode B: Interactive Permission Approval', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createPermissionStream(permId = 'perm_123', toolCallId = 'call_abc'): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'permission_request',
              permissionId: permId,
              toolCallId,
              name: 'execute_command',
              arguments: { command: 'git status' },
              title: 'Run Git Status',
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"token","content":"command output"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
        controller.close();
      },
    });
  }

  it('當 Bridge SSE 發送 permission_request 時，觸發 requestApproval 並透過 POST /api/permission_response 回傳 allow 決定', async () => {
    const requestedApprovals: any[] = [];
    const postedResponses: { url: string; body: any }[] = [];

    const requestApproval = vi.fn().mockImplementation(async (req) => {
      requestedApprovals.push(req);
      return { approved: true, feedback: 'approved by user' };
    });

    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'claude-sonnet-5-5:acp',
      requestApproval,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, options: any) => {
        if (url.endsWith('/api/chat')) {
          return {
            ok: true,
            body: createPermissionStream('perm_xyz', 'call_123'),
          } as unknown as Response;
        }
        if (url.endsWith('/api/permission_response')) {
          postedResponses.push({ url, body: JSON.parse(options.body) });
          return {
            ok: true,
            json: async () => ({ status: 'ok', permissionId: 'perm_xyz' }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected url: ${url}`);
      }),
    );

    const tokens: string[] = [];
    const result = await provider.streamCompletion([], 'sys', [], (chunk) => {
      if (chunk.type === 'token') tokens.push(chunk.content);
    });

    // 驗證 requestApproval 被正確呼叫
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestedApprovals[0]).toEqual({
      toolCallId: 'call_123',
      name: 'execute_command',
      arguments: { command: 'git status' },
      title: 'Run Git Status',
    });

    // 驗證 POST /api/permission_response 發送了正確的批准內容
    expect(postedResponses.length).toBe(1);
    expect(postedResponses[0].url).toBe('http://127.0.0.1:8123/api/permission_response');
    expect(postedResponses[0].body).toEqual({
      permissionId: 'perm_xyz',
      approved: true,
      optionId: 'allow',
      feedback: 'approved by user',
    });

    expect(result.text).toBe('command output');
  });

  it('當 requestApproval 拒絕時，透過 POST /api/permission_response 回傳 deny 決定', async () => {
    const postedResponses: { url: string; body: any }[] = [];

    const requestApproval = vi.fn().mockResolvedValue({
      approved: false,
      feedback: 'command too dangerous',
    });

    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'claude-sonnet-5-5:acp',
      requestApproval,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, options: any) => {
        if (url.endsWith('/api/chat')) {
          return {
            ok: true,
            body: createPermissionStream('perm_deny', 'call_deny'),
          } as unknown as Response;
        }
        if (url.endsWith('/api/permission_response')) {
          postedResponses.push({ url, body: JSON.parse(options.body) });
          return {
            ok: true,
            json: async () => ({ status: 'ok', permissionId: 'perm_deny' }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected url: ${url}`);
      }),
    );

    await provider.streamCompletion([], 'sys', [], () => {});

    expect(postedResponses.length).toBe(1);
    expect(postedResponses[0].body).toEqual({
      permissionId: 'perm_deny',
      approved: false,
      optionId: 'deny',
      feedback: 'command too dangerous',
    });
  });

  it('若未提供 requestApproval，預設透過 POST /api/permission_response 回傳 deny', async () => {
    const postedResponses: { url: string; body: any }[] = [];

    // 沒有提供 requestApproval
    const provider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'claude-sonnet-5-5:acp',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, options: any) => {
        if (url.endsWith('/api/chat')) {
          return {
            ok: true,
            body: createPermissionStream('perm_no_handler', 'call_no_handler'),
          } as unknown as Response;
        }
        if (url.endsWith('/api/permission_response')) {
          postedResponses.push({ url, body: JSON.parse(options.body) });
          return {
            ok: true,
            json: async () => ({ status: 'ok', permissionId: 'perm_no_handler' }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected url: ${url}`);
      }),
    );

    await provider.streamCompletion([], 'sys', [], () => {});

    expect(postedResponses.length).toBe(1);
    expect(postedResponses[0].body).toEqual({
      permissionId: 'perm_no_handler',
      approved: false,
      optionId: 'deny',
    });
  });

  describe('Antigravity execution mode and tool settings resolution', () => {
    it('gemini-3.8-flash 預設使用 ACP 模式並配置 dangerously_skip_permissions', async () => {
      const provider = new AntigravityProvider({
        baseURL: 'http://127.0.0.1:8123',
        model: 'gemini-3.8-flash',
      });

      let capturedPayload: any = null;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (_url: string, options: any) => {
          capturedPayload = JSON.parse(options.body);
          return {
            ok: true,
            body: createNormalStream(),
          } as unknown as Response;
        }),
      );

      await provider.streamCompletion([], 'sys', [], () => {});

      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.authData.agy_mode).toBe('acp');
      expect(capturedPayload.authData.disable_builtin_tools).toBe(false);
      expect(capturedPayload.authData.allow_tools).toBe(true);
      expect(capturedPayload.authData.dangerously_skip_permissions).toBe(true);
      expect(capturedPayload.authData.interactive_permissions).toBe(false);
    });

    it('gemini-3.8-flash 在 antigravityMode: direct 時切換為 Direct 模式', async () => {
      const provider = new AntigravityProvider({
        baseURL: 'http://127.0.0.1:8123',
        model: 'gemini-3.8-flash',
        antigravityMode: 'direct',
      });

      let capturedPayload: any = null;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (_url: string, options: any) => {
          capturedPayload = JSON.parse(options.body);
          return {
            ok: true,
            body: createNormalStream(),
          } as unknown as Response;
        }),
      );

      await provider.streamCompletion([], 'sys', [], () => {});

      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.authData.agy_mode).toBe('direct');
      expect(capturedPayload.authData.disable_builtin_tools).toBe(true);
      expect(capturedPayload.authData.allow_tools).toBe(false);
    });

    it('帶有 :acp 後綴的模型（如 claude-sonnet-4-6:acp）強制使用 ACP 模式，即使 antigravityMode 為 direct', async () => {
      const provider = new AntigravityProvider({
        baseURL: 'http://127.0.0.1:8123',
        model: 'claude-sonnet-4-6:acp',
        antigravityMode: 'direct',
      });

      let capturedPayload: any = null;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (_url: string, options: any) => {
          capturedPayload = JSON.parse(options.body);
          return {
            ok: true,
            body: createNormalStream(),
          } as unknown as Response;
        }),
      );

      await provider.streamCompletion([], 'sys', [], () => {});

      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.authData.agy_mode).toBe('acp');
      expect(capturedPayload.authData.disable_builtin_tools).toBe(false);
      expect(capturedPayload.authData.allow_tools).toBe(true);
      expect(capturedPayload.authData.dangerously_skip_permissions).toBe(true);
    });
  });

  describe('AntigravityProvider.sanitizeMalformedJson', () => {
    it('正確轉義字串字面量內的未轉義控制字元（如原始換行）', () => {
      const raw = '{"content": "line1\nline2\rline3\tline4"}';
      const sanitized = AntigravityProvider.sanitizeMalformedJson(raw);
      expect(() => JSON.parse(raw)).toThrow();
      expect(() => JSON.parse(sanitized)).not.toThrow();
      const parsed = JSON.parse(sanitized);
      expect(parsed.content).toBe('line1\nline2\rline3\tline4');
    });

    it('正確修正無效的 JSON 反斜線跳脫字元（\\`、\\s、\\S、\\\'、\\d）', () => {
      const raw = '{"regex": "\\s+\\S*\\d+", "quote": "\\\'", "template": "\\`hello\\`"}';
      const sanitized = AntigravityProvider.sanitizeMalformedJson(raw);
      expect(() => JSON.parse(raw)).toThrow();
      const parsed = JSON.parse(sanitized);
      expect(parsed.regex).toBe('\\s+\\S*\\d+');
      expect(parsed.quote).toBe("\\'");
      expect(parsed.template).toBe('\\`hello\\`');
    });

    it('保留標準有效的 JSON 跳脫字元（\\"、\\\\、\\/、\\b、\\f、\\n、\\r、\\t、\\u1234）', () => {
      const raw = '{"valid": "\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041"}';
      const sanitized = AntigravityProvider.sanitizeMalformedJson(raw);
      const parsed = JSON.parse(sanitized);
      expect(parsed.valid).toBe('"\\/\b\f\n\r\tA');
    });
  });

  describe('extractTextToolCalls with malformed JSON and code blocks', () => {
    it('正確解析包含原始換行與 \\`、\\s 的多行 TypeScript 程式碼工具呼叫', () => {
      const text =
        'Calling tool `write_to_file` with arguments: {\n' +
        '  "path": "src/utils.ts",\n' +
        '  "content": "export function parse(str: string): string {\n' +
        '    const pattern = /\\s+/g;\n' +
        '    return \\`result: ${str}\\`;\n' +
        '  }"\n' +
        '}\n' +
        '檔案寫入已準備完成。';

      const calls = AntigravityProvider.extractTextToolCalls(text);
      expect(calls.length).toBe(1);
      expect(calls[0].name).toBe('write_file');
      expect(calls[0].arguments.path).toBe('src/utils.ts');
      expect(typeof calls[0].arguments.content).toBe('string');
      expect((calls[0].arguments.content as string)).toContain('export function parse');
    });

    it('正確處理在尾端截斷的未閉合工具呼叫', () => {
      const text =
        'Calling tool `execute_command` with arguments: {"command": "npm run build';
      const calls = AntigravityProvider.extractTextToolCalls(text);
      expect(calls.length).toBe(1);
      expect(calls[0].name).toBe('run_command');
      expect(calls[0].arguments.command).toBe('npm run build');
    });
  });
});

describe('AntigravityProvider.extractIncompleteAcpTools', () => {
  it('正確追蹤 in_progress、completed、failed、cancelled、auto_resumed 與 generic tool fallback pop', () => {
    expect(AntigravityProvider.extractIncompleteAcpTools(undefined)).toEqual([]);
    expect(AntigravityProvider.extractIncompleteAcpTools('')).toEqual([]);

    // in_progress 未結束會保留
    const inProgressOnly =
      '[ACP Tool in_progress: dotnet build]\n[ACP Tool running: npm test]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(inProgressOnly)).toEqual([
      'dotnet build',
      'npm test',
    ]);

    // completed / failed / cancelled 會清除對應工具
    const resolved =
      '[ACP Tool in_progress: dotnet build]\n' +
      '[ACP Tool pending: lint]\n' +
      '[ACP Tool running: unit test]\n' +
      '[ACP Tool completed: dotnet build]\n' +
      '[ACP Tool failed: lint]\n' +
      '[ACP Tool cancelled: unit test]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(resolved)).toEqual([]);

    // auto_resumed 支援逗號分隔清除多個工具
    const autoResumed =
      '[ACP Tool in_progress: build_a]\n' +
      '[ACP Tool in_progress: build_b]\n' +
      '[ACP Tool in_progress: build_c]\n' +
      '[ACP Tool auto_resumed: build_a, build_b]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(autoResumed)).toEqual(['build_c']);

    // 若無精確標題匹配（如 generic tool），則 pop 最後一個 active tool
    const fallbackPop =
      '[ACP Tool in_progress: dotnet build]\n' +
      '[ACP Tool completed: tool]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(fallbackPop)).toEqual([]);

    // File 相對路徑與絕對路徑可透過路徑後綴匹配清除，不影響併行執行中的 dotnet build
    const pathSuffixResolved =
      '[ACP Tool in_progress: dotnet build]\n' +
      '[ACP Tool in_progress: File TibAgentApi/Controllers/StoreController.cs]\n' +
      '[ACP Tool completed: File /D:/Work/Project/Tibtrade/OMMS/TibAgentApi/Controllers/StoreController.cs]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(pathSuffixResolved)).toEqual([
      'dotnet build',
    ]);

    // 未識別的具名完成事件不會誤 pop 執行中的工具
    const unrelatedCompletion =
      '[ACP Tool in_progress: dotnet build]\n' +
      '[ACP Tool completed: unrelated_tool]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(unrelatedCompletion)).toEqual([
      'dotnet build',
    ]);
  });
});

describe('AntigravityProvider ACP_SYNC_EXECUTION_RULE injection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ACP 模式注入 [ACP_SYNC_EXECUTION_RULE] 且不重複注入；Direct 模式不注入', async () => {
    const capturedPrompts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, options: any) => {
        const parsed = JSON.parse(options.body);
        capturedPrompts.push(parsed.systemPrompt);
        return {
          ok: true,
          body: createNormalStream(),
        } as unknown as Response;
      }),
    );

    // 1. ACP 模式正常注入
    const acpProvider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'claude-sonnet-5-5:acp',
    });
    await acpProvider.streamCompletion([], 'base system prompt', [], () => {});
    expect(capturedPrompts[0]).toContain('[ACP_SYNC_EXECUTION_RULE]');
    expect(capturedPrompts[0]).toContain('WaitMsBeforeAsync');

    // 2. 已包含規則時不重複注入
    await acpProvider.streamCompletion(
      [],
      'base system prompt [ACP_SYNC_EXECUTION_RULE] existing',
      [],
      () => {},
    );
    expect(capturedPrompts[1].match(/\[ACP_SYNC_EXECUTION_RULE\]/g)?.length).toBe(1);

    // 3. Direct 模式不注入
    const directProvider = new AntigravityProvider({
      baseURL: 'http://127.0.0.1:8123',
      model: 'gemini-3.8-flash',
      antigravityMode: 'direct',
    });
    await directProvider.streamCompletion([], 'base system prompt', [], () => {});
    expect(capturedPrompts[2]).toBe('base system prompt');
  });
});

describe('AgentCoreEngine ACP incomplete tool auto-continuation', () => {
  it('當 thinking 留下 [ACP Tool in_progress: ...] 且 toolCalls 為空時自動續接，最多重試 3 次', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-acp-cont-'));
    try {
      // Case 1: 第 1 回合留下 in_progress，第 2 回合完成
      const engine1 = new AgentCoreEngine({ workspaceRoot: tmpWorkspace });
      const mock1 = new MockProvider({
        script: [
          {
            thought: '[ACP Tool in_progress: dotnet build]\n',
            text: 'Build started, waiting...',
          },
          {
            thought: '[ACP Tool completed: dotnet build]\n',
            text: 'Build finished and edits done.',
          },
        ],
      });
      const capturedMessages1: any[] = [];
      const origStream1 = mock1.streamCompletion.bind(mock1);
      mock1.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        capturedMessages1.push(messages.map((m) => ({ role: m.role, content: m.content })));
        return origStream1(messages, systemPrompt, tools, onChunk, signal);
      };

      await engine1.startTask('Run build and finish', {
        customProvider: mock1,
        subagentsEnabled: false,
      });

      expect(capturedMessages1.length).toBe(2);
      const lastMsgTurn2 = capturedMessages1[1][capturedMessages1[1].length - 1];
      expect(lastMsgTurn2.role).toBe('user');
      expect(lastMsgTurn2.content).toContain('[SYSTEM_NOTIFICATION]');
      expect(lastMsgTurn2.content).toContain('dotnet build');

      // Case 2: 持續處於 in_progress，最多自動續接 3 次（總計 4 次呼叫：1 次初始 + 3 次重試）
      const engine2 = new AgentCoreEngine({ workspaceRoot: tmpWorkspace });
      const mock2 = new MockProvider({
        script: [
          { thought: '[ACP Tool in_progress: stuck_cmd]\n', text: 'Attempt 1' },
          { thought: '[ACP Tool in_progress: stuck_cmd]\n', text: 'Attempt 2' },
          { thought: '[ACP Tool in_progress: stuck_cmd]\n', text: 'Attempt 3' },
          { thought: '[ACP Tool in_progress: stuck_cmd]\n', text: 'Attempt 4' },
          { thought: '[ACP Tool completed: stuck_cmd]\n', text: 'Should not reach' },
        ],
      });
      let callCount2 = 0;
      const origStream2 = mock2.streamCompletion.bind(mock2);
      mock2.streamCompletion = async (messages, systemPrompt, tools, onChunk, signal) => {
        callCount2++;
        return origStream2(messages, systemPrompt, tools, onChunk, signal);
      };

      let completedStatusCount = 0;
      engine2.on('task:status', (ev) => {
        if (ev.status === 'completed') completedStatusCount++;
      });

      await engine2.startTask('Run stuck command', {
        customProvider: mock2,
        subagentsEnabled: false,
      });

      expect(callCount2).toBe(4);
      expect(completedStatusCount).toBe(1);
    } finally {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
