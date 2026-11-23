import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AntigravityProvider,
  composeAntigravityModel,
  toAgyAcpModelId,
} from '../src/providers/antigravityProvider.js';
import {
  AgyAcpSession,
  AgyAcpSessionPool,
  buildZedClientInfo,
} from '../src/providers/agyAcpSession.js';
import {
  ACP_HARNI_ORCHESTRATION_RULE_TAG,
  buildAgyCompositePrompt,
  buildAgyPromptParts,
  buildAgySessionKey,
} from '../src/providers/agyPromptBuilder.js';
import { HarniAcpMcpBridge } from '../src/providers/harniAcpMcpBridge.js';
import { ProviderFactory } from '../src/providers/providerFactory.js';
import { AgentCoreEngine, MockProvider, SubagentManager } from '../src/index.js';
import type { ChatMessage } from '@harni/types';

interface MockSpawnRecord {
  command: string;
  args: string[];
  options: Record<string, unknown>;
  requests: Array<Record<string, any>>;
  proc: EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
}

interface MockAcpControllerOptions {
  stallOnPrompt?: boolean;
  onPrompt?: (
    msg: Record<string, any>,
    helpers: {
      send: (obj: Record<string, unknown>) => void;
      sendStderr: (line: string) => void;
      exit: (code?: number) => void;
    },
    record: MockSpawnRecord,
  ) => void;
  onMessage?: (
    msg: Record<string, any>,
    helpers: {
      send: (obj: Record<string, unknown>) => void;
      sendStderr: (line: string) => void;
      exit: (code?: number) => void;
    },
    record: MockSpawnRecord,
  ) => void;
}

function createMockAgySpawn(opts: MockAcpControllerOptions = {}): {
  spawnFn: typeof nodeSpawn;
  records: MockSpawnRecord[];
} {
  const records: MockSpawnRecord[] = [];

  const spawnFn = vi.fn((command: string, args: string[] = [], options: Record<string, unknown> = {}) => {
    const proc = new EventEmitter() as MockSpawnRecord['proc'];
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();

    const record: MockSpawnRecord = {
      command,
      args: [...args],
      options,
      requests: [],
      proc,
    };
    records.push(record);

    proc.kill = vi.fn(() => {
      proc.emit('exit', 0);
      proc.emit('close', 0);
      return true;
    });

    const helpers = {
      send: (obj: Record<string, unknown>) => {
        proc.stdout.write(JSON.stringify(obj) + '\n');
      },
      sendStderr: (line: string) => {
        proc.stderr.write(line + '\n');
      },
      exit: (code = 0) => {
        proc.emit('exit', code);
        proc.emit('close', code);
      },
    };

    let stdinBuf = '';
    proc.stdin.on('data', (chunk: Buffer | string) => {
      stdinBuf += chunk.toString();
      const lines = stdinBuf.split(/\r?\n/);
      stdinBuf = lines.pop() ?? '';
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }
        record.requests.push(msg);

        if (opts.onMessage) {
          opts.onMessage(msg, helpers, record);
        }

        if (msg.method === 'initialize') {
          helpers.send({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: 1, serverInfo: { name: 'agy', version: '1.0.0' } },
          });
        } else if (msg.method === 'session/new') {
          helpers.send({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              sessionId: `acp_sess_${records.length}`,
              models: { availableModels: ['gemini-3.8-flash-medium'] },
            },
          });
        } else if (msg.method === 'session/set_model') {
          helpers.send({
            jsonrpc: '2.0',
            id: msg.id,
            result: {},
          });
        } else if (msg.method === 'session/prompt') {
          if (opts.stallOnPrompt) {
            continue;
          }
          if (opts.onPrompt) {
            opts.onPrompt(msg, helpers, record);
          } else {
            helpers.send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: msg.params?.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: 'hello' },
                },
              },
            });
            helpers.send({
              jsonrpc: '2.0',
              id: msg.id,
              result: { stopReason: 'end_turn' },
            });
          }
        } else if (msg.method === 'session/close') {
          helpers.exit(0);
        }
      }
    });

    return proc as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;

  return { spawnFn, records };
}

