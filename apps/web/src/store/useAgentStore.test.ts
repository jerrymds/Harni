import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from './useAgentStore.js';

describe('useAgentStore and Slices', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ sessions: [], folders: [] }), { status: 200 });
    });

    // Reset store state
    useAgentStore.setState({
      status: 'idle',
      messages: [],
      selectedMode: 'code',
      selectedProvider: 'antigravity',
      selectedModel: 'gemini-3.7-flash',
      thinkingDepth: 'medium',
      isSettingsOpen: false,
      activeFile: null,
      fileTree: [],
    });
  });

  it('updates mode, provider, model and thinking depth', () => {
    const { setMode, setProvider, setModel, setThinkingDepth } = useAgentStore.getState();

    setMode('architect');
    expect(useAgentStore.getState().selectedMode).toBe('architect');

    setProvider('openai');
    expect(useAgentStore.getState().selectedProvider).toBe('openai');

    setModel('gpt-4o');
    expect(useAgentStore.getState().selectedModel).toBe('gpt-4o');

    setThinkingDepth('high');
    expect(useAgentStore.getState().thinkingDepth).toBe('high');
  });

  it('toggles settings modal state', () => {
    const { setSettingsOpen } = useAgentStore.getState();

    setSettingsOpen(true);
    expect(useAgentStore.getState().isSettingsOpen).toBe(true);

    setSettingsOpen(false);
    expect(useAgentStore.getState().isSettingsOpen).toBe(false);
  });

  it('manages workspace fileTree, activeFile and closeActiveFile', () => {
    const { closeActiveFile } = useAgentStore.getState();

    const mockTree = [
      { name: 'src', path: 'src', type: 'directory' as const, children: [{ name: 'index.ts', path: 'src/index.ts', type: 'file' as const }] },
    ];
    useAgentStore.setState({ fileTree: mockTree });
    expect(useAgentStore.getState().fileTree.length).toBe(1);

    useAgentStore.setState({ activeFile: { path: 'src/index.ts', content: 'test' } });
    expect(useAgentStore.getState().activeFile?.path).toBe('src/index.ts');

    closeActiveFile();
    expect(useAgentStore.getState().activeFile).toBeNull();
  });

  it('manages folder operations like rename and toggleCollapse', () => {
    const { renameFolder, toggleFolderCollapse } = useAgentStore.getState();

    useAgentStore.setState({
      folders: [
        { id: 'f1', name: 'Original', path: '/test', createdAt: 0, isCollapsed: false },
      ],
    });

    renameFolder('f1', 'Renamed Folder');
    expect(useAgentStore.getState().folders[0].name).toBe('Renamed Folder');

    toggleFolderCollapse('f1');
    expect(useAgentStore.getState().folders[0].isCollapsed).toBe(true);
  });

  it('handles rate limit error WebSocket message and sets rateLimitInfo in messages', () => {
    const mockSession = {
      id: 'sess_test_1',
      title: 'Test Session',
      status: 'thinking' as const,
      messages: [],
      messageCount: 0,
      mode: 'code' as const,
      model: 'gemini-3.8-pro',
      provider: 'antigravity' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      folderId: 'folder_default',
    };

    useAgentStore.setState({
      currentSessionId: 'sess_test_1',
      sessions: [mockSession],
      messages: [],
    });

    let messageHandler: any = null;
    const fakeWs = {
      readyState: 1,
      send: () => {},
      set onmessage(fn: any) {
        messageHandler = fn;
      },
      get onmessage() {
        return messageHandler;
      },
    };

    // Trigger connect with fake WebSocket
    const originalWS = globalThis.WebSocket;
    try {
      globalThis.WebSocket = function () {
        return fakeWs as any;
      } as any;
      useAgentStore.getState().connect();

      // Send error message
      if (typeof messageHandler === 'function') {
        messageHandler({
          data: JSON.stringify({
            type: 'error',
            payload: {
              code: 'RATE_LIMIT_ERROR',
              message:
                '[Google Gemini Rate Limit 429] 模型 gemini-3.8-pro 觸發頻率配額限制：【TPM 超標 (每分鐘 Token 數)】Tokens per minute limit. 建議等待時間：25s',
              sessionId: 'sess_test_1',
            },
          }),
        });
      }

      const state = useAgentStore.getState();
      expect(state.status).toBe('error');
      expect(state.messages.length).toBe(1);
      const errMessage = state.messages[0];
      expect(errMessage.role).toBe('assistant');
      expect(errMessage.rateLimitInfo?.isRateLimit).toBe(true);
      expect(errMessage.rateLimitInfo?.limitType).toBe('TPM');
      expect(errMessage.rateLimitInfo?.retryAfter).toBe('25s');
      expect(errMessage.content).toContain('TPM 超標');
    } finally {
      globalThis.WebSocket = originalWS;
    }
  });

  it('batches chat:thinking and chat:token stream chunks to prevent memory thrashing', async () => {
    const mockSession = {
      id: 'sess_stream_test',
      title: 'Stream Session',
      status: 'idle' as const,
      messages: [],
      messageCount: 0,
      mode: 'code' as const,
      model: 'gemini-3.8-pro',
      provider: 'antigravity' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      folderId: 'folder_default',
    };

    useAgentStore.setState({
      currentSessionId: 'sess_stream_test',
      sessions: [mockSession],
      messages: [],
      activeThinking: '',
    });

    let messageHandler: any = null;
    const fakeWs = {
      readyState: 1,
      send: () => {},
      set onmessage(fn: any) {
        messageHandler = fn;
      },
      get onmessage() {
        return messageHandler;
      },
    };

    const originalWS = globalThis.WebSocket;
    try {
      globalThis.WebSocket = function () {
        return fakeWs as any;
      } as any;
      useAgentStore.getState().connect();

      // Send multiple rapid chat:thinking chunks
      messageHandler({
        data: JSON.stringify({
          type: 'chat:thinking',
          payload: { sessionId: 'sess_stream_test', thought: 'Analyzing context... ' },
        }),
      });
      messageHandler({
        data: JSON.stringify({
          type: 'chat:thinking',
          payload: { sessionId: 'sess_stream_test', thought: 'Formulating step 1. ' },
        }),
      });

      // Wait for the 50ms batch window to flush
      await new Promise((resolve) => setTimeout(resolve, 80));

      let state = useAgentStore.getState();
      expect(state.status).toBe('thinking');
      expect(state.activeThinking).toBe('Analyzing context... Formulating step 1. ');

      // Now send rapid chat:token chunks
      messageHandler({
        data: JSON.stringify({
          type: 'chat:token',
          payload: { sessionId: 'sess_stream_test', text: 'Hello ' },
        }),
      });
      messageHandler({
        data: JSON.stringify({
          type: 'chat:token',
          payload: { sessionId: 'sess_stream_test', text: 'World!' },
        }),
      });

      // Wait for the 50ms token batch window to flush
      await new Promise((resolve) => setTimeout(resolve, 80));

      state = useAgentStore.getState();
      expect(state.status).toBe('streaming');
      expect(state.messages.length).toBe(1);
      expect(state.messages[0].content).toBe('Hello World!');

      // Send task:status completed, which should flush all pending buffers and clear thinking
      messageHandler({
        data: JSON.stringify({
          type: 'task:status',
          payload: { sessionId: 'sess_stream_test', status: 'completed' },
        }),
      });

      state = useAgentStore.getState();
      expect(state.status).toBe('completed');
      expect(state.activeThinking).toBe('');
    } finally {
      globalThis.WebSocket = originalWS;
    }
  });

  it('sendPrompt sends apiKey and baseURL only for custom provider and keeps them undefined for cline', async () => {
    const sentMessages: any[] = [];
    const mockWs = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn((data: string) => {
        sentMessages.push(JSON.parse(data));
      }),
    };

    useAgentStore.setState({
      ws: mockWs as any,
      currentSessionId: 'sess_provider_check',
      selectedProvider: 'cline',
      selectedModel: 'cline-pass/deepseek-v4-flash',
      customApiKey: 'sk-freetoken-secret-key',
      customBaseUrl: 'https://tibai.tibbuy.net/freetoken/api',
      sessions: [
        {
          id: 'sess_provider_check',
          title: 'Test',
          status: 'idle',
          messages: [],
          messageCount: 0,
          mode: 'code',
          provider: 'cline',
          model: 'cline-pass/deepseek-v4-flash',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          folderId: 'folder_default',
        },
      ],
    });

    const { sendPrompt } = useAgentStore.getState();
    sendPrompt('Test cline prompt');

    const clinePromptMsg = sentMessages.find((m) => m.type === 'user:prompt');
    expect(clinePromptMsg).toBeDefined();
    expect(clinePromptMsg.payload.provider).toBe('cline');
    expect(clinePromptMsg.payload.apiKey).toBeUndefined();

    // Now test with provider 'custom'
    sentMessages.length = 0;
    useAgentStore.setState({
      selectedProvider: 'custom',
    });

    sendPrompt('Test custom prompt');

    const customPromptMsg = sentMessages.find((m) => m.type === 'user:prompt');
    expect(customPromptMsg).toBeDefined();
    expect(customPromptMsg.payload.provider).toBe('custom');
    expect(customPromptMsg.payload.apiKey).toBe('sk-freetoken-secret-key');
    expect(customPromptMsg.payload.baseURL).toBe('https://tibai.tibbuy.net/freetoken/api');
  });
});

