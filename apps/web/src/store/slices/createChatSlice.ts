import type { StateCreator } from 'zustand';
import type { AgentMode, AgentStatus, ChatMessage, ChatSession, LLMProviderType, ModelInfo } from '@harni/types';
import type { AgentStoreState, ChatSlice } from '../types.js';
import {
  apiFetch,
  clearMessagesInDB,
  deleteSessionFromDB,
  loadSavedFolders,
  loadSavedSessions,
  PROVIDER_DEFAULT_MODELS,
  saveFoldersToStorage,
  saveSessionsToStorage,
  syncFoldersToDB,
  syncSessionToDB,
  syncSettingsToDB,
} from '../utils.js';

const savedProvider = (localStorage.getItem('cline_web_provider') as LLMProviderType) || 'cline';
const savedModel =
  localStorage.getItem('cline_web_model') ||
  localStorage.getItem(`cline_web_model_${savedProvider}`) ||
  PROVIDER_DEFAULT_MODELS[savedProvider];
const savedMode = (localStorage.getItem('cline_web_mode') as AgentMode) || 'code';
const initialFolders = loadSavedFolders();
const defaultFolderId = initialFolders[0]?.id || 'folder_default';
const initialSessionsData = loadSavedSessions(savedMode, defaultFolderId, savedProvider, savedModel);