function userMsg(content: string): ChatMessage {
  return {
    id: `u_${Date.now()}_${Math.random()}`,
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

describe('AntigravityProvider direct ACP (Zed simulation + OAuth)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS;
    delete process.env.ANTIGRAVITY_ACP_CLIENT_NAME;
    delete process.env.ANTIGRAVITY_ACP_CLIENT_TITLE;
    delete process.env.ANTIGRAVITY_ACP_CLIENT_VERSION;
  });

  it('Zed clientInfo 與 3 步驟握手 (initialize -> session/new -> session/set_model -> session/prompt)', async () => {
    const pool = new AgyAcpSessionPool();
    const { spawnFn, records } = createMockAgySpawn();

    const provider = new AntigravityProvider({
      agyPath: 'agy',
      spawnFn,
      sessionPool: pool,
      model: 'claude-sonnet-5-5:acp',
      thinkingDepth: 'high',
      workspaceRoot: process.cwd(),
      sessionId: 'sess_zed_1',
    });

    const chunks: any[] = [];
    const result = await provider.streamCompletion(
      [userMsg('Hello Zed ACP')],
      'sys prompt',
      [],
      (c) => chunks.push(c),
    );

    expect(result.text).toBe('hello');
    expect(chunks.some((c) => c.type === 'token' && c.content === 'hello')).toBe(true);
    expect(records.length).toBe(1);

    const methods = records[0]!.requests.map((r) => r.method);
    expect(methods).toEqual(['initialize', 'session/new', 'session/set_model', 'session/prompt']);

    const initReq = records[0]!.requests[0]!;
    expect(initReq.params.protocolVersion).toBe(1);
    expect(initReq.params.clientInfo).toEqual(buildZedClientInfo());
    expect(initReq.params.clientInfo.name).toBe('zed');
    expect(initReq.params.clientInfo.title).toBe('Zed');
    expect(initReq.params.clientInfo.version).toBe('0.180.0');
    expect(initReq.params.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });

    const setModelReq = records[0]!.requests[2]!;
    expect(setModelReq.params.modelId).toBe('claude-sonnet-5-5-high');

    const promptReq = records[0]!.requests[3]!;
    expect(promptReq.params.prompt).toEqual([{ type: 'text', text: 'Hello Zed ACP' }]);

    await pool.shutdown();
  });

  it('正確串流 session/update (agent_thought_chunk, agent_message_chunk, tool_call, tool_call_update) 與 result.usage', async () => {
    const pool = new AgyAcpSessionPool();
    const { spawnFn } = createMockAgySpawn({
      onPrompt: (msg, { send }) => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'agent_thought_chunk',
              content: { text: 'Thinking step 1...\n' },
            },
          },
        });
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tc_1',
              status: 'in_progress',
              title: 'read_file package.json',
            },
          },
        });
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'tc_1',
              status: 'completed',
              title: 'read_file package.json',
            },
          },
        });
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { text: 'Final answer' },
            },
          },
        });
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            stopReason: 'end_turn',
            usage: {
              promptTokens: 120,
              completionTokens: 45,
              totalTokens: 165,
            },
          },
        });
      },
    });

    const provider = new AntigravityProvider({
      agyPath: 'agy',
      spawnFn,
      sessionPool: pool,
      sessionId: 'sess_stream_1',
    });

    const chunks: any[] = [];
    const result = await provider.streamCompletion([userMsg('Inspect')], 'sys', [], (c) =>
      chunks.push(c),
    );

    expect(result.text).toBe('Final answer');
    expect(result.thinking).toContain('Thinking step 1...');
    expect(result.thinking).toContain('[ACP Tool in_progress: read_file package.json]');
    expect(result.thinking).toContain('[ACP Tool completed: read_file package.json]');
    expect(result.usage).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
    });
    expect(chunks.some((c) => c.type === 'usage')).toBe(true);

    await pool.shutdown();
  });

  it('tool_call_update 省略 title 時沿用同 toolCallId 在 tool_call 階段的標題，讓 extractIncompleteAcpTools 正確配對清除', async () => {
    const pool = new AgyAcpSessionPool();
    const { spawnFn } = createMockAgySpawn({
      onPrompt: (msg, { send }) => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tc_omit_title',
              status: 'in_progress',
              title: 'File src/app.ts',
            },
          },
        });
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'tc_omit_title',
              status: 'completed',
            },
          },
        });
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { text: 'Done' },
            },
          },
        });
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { stopReason: 'end_turn' },
        });
      },
    });

    const provider = new AntigravityProvider({
      agyPath: 'agy',
      spawnFn,
      sessionPool: pool,
      sessionId: 'sess_omit_title',
    });

    const result = await provider.streamCompletion([userMsg('Edit')], 'sys', [], () => {});
    expect(result.thinking).toContain('[ACP Tool in_progress: File src/app.ts]');
    expect(result.thinking).toContain('[ACP Tool completed: File src/app.ts]');
    expect(AntigravityProvider.extractIncompleteAcpTools(result.thinking)).toEqual([]);

    await pool.shutdown();
  });

  it('agy acp 卡住時超過 idle timeout 會拋出明確錯誤', async () => {
    process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS = '50';
    const pool = new AgyAcpSessionPool();
    const { spawnFn } = createMockAgySpawn({ stallOnPrompt: true });

    const provider = new AntigravityProvider({
      agyPath: 'agy',
      spawnFn,
      sessionPool: pool,
      sessionId: 'sess_timeout',
    });

    await expect(
      provider.streamCompletion([userMsg('hello')], 'sys', [], () => {}),
    ).rejects.toThrow(/Antigravity ACP 串流逾時/);

    await pool.shutdown();
  });

  it('環境變數未設定時使用預設 90 秒，設定時可覆寫，無效值回退預設', () => {
    const p1 = new AntigravityProvider();
    expect((p1 as any).idleTimeoutMs).toBe(90_000);

    process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS = '5000';
    const p2 = new AntigravityProvider();
    expect((p2 as any).idleTimeoutMs).toBe(5000);

    process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS = 'abc';
    const p3 = new AntigravityProvider();
    expect((p3 as any).idleTimeoutMs).toBe(90_000);
  });

  describe('Dynamic autoApprove & interactive permission approval', () => {
    it('autoApprove: true 時帶入 --dangerously-skip-permissions 並自動核准 session/request_permission (allow_once)', async () => {
      const pool = new AgyAcpSessionPool();
      const { spawnFn, records } = createMockAgySpawn({
        onPrompt: (msg, { send }) => {
          send({
            jsonrpc: '2.0',
            id: 901,
            method: 'session/request_permission',
            params: {
              options: [
                { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
                { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
              ],
              toolCall: {
                toolCallId: 'call_auto_1',
                name: 'run_command',
                arguments: { command: 'npm test' },
                title: 'Run npm test',
              },
            },
          });
          setTimeout(() => {
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                update: { sessionUpdate: 'agent_message_chunk', content: { text: 'tests passed' } },
              },
            });
            send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
          }, 10);
        },
      });

      const requestApproval = vi.fn();
      const provider = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        autoApprove: true,
        requestApproval,
        sessionId: 'sess_auto_true',
      });

      const result = await provider.streamCompletion([userMsg('run tests')], 'sys', [], () => {});

      expect(result.text).toBe('tests passed');
      expect(records[0]!.args).toContain('--dangerously-skip-permissions');
      expect(requestApproval).not.toHaveBeenCalled();

      const permResp = records[0]!.requests.find((r) => r.id === 901 && r.result);
      expect(permResp?.result).toEqual({
        outcome: { outcome: 'selected', optionId: 'allow_once' },
      });

      await pool.shutdown();
    });

    it('autoApprove: false 時移除 --dangerously-skip-permissions 並呼叫 requestApproval 回傳 allow_once 或 deny', async () => {
      const pool = new AgyAcpSessionPool();
      const requestedApprovals: any[] = [];
      let nextDecision = true;

      const requestApproval = vi.fn(async (req) => {
        requestedApprovals.push(req);
        return { approved: nextDecision };
      });

      const { spawnFn, records } = createMockAgySpawn({
        onPrompt: (msg, { send }) => {
          send({
            jsonrpc: '2.0',
            id: 902,
            method: 'session/request_permission',
            params: {
              options: [
                { optionId: 'allow_once', kind: 'allow_once' },
                { optionId: 'deny', kind: 'reject_once' },
              ],
              toolCall: {
                toolCallId: 'call_interactive_1',
                name: 'execute_command',
                arguments: { command: 'git status' },
                title: 'Run Git Status',
              },
            },
          });
        },
        onMessage: (msg, { send }, record) => {
          if (msg.id === 902 && msg.result) {
            const promptReq = record.requests
              .slice()
              .reverse()
              .find((r) => r.method === 'session/prompt');
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { text: `outcome:${msg.result.outcome.optionId}` },
                },
              },
            });
            send({
              jsonrpc: '2.0',
              id: promptReq?.id,
              result: { stopReason: 'end_turn' },
            });
          }
        },
      });

      const providerApprove = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        autoApprove: false,
        requestApproval,
        sessionId: 'sess_interactive_allow',
      });

      const r1 = await providerApprove.streamCompletion([userMsg('git status')], 'sys', [], () => {});
      expect(records[0]!.args).not.toContain('--dangerously-skip-permissions');
      expect(requestApproval).toHaveBeenCalledTimes(1);
      expect(requestedApprovals[0]).toEqual({
        toolCallId: 'call_interactive_1',
        name: 'execute_command',
        arguments: { command: 'git status' },
        title: 'Run Git Status',
      });
      expect(r1.text).toBe('outcome:allow_once');

      // Now reject
      nextDecision = false;
      const providerDeny = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        autoApprove: false,
        requestApproval,
        sessionId: 'sess_interactive_deny',
      });

      const r2 = await providerDeny.streamCompletion([userMsg('rm file')], 'sys', [], () => {});
      expect(records[1]!.args).not.toContain('--dangerously-skip-permissions');
      expect(r2.text).toBe('outcome:deny');

      await pool.shutdown();
    });

    it('autoApprove: false 且未提供 requestApproval 時預設回傳 deny', async () => {
      const pool = new AgyAcpSessionPool();
      const { spawnFn, records } = createMockAgySpawn({
        onPrompt: (_msg, { send }) => {
          send({
            jsonrpc: '2.0',
            id: 903,
            method: 'session/request_permission',
            params: {
              options: [
                { optionId: 'allow_once', kind: 'allow_once' },
                { optionId: 'deny', kind: 'reject_once' },
              ],
              toolCall: {
                toolCallId: 'call_no_handler',
                name: 'run_command',
                arguments: { command: 'ls' },
              },
            },
          });
        },
        onMessage: (msg, { send }, record) => {
          if (msg.id === 903 && msg.result) {
            const promptReq = record.requests.find((r) => r.method === 'session/prompt');
            send({
              jsonrpc: '2.0',
              id: promptReq?.id,
              result: { stopReason: 'end_turn' },
            });
          }
        },
      });

      const provider = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        autoApprove: false,
        sessionId: 'sess_no_handler',
      });

      await provider.streamCompletion([userMsg('list')], 'sys', [], () => {});
      expect(records[0]!.args).not.toContain('--dangerously-skip-permissions');
      const permResp = records[0]!.requests.find((r) => r.id === 903 && r.result);
      expect(permResp?.result).toEqual({
        outcome: { outcome: 'selected', optionId: 'deny' },
      });

      await pool.shutdown();
    });
  });

  describe('AgyAcpSessionPool reuse & eviction', () => {
    it('同一個 sessionId + workspaceRoot 多輪對話重用同一個 agy acp 行程；更換 workspaceDir 時自動重建', async () => {
      const pool = new AgyAcpSessionPool();
      const { spawnFn, records } = createMockAgySpawn();

      const wsA = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-ws-a-'));
      const wsB = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-ws-b-'));
      try {
        const providerA1 = new AntigravityProvider({
          agyPath: 'agy',
          spawnFn,
          sessionPool: pool,
          workspaceRoot: wsA,
          sessionId: 'shared_sess',
        });
        await providerA1.streamCompletion([userMsg('Turn 1')], 'sys', [], () => {});
        expect(records.length).toBe(1);

        // Turn 2 with same sessionId + workspaceRoot reuses process
        await providerA1.streamCompletion(
          [
            userMsg('Turn 1'),
            { id: 'a1', role: 'assistant', content: 'hello', timestamp: Date.now() },
            userMsg('Turn 2'),
          ],
          'sys',
          [],
          () => {},
        );
        expect(records.length).toBe(1);
        const promptCalls = records[0]!.requests.filter((r) => r.method === 'session/prompt');
        expect(promptCalls.length).toBe(2);
        expect(promptCalls[1]!.params.prompt[0].text).toBe('Turn 2');

        // Different workspaceRoot creates a new session key and spawns a new process
        const providerB = new AntigravityProvider({
          agyPath: 'agy',
          spawnFn,
          sessionPool: pool,
          workspaceRoot: wsB,
          sessionId: 'shared_sess',
        });
        await providerB.streamCompletion([userMsg('Turn in B')], 'sys', [], () => {});
        expect(records.length).toBe(2);

        // Also verify pool directly evicts & recreates when workspaceDir mismatches on same key
        const directKey = 'direct_same_key';
        const first = await pool.getOrCreateSession(directKey, {
          agyPath: 'agy',
          spawnFn,
          workspaceDir: wsA,
          sessionId: 'k1',
        });
        expect(first.isNew).toBe(true);
        const second = await pool.getOrCreateSession(directKey, {
          agyPath: 'agy',
          spawnFn,
          workspaceDir: wsA,
          sessionId: 'k1',
        });
        expect(second.isNew).toBe(false);
        const third = await pool.getOrCreateSession(directKey, {
          agyPath: 'agy',
          spawnFn,
          workspaceDir: wsB,
          sessionId: 'k1',
        });
        expect(third.isNew).toBe(true);
        expect(first.session).not.toBe(third.session);
      } finally {
        await pool.shutdown();
        await fs.rm(wsA, { recursive: true, force: true });
        await fs.rm(wsB, { recursive: true, force: true });
      }
    });
  });

  it('AbortSignal 取消時發送 session/cancel', async () => {
    const pool = new AgyAcpSessionPool();
    const { spawnFn, records } = createMockAgySpawn({ stallOnPrompt: true });

    const provider = new AntigravityProvider({
      agyPath: 'agy',
      spawnFn,
      sessionPool: pool,
      sessionId: 'sess_abort',
    });

    const ac = new AbortController();
    const p = provider.streamCompletion([userMsg('long task')], 'sys', [], () => {}, ac.signal);

    await vi.waitFor(() => {
      expect(records.length).toBe(1);
      expect(records[0]!.requests.some((r) => r.method === 'session/prompt')).toBe(true);
    });

    ac.abort();

    await expect(p).rejects.toThrow(/abort/i);
    expect(records[0]!.requests.some((r) => r.method === 'session/cancel')).toBe(true);

    await pool.shutdown();
  });

  it('無任何有效 user/tool turn 時直接回傳空文字而不啟動 ACP', async () => {
    const pool = new AgyAcpSessionPool();
    const { spawnFn, records } = createMockAgySpawn();

    const provider = new AntigravityProvider({
      agyPath: 'agy',
      spawnFn,
      sessionPool: pool,
    });

    const result = await provider.streamCompletion([], 'sys', [], () => {});
    expect(result.text).toBe('');
    expect(records.length).toBe(0);
  });
});