export const createChatSlice: StateCreator<AgentStoreState, [], [], ChatSlice> = (set, get) => ({
  status: 'idle',
  sessions: initialSessionsData.sessions,
  currentSessionId: initialSessionsData.activeId,
  messages: initialSessionsData.initialMessages,
  activeThinking: '',
  pendingApproval: null,
  pendingQuestion: null,
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  selectedMode: savedMode,
  selectedProvider: initialSessionsData.initialProvider || savedProvider,
  selectedModel: initialSessionsData.initialModel || savedModel,
  availableModels: {},
  isLoadingModels: false,
  subagents: {},

  sendPrompt: (prompt, contextFiles) => {
    const {
      ws,
      selectedMode,
      selectedProvider,
      selectedModel,
      customApiKey,
      customBaseUrl,
      sessions,
      currentSessionId,
      messages,
      folders,
      activeFolderId,
    } = get();

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[sendPrompt] WebSocket is not connected!');
      get().connect();
      return;
    }

    // Determine current session's workspace root
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const targetFolderId = currentSession?.folderId || activeFolderId;
    const currentFolder = folders.find((f) => f.id === targetFolderId);
    const workspaceRoot = currentFolder?.path;

    // 1. Optimistically append user message to chat UI immediately
    const userMsg: ChatMessage = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMsg];

    // 2. Update current session in sessions list (with provider and model assigned)
    const updatedSessions = sessions.map((s) => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          title: s.messageCount === 0 ? prompt.slice(0, 26) + (prompt.length > 26 ? '...' : '') : s.title,
          messageCount: s.messageCount + 1,
          mode: selectedMode,
          provider: selectedProvider,
          model: selectedModel,
          status: 'thinking' as AgentStatus,
          activeThinking: '',
          updatedAt: Date.now(),
          messages: newMessages,
        };
      }
      return s;
    });

    set({
      messages: newMessages,
      sessions: updatedSessions,
      activeThinking: '',
      status: 'thinking',
    });

    saveSessionsToStorage(updatedSessions);
    const targetSession = updatedSessions.find((s) => s.id === currentSessionId);
    if (targetSession) syncSessionToDB(targetSession);

    // 3. Send WebSocket user:prompt message with sessionId, model, provider, workspaceRoot, and history
    ws.send(
      JSON.stringify({
        type: 'session:subscribe',
        payload: { sessionId: currentSessionId },
      }),
    );
    const msg = {
      type: 'user:prompt',
      payload: {
        sessionId: currentSessionId,
        prompt,
        mode: selectedMode,
        provider: selectedProvider,
        model: selectedModel || undefined,
        apiKey: selectedProvider === 'custom' ? (customApiKey || undefined) : undefined,
        baseURL: (selectedProvider === 'custom' ? customBaseUrl : get().providerBaseUrls[selectedProvider]) || undefined,
        autoApprove: get().autoApprove,
        autoTest: get().autoTestEnabled,
        testCommand: get().autoTestCommand || undefined,
        enableWorktree: get().worktreeIsolationEnabled,
        enableCheckpoint: get().gitCheckpointEnabled,
        subagentsEnabled: get().subagentsEnabled,
        thinkingDepth: get().thinkingDepth,
        contextFiles,
        workspaceRoot: workspaceRoot || undefined,
        history: messages,
      },
    };
    ws.send(JSON.stringify(msg));
  },

  cancelTask: () => {
    const { ws, currentSessionId, sessions } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'task:cancel',
        payload: { taskId: '', sessionId: currentSessionId },
      };
      ws.send(JSON.stringify(msg));
    }

    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId
        ? { ...s, status: 'cancelled' as AgentStatus, activeThinking: '', pendingApproval: null, pendingQuestion: null }
        : s,
    );
    set({ status: 'cancelled', activeThinking: '', pendingApproval: null, pendingQuestion: null, sessions: updatedSessions });
    saveSessionsToStorage(updatedSessions);
  },

  approveTool: (toolCallId, approved, feedback) => {
    const { ws, currentSessionId, sessions } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      type: 'tool:approve',
      payload: { toolCallId, approved, feedback, sessionId: currentSessionId },
    };
    ws.send(JSON.stringify(msg));
    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId ? { ...s, pendingApproval: null } : s,
    );
    set({ pendingApproval: null, sessions: updatedSessions });
    saveSessionsToStorage(updatedSessions);
  },

  answerQuestion: (toolCallId, answers, customInput) => {
    const { ws, currentSessionId, sessions } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      type: 'question:answer',
      payload: { toolCallId, answers, customInput, sessionId: currentSessionId },
    };
    ws.send(JSON.stringify(msg));
    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId ? { ...s, pendingQuestion: null } : s,
    );
    set({ pendingQuestion: null, sessions: updatedSessions });
    saveSessionsToStorage(updatedSessions);
  },

  newSession: (targetFolderId) => {
    const {
      ws,
      sessions,
      selectedMode,
      selectedProvider,
      selectedModel,
      folders,
      activeFolderId,
    } = get();

    const folderId = targetFolderId || activeFolderId || folders[0]?.id || 'folder_default';
    const targetFolder = folders.find((f) => f.id === folderId);
    const newId = `session_${Date.now()}`;
    const newSessionItem: ChatSession = {
      id: newId,
      folderId,
      title: `Task #${sessions.length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      mode: selectedMode,
      provider: selectedProvider,
      model: selectedModel,
      messages: [],
      status: 'idle',
      activeThinking: '',
      pendingApproval: null,
      pendingQuestion: null,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    // Ensure target folder is expanded
    const updatedFolders = folders.map((f) =>
      f.id === folderId ? { ...f, isCollapsed: false } : f,
    );

    const updatedSessions = [newSessionItem, ...sessions];

    localStorage.setItem('cline_web_current_session_id', newId);
    localStorage.setItem('cline_web_active_folder_id', folderId);

    set({
      sessions: updatedSessions,
      folders: updatedFolders,
      currentSessionId: newId,
      activeFolderId: folderId,
      messages: [],
      activeThinking: '',
      pendingApproval: null,
      pendingQuestion: null,
      status: 'idle',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    saveSessionsToStorage(updatedSessions, true);
    saveFoldersToStorage(updatedFolders);
    syncSessionToDB(newSessionItem, true);
    syncFoldersToDB(updatedFolders);
    syncSettingsToDB({
      active_session_id: newId,
      active_folder_id: folderId,
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'session:subscribe',
          payload: { sessionId: newId },
        }),
      );
      if (targetFolder?.path) {
        ws.send(
          JSON.stringify({
            type: 'workspace:set',
            payload: { path: targetFolder.path, sessionId: newId },
          }),
        );
      }
    }
  },

  switchSession: (sessionId) => {
    const { sessions, folders, ws, currentSessionId } = get();
    if (currentSessionId === sessionId) return;

    const target = sessions.find((s) => s.id === sessionId);
    if (target) {
      const folderId = target.folderId || get().activeFolderId;
      const targetFolder = folders.find((f) => f.id === folderId);

      // Auto-switch to model and provider bound to this session!
      const targetProvider = target.provider || get().selectedProvider;
      const targetModel = target.model || get().selectedModel;

      localStorage.setItem('cline_web_current_session_id', sessionId);
      localStorage.setItem('cline_web_active_folder_id', folderId);
      if (target.provider) {
        localStorage.setItem('cline_web_provider', target.provider);
      }
      if (target.model) {
        localStorage.setItem('cline_web_model', target.model);
      }

      set({
        currentSessionId: sessionId,
        activeFolderId: folderId,
        messages: Array.isArray(target.messages) ? target.messages : [],
        selectedMode: target.mode || get().selectedMode,
        selectedProvider: targetProvider,
        selectedModel: targetModel,
        activeThinking: target.activeThinking || '',
        pendingApproval: target.pendingApproval || null,
        pendingQuestion: target.pendingQuestion || null,
        status: target.status || 'idle',
        tokenUsage: target.tokenUsage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

      if (target.provider && target.provider !== get().selectedProvider) {
        get().fetchModels(target.provider);
      }

      syncSettingsToDB({
        active_session_id: sessionId,
        active_folder_id: folderId,
      });

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'session:subscribe',
            payload: { sessionId },
          }),
        );
        if (targetFolder?.path) {
          ws.send(
            JSON.stringify({
              type: 'workspace:set',
              payload: { path: targetFolder.path, sessionId },
            }),
          );
        }
      }
    }
  },

  deleteSession: (sessionId) => {
    const { ws, sessions, currentSessionId, folders, activeFolderId, selectedProvider, selectedModel, selectedMode } = get();
    const filtered = sessions.filter((s) => s.id !== sessionId);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'session:unsubscribe',
          payload: { sessionId },
        }),
      );
    }

    deleteSessionFromDB(sessionId);

    if (filtered.length === 0) {
      const defaultId = `session_${Date.now()}`;
      const folderId = activeFolderId || folders[0]?.id || 'folder_default';
      const defaultSession: ChatSession = {
        id: defaultId,
        folderId,
        title: 'Current Task',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        mode: selectedMode,
        provider: selectedProvider,
        model: selectedModel,
        messages: [],
      };
      localStorage.setItem('cline_web_current_session_id', defaultId);
      set({
        sessions: [defaultSession],
        currentSessionId: defaultId,
        messages: [],
        status: 'idle',
      });
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'session:subscribe',
            payload: { sessionId: defaultId },
          }),
        );
      }
      saveSessionsToStorage([defaultSession], true);
      syncSessionToDB(defaultSession, true);
      return;
    }

    const nextActiveId =
      currentSessionId === sessionId ? filtered[0]?.id || '' : currentSessionId;
    const nextSession = filtered.find((s) => s.id === nextActiveId);

    localStorage.setItem('cline_web_current_session_id', nextActiveId);
    if (nextSession?.folderId) {
      localStorage.setItem('cline_web_active_folder_id', nextSession.folderId);
    }

    const nextProvider = nextSession?.provider || selectedProvider;
    const nextModel = nextSession?.model || selectedModel;

    set({
      sessions: filtered,
      currentSessionId: nextActiveId,
      activeFolderId: nextSession?.folderId || activeFolderId,
      messages: nextSession?.messages || [],
      selectedProvider: nextProvider,
      selectedModel: nextModel,
      status: 'idle',
    });
    if (ws && ws.readyState === WebSocket.OPEN && nextActiveId) {
      ws.send(
        JSON.stringify({
          type: 'session:subscribe',
          payload: { sessionId: nextActiveId },
        }),
      );
    }
    saveSessionsToStorage(filtered, true);
    syncSettingsToDB({
      active_session_id: nextActiveId,
      active_folder_id: nextSession?.folderId || activeFolderId,
    });
  },

  moveSessionToFolder: (sessionId, targetFolderId) => {
    const { sessions } = get();
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, folderId: targetFolderId, updatedAt: Date.now() } : s,
    );
    set({ sessions: updated, activeFolderId: targetFolderId });
    saveSessionsToStorage(updated, true);
    const targetSession = updated.find((s) => s.id === sessionId);
    if (targetSession) syncSessionToDB(targetSession, true);
  },

  clearMessages: () => {
    const { ws, sessions, currentSessionId } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'task:new', payload: { sessionId: currentSessionId } }));
    }

    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId
        ? {
            ...s,
            messages: [],
            messageCount: 0,
            status: 'idle' as AgentStatus,
            activeThinking: '',
            pendingApproval: null,
            tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            updatedAt: Date.now(),
          }
        : s,
    );

    set({
      messages: [],
      sessions: updatedSessions,
      status: 'idle',
      activeThinking: '',
      pendingApproval: null,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    saveSessionsToStorage(updatedSessions, true);
    clearMessagesInDB(currentSessionId);
  },

  setMode: (mode) => {
    localStorage.setItem('cline_web_mode', mode);
    const { sessions, currentSessionId } = get();
    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId ? { ...s, mode, updatedAt: Date.now() } : s,
    );
    set({ selectedMode: mode, sessions: updatedSessions });
    saveSessionsToStorage(updatedSessions);
    const cur = updatedSessions.find((s) => s.id === currentSessionId);
    if (cur) syncSessionToDB(cur);
  },

  setProvider: (provider) => {
    localStorage.setItem('cline_web_provider', provider);
    const savedForProvider =
      localStorage.getItem(`cline_web_model_${provider}`) ||
      PROVIDER_DEFAULT_MODELS[provider] ||
      '';
    localStorage.setItem('cline_web_model', savedForProvider);

    const providerBaseUrl = get().providerBaseUrls[provider] || '';

    const { sessions, currentSessionId } = get();
    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId
        ? { ...s, provider, model: savedForProvider, updatedAt: Date.now() }
        : s,
    );

    set({
      selectedProvider: provider,
      selectedModel: savedForProvider,
      customBaseUrl: providerBaseUrl,
      sessions: updatedSessions,
    });

    saveSessionsToStorage(updatedSessions);
    const cur = updatedSessions.find((s) => s.id === currentSessionId);
    if (cur) syncSessionToDB(cur);
    get().fetchModels(provider, undefined, providerBaseUrl || undefined);
  },

  setModel: (model) => {
    localStorage.setItem('cline_web_model', model);
    localStorage.setItem(`cline_web_model_${get().selectedProvider}`, model);

    const { sessions, currentSessionId, selectedProvider } = get();
    const updatedSessions = sessions.map((s) =>
      s.id === currentSessionId
        ? { ...s, model, provider: selectedProvider, updatedAt: Date.now() }
        : s,
    );

    set({
      selectedModel: model,
      sessions: updatedSessions,
    });

    saveSessionsToStorage(updatedSessions);
    const cur = updatedSessions.find((s) => s.id === currentSessionId);
    if (cur) syncSessionToDB(cur);
  },

  fetchModels: async (providerParam, apiKeyParam, baseUrlParam) => {
    const provider = providerParam || get().selectedProvider;
    const apiKey =
      apiKeyParam !== undefined
        ? apiKeyParam
        : provider === 'custom'
          ? (get().customApiKey || undefined)
          : undefined;
    const baseURL =
      baseUrlParam !== undefined
        ? baseUrlParam
        : provider === 'custom'
          ? (get().customBaseUrl || undefined)
          : (get().providerBaseUrls[provider] || undefined);

    set({ isLoadingModels: true });
    try {
      const query = new URLSearchParams({
        provider,
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      });

      const res = await apiFetch(`/api/models?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const models: ModelInfo[] = data.models || [];
        set((s) => ({
          availableModels: {
            ...s.availableModels,
            [provider]: models,
          },
        }));

        // Only default to first model if no model was ever selected
        const currentModel = get().selectedModel;
        if (!currentModel && models.length > 0) {
          const fallback = models[0]?.id || '';
          set({ selectedModel: fallback });
          localStorage.setItem('cline_web_model', fallback);
        }
      }
    } catch (err) {
      console.warn('[createChatSlice] Failed to fetch models from /models API:', err);
    } finally {
      set({ isLoadingModels: false });
    }
  },

  killSubagent: (subagentId: string) => {
    const { subagents, currentSessionId } = get();
    const sessionSubagents = subagents[currentSessionId] || [];
    const updated = sessionSubagents.map((s) =>
      s.id === subagentId ? { ...s, status: 'cancelled' as const } : s,
    );
    set({
      subagents: {
        ...subagents,
        [currentSessionId]: updated,
      },
    });
  },
});