describe('agyPromptBuilder & Antigravity model helpers', () => {
  it('buildAgyPromptParts 注入 [ACP_SYNC_EXECUTION_RULE] 且不重複注入；deny 模式切換為文字 tool 呼叫指引', () => {
    const tools = [
      {
        name: 'read_file',
        description: 'Read file',
        parameters: { type: 'object' as const, properties: {} },
      },
      {
        name: 'invoke_subagent',
        description: 'Spawn subagent',
        parameters: { type: 'object' as const, properties: {} },
      },
    ];

    const allowParts = buildAgyPromptParts([userMsg('hi')], 'base system prompt', tools, 'allow');
    expect(allowParts.preamble).toContain('[ACP_SYNC_EXECUTION_RULE]');
    expect(allowParts.preamble).toContain('WaitMsBeforeAsync');
    expect(allowParts.preamble).toContain('### invoke_subagent');
    expect(allowParts.preamble).not.toContain('### read_file');

    const dedupParts = buildAgyPromptParts(
      [userMsg('hi')],
      'base [ACP_SYNC_EXECUTION_RULE] prompt',
      tools,
      'allow',
    );
    expect(dedupParts.preamble.match(/\[ACP_SYNC_EXECUTION_RULE\]/g)?.length).toBe(1);

    const denyParts = buildAgyPromptParts([userMsg('hi')], 'base system prompt', tools, 'deny');
    expect(denyParts.preamble).not.toContain('[ACP_SYNC_EXECUTION_RULE]');
    expect(denyParts.preamble).toContain('Do NOT invoke built-in native tools directly');
    expect(denyParts.preamble).toContain('### read_file');
  });

  it('buildAgyCompositePrompt 與 buildAgySessionKey 正確產生歷史摘要與穩定 24 字元雜湊鍵', () => {
    const msgs: ChatMessage[] = [
      userMsg('First question'),
      {
        id: 'a1',
        role: 'assistant',
        content: 'Let me check',
        toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }],
        timestamp: Date.now(),
      },
      {
        id: 't1',
        role: 'tool',
        name: 'read_file',
        content: '',
        toolResult: { output: 'file contents' },
        timestamp: Date.now(),
      },
      userMsg('Second question'),
    ];

    const composite = buildAgyCompositePrompt(msgs, 'Second question');
    expect(composite).toContain('## Earlier Conversation History');
    expect(composite).toContain('User: First question');
    expect(composite).toContain('Calling tool `read_file` with arguments: {"path":"a.ts"}');
    expect(composite).toContain('## Current Request\nSecond question');

    const k1 = buildAgySessionKey({ sessionId: 's1', workspaceRoot: '/ws/a' });
    const k2 = buildAgySessionKey({ sessionId: 's1', workspaceRoot: '/ws/a' });
    const k3 = buildAgySessionKey({ sessionId: 's1', workspaceRoot: '/ws/b' });
    const kSub1 = buildAgySessionKey({ sessionId: 's1', subagentId: 'sub_1', workspaceRoot: '/ws/a' });
    const kSub2 = buildAgySessionKey({ sessionId: 's1', subagentId: 'sub_2', workspaceRoot: '/ws/a' });
    expect(k1).toHaveLength(24);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(kSub1).toHaveLength(24);
    expect(kSub2).toHaveLength(24);
    expect(kSub1).not.toBe(k1);
    expect(kSub1).not.toBe(kSub2);
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
});

describe('composeAntigravityModel & toAgyAcpModelId', () => {
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
    expect(toAgyAcpModelId('claude-opus-5-5:acp', 'high')).toBe('claude-opus-5-5-high');
  });

  it('若模型已包含 -(low|medium|high|xhigh) 或為 gemini-pro-orchestrator-*，維持原名稱不重複加後綴', () => {
    expect(composeAntigravityModel('gemini-3.8-flash-low', 'high')).toBe('gemini-3.8-flash-low');
    expect(composeAntigravityModel('gemini-3.8-flash-medium', 'high')).toBe('gemini-3.8-flash-medium');
    expect(composeAntigravityModel('gemini-3.8-flash-high', 'low')).toBe('gemini-3.8-flash-high');
    expect(composeAntigravityModel('gemini-3.8-pro-xhigh', 'medium')).toBe('gemini-3.8-pro-xhigh');
    expect(composeAntigravityModel('gemini-pro-orchestrator-v1', 'high')).toBe(
      'gemini-pro-orchestrator-v1',
    );
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

describe('AntigravityProvider.sanitizeMalformedJson & extractTextToolCalls', () => {
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
    expect(calls[0].arguments.content as string).toContain('export function parse');
  });

  it('正確處理在尾端截斷的未閉合工具呼叫', () => {
    const text = 'Calling tool `execute_command` with arguments: {"command": "npm run build';
    const calls = AntigravityProvider.extractTextToolCalls(text);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('run_command');
    expect(calls[0].arguments.command).toBe('npm run build');
  });
});

describe('AntigravityProvider.extractIncompleteAcpTools', () => {
  it('正確追蹤 in_progress、completed、failed、cancelled、auto_resumed 與 generic tool fallback pop', () => {
    expect(AntigravityProvider.extractIncompleteAcpTools(undefined)).toEqual([]);
    expect(AntigravityProvider.extractIncompleteAcpTools('')).toEqual([]);

    const inProgressOnly = '[ACP Tool in_progress: dotnet build]\n[ACP Tool running: npm test]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(inProgressOnly)).toEqual([
      'dotnet build',
      'npm test',
    ]);

    const resolved =
      '[ACP Tool in_progress: dotnet build]\n' +
      '[ACP Tool pending: lint]\n' +
      '[ACP Tool running: unit test]\n' +
      '[ACP Tool completed: dotnet build]\n' +
      '[ACP Tool failed: lint]\n' +
      '[ACP Tool cancelled: unit test]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(resolved)).toEqual([]);

    const autoResumed =
      '[ACP Tool in_progress: build_a]\n' +
      '[ACP Tool in_progress: build_b]\n' +
      '[ACP Tool in_progress: build_c]\n' +
      '[ACP Tool auto_resumed: build_a, build_b]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(autoResumed)).toEqual(['build_c']);

    const fallbackPop = '[ACP Tool in_progress: dotnet build]\n[ACP Tool completed: tool]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(fallbackPop)).toEqual([]);

    const pathSuffixResolved =
      '[ACP Tool in_progress: dotnet build]\n' +
      '[ACP Tool in_progress: File TibAgentApi/Controllers/StoreController.cs]\n' +
      '[ACP Tool completed: File /D:/Work/Project/Tibtrade/OMMS/TibAgentApi/Controllers/StoreController.cs]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(pathSuffixResolved)).toEqual([
      'dotnet build',
    ]);

    const unrelatedCompletion =
      '[ACP Tool in_progress: dotnet build]\n[ACP Tool completed: unrelated_tool]\n';
    expect(AntigravityProvider.extractIncompleteAcpTools(unrelatedCompletion)).toEqual([
      'dotnet build',
    ]);
  });
});

describe('AgentCoreEngine ACP incomplete tool auto-continuation', () => {
  it('當 thinking 留下 [ACP Tool in_progress: ...] 且 toolCalls 為空時自動續接，最多重試 3 次', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-acp-cont-'));
    try {
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

describe('Harni ACP MCP Bridge & Subagent Orchestration Integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTIGRAVITY_IDLE_TIMEOUT_MS;
  });

  it('buildAgyPromptParts injects [ACP_HARNI_ORCHESTRATION_RULE], hides bridged tools from text list, and enforces disableSubagents', () => {
    const tools = [
      {
        name: 'read_file',
        description: 'Read file',
        parameters: { type: 'object' as const, properties: {} },
      },
      {
        name: 'invoke_subagent',
        description: 'Spawn subagent',
        parameters: { type: 'object' as const, properties: {} },
      },
      {
        name: 'ask_question',
        description: 'Ask user',
        parameters: { type: 'object' as const, properties: {} },
      },
    ];

    const bridged = buildAgyPromptParts([userMsg('hi')], 'sys', tools, 'allow', {
      acpMcpServerName: 'harni',
      acpMcpToolNames: ['invoke_subagent', 'ask_question'],
    });

    expect(bridged.preamble).toContain(ACP_HARNI_ORCHESTRATION_RULE_TAG);
    expect(bridged.preamble).toContain('mcp_harni_invoke_subagent');
    expect(bridged.preamble).toContain('mcp_harni_ask_question');
    expect(bridged.preamble).not.toContain('## Available functions');
    expect(bridged.preamble).not.toContain('### invoke_subagent');

    const disabledSub = buildAgyPromptParts([userMsg('hi')], 'sys', [tools[0]!], 'allow', {
      disableSubagents: true,
    });
    expect(disabledSub.preamble).toContain('Subagent orchestration is disabled');
    expect(disabledSub.preamble).toContain('NEVER call CLI built-in `invoke_subagent`');
  });

  it('passes mcpServers when executeAcpTool is provided and AgyAcpSessionPool recreates when mcpToolsSignature changes', async () => {
    const pool = new AgyAcpSessionPool();
    const bridge = new HarniAcpMcpBridge();
    const { spawnFn, records } = createMockAgySpawn();

    try {
      const invokeTool = {
        name: 'invoke_subagent',
        description: 'Spawn subagent',
        parameters: { type: 'object' as const, properties: {} },
      };
      const askTool = {
        name: 'ask_question',
        description: 'Ask question',
        parameters: { type: 'object' as const, properties: {} },
      };

      const provider = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        mcpBridge: bridge,
        sessionId: 'sess_mcp_sig',
        executeAcpTool: async (_name, _args, meta) => ({
          toolCallId: meta.toolCallId,
          output: 'ok',
        }),
      });

      // Turn 1 with [invoke_subagent]
      await provider.streamCompletion([userMsg('Turn 1')], 'sys', [invokeTool], () => {});
      expect(records).toHaveLength(1);
      const newSess1 = records[0]!.requests.find((r) => r.method === 'session/new');
      expect(newSess1?.params.mcpServers).toHaveLength(1);
      expect(newSess1?.params.mcpServers[0].name).toBe('harni');
      expect(newSess1?.params.mcpServers[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[a-f0-9]+$/);

      // Turn 2 with same tools -> reuses warm session
      await provider.streamCompletion([userMsg('Turn 2')], 'sys', [invokeTool], () => {});
      expect(records).toHaveLength(1);

      // Turn 3 with changed tool set -> recreates session
      await provider.streamCompletion([userMsg('Turn 3')], 'sys', [invokeTool, askTool], () => {});
      expect(records).toHaveLength(2);
    } finally {
      await pool.shutdown();
      await bridge.close();
    }
  });

  it('handles ACP permissions: auto-approves mcp_harni_*, denies bridged native tools, and prompts for run_command', async () => {
    const pool = new AgyAcpSessionPool();
    const bridge = new HarniAcpMcpBridge();
    const requestApproval = vi.fn(async () => ({ approved: true }));

    const { spawnFn, records } = createMockAgySpawn({
      onPrompt: (msg, { send }) => {
        // 1. mcp_harni_invoke_subagent -> auto-approved without requestApproval
        send({
          jsonrpc: '2.0',
          id: 701,
          method: 'session/request_permission',
          params: {
            options: [
              { optionId: 'allow_once', kind: 'allow_once' },
              { optionId: 'deny', kind: 'reject_once' },
            ],
            toolCall: { toolCallId: 'tc_mcp', name: 'mcp_harni_invoke_subagent', arguments: {} },
          },
        });
        // 2. native invoke_subagent when bridged -> denied without requestApproval
        send({
          jsonrpc: '2.0',
          id: 702,
          method: 'session/request_permission',
          params: {
            options: [
              { optionId: 'allow_once', kind: 'allow_once' },
              { optionId: 'deny', kind: 'reject_once' },
            ],
            toolCall: { toolCallId: 'tc_native_sub', name: 'invoke_subagent', arguments: {} },
          },
        });
        // 3. run_command -> still calls requestApproval
        send({
          jsonrpc: '2.0',
          id: 703,
          method: 'session/request_permission',
          params: {
            options: [
              { optionId: 'allow_once', kind: 'allow_once' },
              { optionId: 'deny', kind: 'reject_once' },
            ],
            toolCall: { toolCallId: 'tc_cmd', name: 'run_command', arguments: { command: 'ls' } },
          },
        });
        setTimeout(() => {
          send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
        }, 20);
      },
    });

    try {
      const provider = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        mcpBridge: bridge,
        autoApprove: false,
        requestApproval,
        sessionId: 'sess_perm_bridge',
        executeAcpTool: async (_name, _args, meta) => ({
          toolCallId: meta.toolCallId,
          output: 'ok',
        }),
      });

      const invokeTool = {
        name: 'invoke_subagent',
        description: 'Spawn subagent',
        parameters: { type: 'object' as const, properties: {} },
      };

      await provider.streamCompletion([userMsg('test perms')], 'sys', [invokeTool], () => {});

      const resp701 = records[0]!.requests.find((r) => r.id === 701 && r.result);
      const resp702 = records[0]!.requests.find((r) => r.id === 702 && r.result);
      const resp703 = records[0]!.requests.find((r) => r.id === 703 && r.result);

      expect(resp701?.result.outcome.optionId).toBe('allow_once');
      expect(resp702?.result.outcome.optionId).toBe('deny');
      expect(resp703?.result.outcome.optionId).toBe('allow_once');
      expect(requestApproval).toHaveBeenCalledTimes(1);
      expect(requestApproval.mock.calls[0]![0].name).toBe('run_command');
    } finally {
      await pool.shutdown();
      await bridge.close();
    }
  });

  it('protects against idle timeout while hasActiveInternalToolCalls() is true and resumes timeout once false', async () => {
    const pool = new AgyAcpSessionPool();
    const { spawnFn } = createMockAgySpawn({ stallOnPrompt: true });

    const session = new AgyAcpSession({
      agyPath: 'agy',
      spawnFn,
      turnTimeoutMs: 40,
      sessionId: 'sess_active_call_timeout',
    });

    try {
      let active = true;
      setTimeout(() => {
        active = false;
      }, 110);

      const startedAt = Date.now();
      const consume = async () => {
        for await (const _ev of session.sendTurn('wait on active call', {
          timeoutMs: 40,
          hasActiveInternalToolCalls: () => active,
        })) {
          // wait
        }
      };

      await expect(consume()).rejects.toThrow(/Antigravity ACP 串流逾時/);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    } finally {
      await session.close();
      await pool.shutdown();
    }
  });

  it('normalizeUsage parses inputTokens / outputTokens / cachedReadTokens / cachedWriteTokens', async () => {
    const pool = new AgyAcpSessionPool();
    const { spawnFn } = createMockAgySpawn({
      onPrompt: (msg, { send }) => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            stopReason: 'end_turn',
            usage: {
              inputTokens: 300,
              outputTokens: 75,
              cachedReadTokens: 120,
              cachedWriteTokens: 40,
            },
          },
        });
      },
    });

    try {
      const provider = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        sessionId: 'sess_usage_agy_fields',
      });
      const result = await provider.streamCompletion([userMsg('usage')], 'sys', [], () => {});
      expect(result.usage).toEqual({
        promptTokens: 300,
        completionTokens: 75,
        totalTokens: 375,
        cacheReadTokens: 120,
        cacheWriteTokens: 40,
      });
    } finally {
      await pool.shutdown();
    }
  });

  it('end-to-end: AgentCoreEngine + mock agy acp + real HarniAcpMcpBridge executes subagent via HTTP MCP', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-e2e-bridge-'));
    const pool = new AgyAcpSessionPool();
    const bridge = new HarniAcpMcpBridge();
    const engine = new AgentCoreEngine({
      workspaceRoot: tmpWorkspace,
      defaultProvider: 'antigravity',
      autoTestEnabled: false,
      gitCheckpointEnabled: false,
    });

    try {
      const { spawnFn } = createMockAgySpawn({
        onPrompt: (msg, { send }, record) => {
          const newSessReq = record.requests.find((r) => r.method === 'session/new');
          const mcpServer = newSessReq?.params?.mcpServers?.[0];
          expect(mcpServer).toBeDefined();

          const mcpUrl = new URL(mcpServer.url);
          const authVal = mcpServer.headers.find((h: any) => h.name === 'Authorization')?.value;

          const req = http.request(
            {
              hostname: mcpUrl.hostname,
              port: Number(mcpUrl.port),
              path: mcpUrl.pathname,
              method: 'POST',
              headers: {
                Authorization: authVal,
                'Content-Type': 'application/json',
              },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c: Buffer) => chunks.push(c));
              res.on('end', () => {
                const rpcRes = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const mcpText = rpcRes.result?.content?.[0]?.text || '';
                send({
                  jsonrpc: '2.0',
                  method: 'session/update',
                  params: {
                    update: {
                      sessionUpdate: 'agent_message_chunk',
                      content: { text: `Subagent result received: ${mcpText}` },
                    },
                  },
                });
                send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
              });
            },
          );
          req.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 55,
              method: 'tools/call',
              params: {
                name: 'invoke_subagent',
                arguments: {
                  TypeName: 'researcher',
                  Role: 'Bridge Researcher',
                  Prompt: 'Summarize workspace',
                },
              },
            }),
          );
          req.end();
        },
      });

      let callIndex = 0;
      vi.spyOn(ProviderFactory, 'create').mockImplementation((_type, opts) => {
        callIndex++;
        if (callIndex === 1) {
          return new AntigravityProvider({
            ...opts,
            agyPath: 'agy',
            spawnFn,
            sessionPool: pool,
            mcpBridge: bridge,
          });
        }
        return new MockProvider({
          ...opts,
          script: [{ text: 'E2E Subagent Findings: OK' }],
        });
      });

      const spawnedEvents: any[] = [];
      const statusEvents: any[] = [];
      const completedEvents: any[] = [];
      engine.on('subagent:spawned', (e) => spawnedEvents.push(e));
      engine.on('subagent:status', (e) => statusEvents.push(e));
      engine.on('subagent:completed', (e) => completedEvents.push(e));

      await engine.startTask('Delegate via MCP bridge', {
        sessionId: 'sess_e2e_bridge',
        provider: 'antigravity',
        model: 'claude-sonnet-5-5:acp',
        autoApprove: true,
        subagentsEnabled: true,
      });

      expect(spawnedEvents).toHaveLength(1);
      expect(spawnedEvents[0].subagent.role).toBe('Bridge Researcher');
      expect(statusEvents.some((e) => e.status === 'running')).toBe(true);
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0].status).toBe('completed');
      expect(completedEvents[0].result).toContain('E2E Subagent Findings: OK');

      const state = engine.getTaskState('sess_e2e_bridge');
      expect(state?.subagents).toHaveLength(1);
      expect(state?.subagents?.[0]?.status).toBe('completed');
      const lastMsg = state?.messages[state.messages.length - 1];
      expect(lastMsg?.content).toContain('E2E Subagent Findings: OK');
    } finally {
      await pool.shutdown();
      await bridge.close();
      await engine.dispose();
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('fallback mirroring: native invoke_subagent acp_tool updates mirror to SubagentManager while mcp_harni_invoke_subagent does not duplicate', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-mirror-'));
    const pool = new AgyAcpSessionPool();
    const bridge = new HarniAcpMcpBridge();
    const engine = new AgentCoreEngine({
      workspaceRoot: tmpWorkspace,
      defaultProvider: 'antigravity',
      autoTestEnabled: false,
      gitCheckpointEnabled: false,
    });

    try {
      const { spawnFn } = createMockAgySpawn({
        onPrompt: (msg, { send }) => {
          // Should NOT mirror mcp_harni_invoke_subagent
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'tc_bridged_ignored',
                name: 'mcp_harni_invoke_subagent',
                status: 'in_progress',
                title: 'mcp_harni_invoke_subagent',
                arguments: { TypeName: 'coder', Role: 'Ignored', Prompt: 'Should not mirror' },
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'tc_bridged_ignored',
                status: 'completed',
              },
            },
          });
          // Native fallback invoke_subagent SHOULD mirror
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'tc_native_mirror',
                name: 'invoke_subagent',
                status: 'in_progress',
                title: 'Native Subagent',
                arguments: { TypeName: 'researcher', Role: 'Native Scout', Prompt: 'Explore repo' },
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'tc_native_mirror',
                status: 'completed',
                output: 'Native scout done',
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { text: 'Mirrored complete' },
              },
            },
          });
          send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
        },
      });

      vi.spyOn(ProviderFactory, 'create').mockImplementation((_type, opts) => {
        return new AntigravityProvider({
          ...opts,
          agyPath: 'agy',
          spawnFn,
          sessionPool: pool,
          mcpBridge: bridge,
        });
      });

      const spawned: any[] = [];
      const completed: any[] = [];
      engine.on('subagent:spawned', (e) => spawned.push(e));
      engine.on('subagent:completed', (e) => completed.push(e));

      await engine.startTask('Run fallback mirror test', {
        sessionId: 'sess_mirror',
        provider: 'antigravity',
        model: 'claude-sonnet-5-5:acp',
        autoApprove: true,
      });

      expect(spawned).toHaveLength(1);
      expect(spawned[0].subagent.id).toBe('tc_native_mirror');
      expect(spawned[0].subagent.role).toBe('Native Scout');
      expect(completed).toHaveLength(1);
      expect(completed[0].subagentId).toBe('tc_native_mirror');
      expect(completed[0].result).toBe('Native scout done');

      const state = engine.getTaskState('sess_mirror');
      expect(state?.subagents).toHaveLength(1);
      expect(state?.subagents?.[0]?.id).toBe('tc_native_mirror');
      expect(state?.subagents?.[0]?.status).toBe('completed');
    } finally {
      await pool.shutdown();
      await bridge.close();
      await engine.dispose();
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('subagent running in acp mode tracks acp_tool progress in toolCallCount and emits subagent:tool', async () => {
    const tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-sub-acp-tool-'));
    const pool = new AgyAcpSessionPool();
    const bridge = new HarniAcpMcpBridge();

    try {
      const { spawnFn } = createMockAgySpawn({
        onPrompt: (msg, { send }) => {
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'sub_tc_1',
                name: 'read_file',
                status: 'in_progress',
                title: 'Read package.json',
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'sub_tc_1',
                status: 'pending',
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'sub_tc_1',
                status: 'in_progress',
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'sub_tc_1',
                status: 'completed',
                output: '{"name":"harni"}',
              },
            },
          });
          // mcp_harni_* acp_tool should be ignored to avoid double counting
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'sub_tc_mcp',
                name: 'mcp_harni_ask_question',
                status: 'in_progress',
                title: 'ask_question',
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { text: 'Subagent finished inspection' },
              },
            },
          });
          send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
        },
      });

      const subProvider = new AntigravityProvider({
        agyPath: 'agy',
        spawnFn,
        sessionPool: pool,
        mcpBridge: bridge,
        sessionId: 'sess_sub_acp',
        subagentId: 'sub_acp_1',
      });

      const manager = new SubagentManager({ workspaceRoot: tmpWorkspace });
      const toolEvents: any[] = [];
      manager.on('subagent:tool', (ev) => toolEvents.push(ev));

      const results = await manager.spawnSubagents([
        {
          typeName: 'researcher',
          role: 'ACP Researcher',
          prompt: 'Inspect package.json',
          sessionId: 'sess_sub_acp',
          parentId: 'parent_1',
          customProvider: subProvider,
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe('completed');
      expect(results[0]!.toolCallCount).toBe(1);
      const startEvents = toolEvents.filter((e) => e.toolName === 'read_file' && e.status === 'start');
      const completeEvents = toolEvents.filter((e) => e.toolName === 'read_file' && e.status === 'complete');
      expect(startEvents).toHaveLength(1);
      expect(completeEvents).toHaveLength(1);
      expect(toolEvents.some((e) => e.toolName === 'mcp_harni_ask_question')).toBe(false);
    } finally {
      await pool.shutdown();
      await bridge.close();
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
