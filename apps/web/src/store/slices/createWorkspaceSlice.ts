import type { StateCreator } from 'zustand';
import type { AgentStatus, ChatMessage, ServerMessage, WorkspaceFolder } from '@harni/types';
import type { AgentStoreState, WorkspaceSlice } from '../types.js';
import {
  apiFetch,
  deleteFolderFromDB,
  getServerAuthToken,
  loadSavedFolders,
  loadSavedSessions,
  PROVIDER_DEFAULT_MODELS,
  saveFoldersToStorage,
  saveSessionsToStorage,
  syncFoldersToDB,
  syncSessionToDB,
} from '../utils.js';
import { isRateLimitError, parseClientRateLimit } from '../../utils/rateLimit.js';

const savedProvider = (localStorage.getItem('cline_web_provider') as any) || 'cline';
const savedModel =
  localStorage.getItem('cline_web_model') ||
  localStorage.getItem(`cline_web_model_${savedProvider}`) ||
  PROVIDER_DEFAULT_MODELS[savedProvider as keyof typeof PROVIDER_DEFAULT_MODELS] ||
  '';
const savedMode = (localStorage.getItem('cline_web_mode') as any) || 'code';
const initialFolders = loadSavedFolders();
const defaultFolderId = initialFolders[0]?.id || 'folder_default';
const initialSessionsData = loadSavedSessions(savedMode, defaultFolderId, savedProvider, savedModel);

// --- Stream Buffering Helpers to eliminate V8 GC churn & Chrome high-frequency DOM/state thrashing ---
let thinkingBuffer: Record<string, string> = {};
let thinkingFlushTimer: any = null;

let tokenBuffer: Record<string, string> = {};
let tokenFlushTimer: any = null;

export function flushThinkingBuffer(
  get: () => AgentStoreState,
  set: (partial: Partial<AgentStoreState> | ((state: AgentStoreState) => Partial<AgentStoreState>)) => void,
): void {
  if (thinkingFlushTimer) {
    clearTimeout(thinkingFlushTimer);
    thinkingFlushTimer = null;
  }
  const sessionIds = Object.keys(thinkingBuffer);
  if (sessionIds.length === 0) return;

  const currentBuffer = { ...thinkingBuffer };
  thinkingBuffer = {};

  const { sessions, currentSessionId } = get();
  let updatedCurrentThinking: string | null = null;

  const updatedSessions = sessions.map((s) => {
    const chunk = currentBuffer[s.id];
    if (chunk) {
      const newThinking = (s.activeThinking || '') + chunk;
      if (s.id === currentSessionId) {
        updatedCurrentThinking = newThinking;
      }
      return {
        ...s,
        activeThinking: newThinking,
        status: 'thinking' as AgentStatus,
        updatedAt: Date.now(),
      };
    }
    return s;
  });

  if (updatedCurrentThinking !== null) {
    set({
      activeThinking: updatedCurrentThinking,
      status: 'thinking',
      sessions: updatedSessions,
    });
  } else {
    set({ sessions: updatedSessions });
  }
}

export function flushTokenBuffer(
  get: () => AgentStoreState,
  set: (partial: Partial<AgentStoreState> | ((state: AgentStoreState) => Partial<AgentStoreState>)) => void,
): void {
  if (tokenFlushTimer) {
    clearTimeout(tokenFlushTimer);
    tokenFlushTimer = null;
  }
  const sessionIds = Object.keys(tokenBuffer);
  if (sessionIds.length === 0) return;

  const currentTokens = { ...tokenBuffer };
  tokenBuffer = {};

  const { sessions, currentSessionId } = get();
  let updatedMessages: ChatMessage[] | null = null;

  const updatedSessions = sessions.map((s) => {
    const appendedText = currentTokens[s.id];
    if (appendedText) {
      const sMessages = [...(s.messages || [])];
      const last = sMessages[sMessages.length - 1];
      if (last && last.role === 'assistant') {
        sMessages[sMessages.length - 1] = {
          ...last,
          content: (last.content || '') + appendedText,
        };
      } else {
        sMessages.push({
          id: `asst_${Date.now()}`,
          role: 'assistant',
          content: appendedText,
          timestamp: Date.now(),
        });
      }
      if (s.id === currentSessionId) {
        updatedMessages = sMessages;
      }
      return {
        ...s,
        messages: sMessages,
        messageCount: sMessages.length,
        status: 'streaming' as AgentStatus,
        updatedAt: Date.now(),
      };
    }
    return s;
  });

  if (updatedMessages) {
    set({
      messages: updatedMessages,
      sessions: updatedSessions,
      status: 'streaming',
    });
  } else {
    set({ sessions: updatedSessions });
  }

  saveSessionsToStorage(updatedSessions);
  for (const sId of sessionIds) {
    const targetSession = updatedSessions.find((s) => s.id === sId);
    if (targetSession) syncSessionToDB(targetSession);
  }
}

export function flushAllStreamBuffers(
  get: () => AgentStoreState,
  set: (partial: Partial<AgentStoreState> | ((state: AgentStoreState) => Partial<AgentStoreState>)) => void,
): void {
  flushThinkingBuffer(get, set);
  flushTokenBuffer(get, set);
}

export const createWorkspaceSlice: StateCreator<AgentStoreState, [], [], WorkspaceSlice> = (set, get) => ({
  connected: false,
  folders: initialFolders,
  activeFolderId: initialSessionsData.activeFolderId,
  fileTree: [],
  workspaceInfo: null,
  activeFile: null,
  activeDiff: null,
  skills: [],
  isLoadingSkills: false,
  fileDiagnostics: {},
  checkpoints: [],
  activeWorktrees: {},
  isRevertingCheckpoint: false,
  ws: null,
  onTerminalDataCallback: null,

  connect: (url) => {
    get().initFromDB();
    get().fetchGoogleAuthStatus();
    get().fetchCredentials();
    get().fetchModels();
    get().fetchSkills();
    get().fetchCheckpoints();

    const existingWs = get().ws;
    if (existingWs && existingWs.readyState === WebSocket.OPEN) return;

    const token = get().serverAuthToken || getServerAuthToken();
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    const wsUrl =
      url ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:3001/ws${tokenQuery}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ connected: true, ws });
      console.log('[WS Client] Connected to server at', wsUrl);
      const { currentSessionId } = get();
      if (currentSessionId && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'session:subscribe',
            payload: { sessionId: currentSessionId },
          }),
        );
      }
    };

    ws.onclose = () => {
      flushAllStreamBuffers(get, set);
      set({ connected: false, ws: null });
      console.log('[WS Client] Disconnected from server. Reconnecting in 3s...');
      setTimeout(() => {
        get().connect(url);
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('[WS Client] WebSocket Error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        // If a non-streaming message arrives, flush any pending stream buffers immediately
        if (msg.type !== 'chat:thinking' && msg.type !== 'chat:token') {
          flushAllStreamBuffers(get, set);
        }
        switch (msg.type) {
          case 'task:status': {
            const { sessions, currentSessionId } = get();
            const targetSessionId = (msg.payload as any).sessionId || currentSessionId;
            const newStatus = msg.payload.status;

            const isDone =
              newStatus === 'completed' ||
              newStatus === 'error' ||
              newStatus === 'cancelled';

            const updatedSessions = sessions.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    status: newStatus,
                    activeThinking: isDone ? '' : s.activeThinking,
                    pendingApproval: isDone ? null : s.pendingApproval,
                    updatedAt: Date.now(),
                  }
                : s,
            );

            if (targetSessionId === currentSessionId) {
              set({
                status: newStatus,
                activeThinking: isDone ? '' : get().activeThinking,
                pendingApproval: isDone ? null : get().pendingApproval,
                sessions: updatedSessions,
              });
            } else {
              set({ sessions: updatedSessions });
            }
            saveSessionsToStorage(updatedSessions);
            const targetSession = updatedSessions.find((s) => s.id === targetSessionId);
            if (targetSession) syncSessionToDB(targetSession);
            break;
          }

          case 'task:state': {
            const { sessions, currentSessionId } = get();
            const targetSessionId = (msg.payload as any).sessionId || currentSessionId;
            const updatedMessages = msg.payload.messages || [];

            const updatedSessions = sessions.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: updatedMessages.length > 0 ? updatedMessages : s.messages,
                    messageCount: updatedMessages.length > 0 ? updatedMessages.length : s.messageCount,
                    tokenUsage: msg.payload.tokenUsage || s.tokenUsage,
                    status: msg.payload.status || s.status,
                    updatedAt: Date.now(),
                  }
                : s,
            );

            if (targetSessionId === currentSessionId) {
              if (updatedMessages.length > 0) {
                set({
                  messages: updatedMessages,
                  sessions: updatedSessions,
                  tokenUsage: msg.payload.tokenUsage,
                  status: msg.payload.status,
                });
              } else {
                set({
                  sessions: updatedSessions,
                  tokenUsage: msg.payload.tokenUsage,
                  status: msg.payload.status,
                });
              }
            } else {
              set({ sessions: updatedSessions });
            }

            saveSessionsToStorage(updatedSessions);
            const targetSession = updatedSessions.find((s) => s.id === targetSessionId);
            if (targetSession) syncSessionToDB(targetSession);
            break;
          }

          case 'chat:token': {
            const targetSessionId = (msg.payload as any).sessionId || get().currentSessionId;
            // If there is pending thinking text for this session, flush it first to preserve ordering
            if (thinkingBuffer[targetSessionId]) {
              flushThinkingBuffer(get, set);
            }
            tokenBuffer[targetSessionId] = (tokenBuffer[targetSessionId] || '') + msg.payload.text;

            // Batch stream token updates to ~50ms window to eliminate V8 GC churn and continuous React/DOM reflows
            if (!tokenFlushTimer) {
              tokenFlushTimer = setTimeout(() => {
                flushTokenBuffer(get, set);
              }, 50);
            }
            break;
          }

          case 'chat:thinking': {
            const targetSessionId = (msg.payload as any).sessionId || get().currentSessionId;
            thinkingBuffer[targetSessionId] = (thinkingBuffer[targetSessionId] || '') + msg.payload.thought;

            // Batch stream thinking updates to ~50ms window (~20fps instead of 80fps+)
            if (!thinkingFlushTimer) {
              thinkingFlushTimer = setTimeout(() => {
                flushThinkingBuffer(get, set);
              }, 50);
            }
            break;
          }

          case 'question:ask': {
            const { sessions, currentSessionId } = get();
            const targetSessionId = (msg.payload as any).sessionId || currentSessionId;

            const updatedSessions = sessions.map((s) =>
              s.id === targetSessionId
                ? { ...s, pendingQuestion: msg.payload, status: 'waiting_user_input' as AgentStatus }
                : s,
            );
            if (targetSessionId === currentSessionId) {
              set({
                pendingQuestion: msg.payload,
                status: 'waiting_user_input',
                sessions: updatedSessions,
              });
            } else {
              set({ sessions: updatedSessions });
            }
            break;
          }

          case 'tool:request': {
            const { sessions, currentSessionId } = get();
            const targetSessionId = (msg.payload as any).sessionId || currentSessionId;

            if (msg.payload.requiresApproval) {
              const updatedSessions = sessions.map((s) =>
                s.id === targetSessionId
                  ? { ...s, pendingApproval: msg.payload, status: 'waiting_approval' as AgentStatus }
                  : s,
              );
              if (targetSessionId === currentSessionId) {
                set({
                  pendingApproval: msg.payload,
                  status: 'waiting_approval',
                  sessions: updatedSessions,
                });
              } else {
                set({ sessions: updatedSessions });
              }
            }
            break;
          }

          case 'tool:result': {
            const { sessions, currentSessionId } = get();
            const targetSessionId = (msg.payload as any).sessionId || currentSessionId;

            const updatedSessions = sessions.map((s) =>
              s.id === targetSessionId
                ? { ...s, pendingApproval: null, pendingQuestion: null }
                : s,
            );
            if (targetSessionId === currentSessionId) {
              set({ pendingApproval: null, pendingQuestion: null, sessions: updatedSessions });
            } else {
              set({ sessions: updatedSessions });
            }
            break;
          }

          case 'subagent:spawned': {
            const { subagents, currentSessionId } = get();
            const sid = msg.payload.sessionId || currentSessionId;
            const existing = subagents[sid] || [];
            const sub = msg.payload.subagent;
            const updated = existing.some((s) => s.id === sub.id)
              ? existing.map((s) => (s.id === sub.id ? sub : s))
              : [...existing, sub];
            set({
              subagents: {
                ...subagents,
                [sid]: updated,
              },
            });
            break;
          }

          case 'subagent:status': {
            const { subagents, currentSessionId } = get();
            const sid = msg.payload.sessionId || currentSessionId;
            const existing = subagents[sid] || [];
            const updated = existing.map((s) =>
              s.id === msg.payload.subagentId
                ? { ...s, status: msg.payload.status, error: msg.payload.error, updatedAt: Date.now() }
                : s,
            );
            set({
              subagents: {
                ...subagents,
                [sid]: updated,
              },
            });
            break;
          }

          case 'subagent:tool': {
            const { subagents, currentSessionId } = get();
            const sid = msg.payload.sessionId || currentSessionId;
            const existing = subagents[sid] || [];
            const updated = existing.map((s) =>
              s.id === msg.payload.subagentId
                ? {
                    ...s,
                    toolCallCount: (s.toolCallCount || 0) + (msg.payload.status === 'start' ? 1 : 0),
                    updatedAt: Date.now(),
                  }
                : s,
            );
            set({
              subagents: {
                ...subagents,
                [sid]: updated,
              },
            });
            break;
          }

          case 'subagent:completed': {
            const { subagents, currentSessionId } = get();
            const sid = msg.payload.sessionId || currentSessionId;
            const existing = subagents[sid] || [];
            const updated = existing.map((s) =>
              s.id === msg.payload.subagentId
                ? {
                    ...s,
                    status: 'completed' as const,
                    result: msg.payload.result,
                    completedAt: Date.now(),
                    updatedAt: Date.now(),
                  }
                : s,
            );
            set({
              subagents: {
                ...subagents,
                [sid]: updated,
              },
            });
            break;
          }

          case 'file:diff':
            set({ activeDiff: msg.payload });
            break;

          case 'file:diagnostics': {
            const { fileDiagnostics } = get();
            set({
              fileDiagnostics: {
                ...fileDiagnostics,
                [msg.payload.path]: msg.payload.diagnostics,
              },
            });
            break;
          }

          case 'checkpoint:created': {
            const { checkpoints } = get();
            const newCkpt = msg.payload.checkpoint;
            const updated = [newCkpt, ...checkpoints.filter((c) => c.id !== newCkpt.id)];
            set({ checkpoints: updated });
            break;
          }

          case 'checkpoint:pruned': {
            const { folders, activeFolderId, workspaceInfo } = get();
            const currentFolder = folders.find((f) => f.id === activeFolderId);
            const root = currentFolder?.path || workspaceInfo?.rootPath;
            get().fetchCheckpoints(root);
            break;
          }

          case 'checkpoint:restored': {
            set({ isRevertingCheckpoint: false });
            get().loadDirectory('');
            break;
          }

          case 'worktree:status': {
            const { activeWorktrees } = get();
            const sid = msg.payload.sessionId;
            if (sid) {
              set({
                activeWorktrees: {
                  ...activeWorktrees,
                  [sid]: {
                    isWorktree: msg.payload.isWorktree,
                    branch: msg.payload.branch,
                    path: msg.payload.worktreePath,
                  },
                },
              });
            }
            break;
          }

          case 'file:content':
            set({ activeFile: msg.payload, activeDiff: null });
            break;

          case 'workspace:tree':
            set({ fileTree: msg.payload.tree });
            break;

          case 'workspace:dir': {
            const { path: dirPath, children } = msg.payload;
            const normalized = (dirPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
            if (!normalized) {
              set({ fileTree: children });
            } else {
              const currentTree = get().fileTree;
              const updateChildren = (nodes: import('@harni/types').FileNode[]): import('@harni/types').FileNode[] => {
                return nodes.map((node) => {
                  const nodeNorm = node.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
                  if (nodeNorm === normalized && node.type === 'directory') {
                    return { ...node, children };
                  }
                  if (node.type === 'directory' && node.children) {
                    return { ...node, children: updateChildren(node.children) };
                  }
                  return node;
                });
              };
              set({ fileTree: updateChildren(currentTree) });
            }
            break;
          }

          case 'workspace:info': {
            const info = msg.payload;
            const { folders } = get();
            let changed = false;
            const updatedFolders = folders.map((f) => {
              if (!f.path && f.id === 'folder_default') {
                changed = true;
                return { ...f, path: info.rootPath };
              }
              return f;
            });
            if (changed) {
              saveFoldersToStorage(updatedFolders);
              syncFoldersToDB(updatedFolders);
              set({ workspaceInfo: info, folders: updatedFolders });
            } else {
              set({ workspaceInfo: info });
            }
            break;
          }

          case 'terminal:data':
            if (get().onTerminalDataCallback) {
              get().onTerminalDataCallback!(msg.payload.data);
            }
            break;

          case 'error': {
            console.error('[WS Error]', msg.payload);
            const { sessions, currentSessionId } = get();
            const targetSessionId = (msg.payload as any).sessionId || currentSessionId;
            const currentSession = sessions.find((s) => s.id === targetSessionId);
            const isLimit = isRateLimitError(msg.payload.message, msg.payload.code);
            const payloadDetails = (msg.payload as any).details;
            const parsedRateLimit = isLimit
              ? (payloadDetails && payloadDetails.isRateLimit
                  ? { ...payloadDetails, formattedContent: msg.payload.message }
                  : parseClientRateLimit(msg.payload.message, currentSession?.model))
              : null;

            const errMessage: ChatMessage = isLimit && parsedRateLimit
              ? {
                  id: `err_ratelimit_${Date.now()}`,
                  role: 'assistant',
                  content:
                    parsedRateLimit.formattedContent ||
                    parsedRateLimit.formattedMessage ||
                    msg.payload.message,
                  rateLimitInfo: {
                    isRateLimit: true,
                    limitType: parsedRateLimit.limitType,
                    model: parsedRateLimit.model || currentSession?.model,
                    provider: parsedRateLimit.provider,
                    retryAfter: parsedRateLimit.retryAfter,
                    details: parsedRateLimit.details,
                  },
                  timestamp: Date.now(),
                }
              : {
                  id: `err_${Date.now()}`,
                  role: 'assistant',
                  content: `❌ **執行發生錯誤 (${msg.payload.code})**:\n\n${msg.payload.message}\n\n*💡 請檢查「⚙️ 設定」中的 API Key 或端點設定。*`,
                  timestamp: Date.now(),
                };

            const updatedSessions = sessions.map((s) => {
              if (s.id === targetSessionId) {
                const sMessages = [...(s.messages || []), errMessage];
                return {
                  ...s,
                  messages: sMessages,
                  messageCount: sMessages.length,
                  status: 'error' as AgentStatus,
                  activeThinking: '',
                  pendingApproval: null,
                  updatedAt: Date.now(),
                };
              }
              return s;
            });

            if (targetSessionId === currentSessionId) {
              const currentS = updatedSessions.find((s) => s.id === currentSessionId);
              set({
                status: 'error',
                activeThinking: '',
                pendingApproval: null,
                messages: currentS?.messages || [],
                sessions: updatedSessions,
              });
            } else {
              set({ sessions: updatedSessions });
            }

            saveSessionsToStorage(updatedSessions);
            const targetSession = updatedSessions.find((s) => s.id === targetSessionId);
            if (targetSession) syncSessionToDB(targetSession);
            break;
          }
        }
      } catch (err) {
        console.error('[WS Client] Failed to parse message:', err);
      }
    };
  },

  createFolder: (name, path) => {
    const { folders, ws } = get();
    const newId = `folder_${Date.now()}`;
    const newFolder: WorkspaceFolder = {
      id: newId,
      name: name.trim() || `專案目錄 #${folders.length + 1}`,
      path: path?.trim(),
      createdAt: Date.now(),
      isCollapsed: false,
    };
    const updatedFolders = [...folders, newFolder];
    set({ folders: updatedFolders, activeFolderId: newId });
    saveFoldersToStorage(updatedFolders);
    syncFoldersToDB(updatedFolders);
    get().newSession(newId);

    if (newFolder.path && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'workspace:set',
          payload: { path: newFolder.path, sessionId: get().currentSessionId },
        }),
      );
    }
    return newId;
  },

  updateFolderPath: (folderId, path) => {
    const { folders, ws, activeFolderId } = get();
    const trimmed = path.trim();
    const updated = folders.map((f) =>
      f.id === folderId ? { ...f, path: trimmed || undefined } : f,
    );
    set({ folders: updated });
    saveFoldersToStorage(updated);
    syncFoldersToDB(updated);

    if (folderId === activeFolderId && trimmed && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'workspace:set',
          payload: { path: trimmed },
        }),
      );
    }
  },

  setActiveFolder: (folderId) => {
    const { folders, sessions } = get();
    const targetFolder = folders.find((f) => f.id === folderId);
    if (!targetFolder) return;

    const folderSessions = sessions.filter((s) => s.folderId === folderId);
    if (folderSessions.length > 0) {
      get().switchSession(folderSessions[0]!.id);
    } else {
      get().newSession(folderId);
    }
  },

  syncActiveWorkspace: (targetFolderId) => {
    const { ws, folders, activeFolderId, currentSessionId, sessions } = get();
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const folderId = targetFolderId || currentSession?.folderId || activeFolderId;
    const folder = folders.find((f) => f.id === folderId);
    if (folder?.path && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'workspace:set',
          payload: { path: folder.path, sessionId: currentSessionId },
        }),
      );
    }
  },

  renameFolder: (folderId, name) => {
    const { folders } = get();
    const updated = folders.map((f) =>
      f.id === folderId ? { ...f, name: name.trim() || f.name } : f,
    );
    set({ folders: updated });
    saveFoldersToStorage(updated);
    syncFoldersToDB(updated);
  },

  deleteFolder: (folderId) => {
    const { folders, sessions } = get();
    if (folders.length <= 1) {
      console.warn('[createWorkspaceSlice] Cannot delete the only remaining workspace folder');
      return;
    }
    const remainingFolders = folders.filter((f) => f.id !== folderId);
    const fallbackFolderId = remainingFolders[0]?.id || 'folder_default';

    // Remap any sessions inside this folder to fallback folder
    const updatedSessions = sessions.map((s) =>
      s.folderId === folderId ? { ...s, folderId: fallbackFolderId } : s,
    );

    set({
      folders: remainingFolders,
      sessions: updatedSessions,
      activeFolderId: fallbackFolderId,
    });
    saveFoldersToStorage(remainingFolders);
    saveSessionsToStorage(updatedSessions);
    deleteFolderFromDB(folderId);
    syncFoldersToDB(remainingFolders);
  },

  toggleFolderCollapse: (folderId) => {
    const { folders } = get();
    const updated = folders.map((f) =>
      f.id === folderId ? { ...f, isCollapsed: !f.isCollapsed } : f,
    );
    set({ folders: updated });
    saveFoldersToStorage(updated);
    syncFoldersToDB(updated);
  },

  loadDirectory: (path: string) => {
    const { ws, folders, activeFolderId, currentSessionId, sessions } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const targetFolderId = currentSession?.folderId || activeFolderId;
    const currentFolder = folders.find((f) => f.id === targetFolderId);

    const msg = {
      type: 'workspace:getDir',
      payload: { path, workspaceRoot: currentFolder?.path },
    };
    ws.send(JSON.stringify(msg));
  },

  openFile: (path) => {
    const { ws, folders, activeFolderId, currentSessionId, sessions } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const targetFolderId = currentSession?.folderId || activeFolderId;
    const currentFolder = folders.find((f) => f.id === targetFolderId);

    const msg = {
      type: 'file:open',
      payload: { path, workspaceRoot: currentFolder?.path },
    };
    ws.send(JSON.stringify(msg));
  },

  saveActiveFile: (content) => {
    const { ws, activeFile, folders, activeFolderId, currentSessionId, sessions } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN || !activeFile) return;
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const targetFolderId = currentSession?.folderId || activeFolderId;
    const currentFolder = folders.find((f) => f.id === targetFolderId);

    const msg = {
      type: 'file:save',
      payload: { path: activeFile.path, content, workspaceRoot: currentFolder?.path },
    };
    ws.send(JSON.stringify(msg));
    set({ activeFile: { ...activeFile, content } });
  },

  closeActiveFile: () => {
    set({ activeFile: null });
  },

  setActiveDiff: (diff) => {
    set({ activeDiff: diff });
  },

  fetchSkills: async (refresh = false) => {
    set({ isLoadingSkills: true });
    try {
      const endpoint = refresh ? '/api/skills/refresh' : '/api/skills';
      const method = refresh ? 'POST' : 'GET';
      const res = await apiFetch(endpoint, { method });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.skills)) {
          set({ skills: data.skills });
        }
      }
    } catch (err) {
      console.warn('[createWorkspaceSlice] Failed to fetch skills:', err);
    } finally {
      set({ isLoadingSkills: false });
    }
  },

  rollbackCheckpoint: async (sessionId, checkpointId) => {
    const { ws, currentSessionId } = get();
    const effectiveSessionId = sessionId || currentSessionId;
    set({ isRevertingCheckpoint: true });

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'checkpoint:rollback',
        payload: { sessionId: effectiveSessionId, checkpointId },
      }));
    }

    try {
      const res = await apiFetch('/api/checkpoints/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: effectiveSessionId, checkpointId }),
      });
      const data = await res.json();
      if (data.success) {
        get().loadDirectory('');
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      set({ isRevertingCheckpoint: false });
    }
  },

  mergeWorktree: async (sessionId, commitMessage) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'worktree:merge',
        payload: { sessionId, commitMessage },
      }));
    }

    try {
      const res = await apiFetch('/api/worktrees/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, commitMessage }),
      });
      const data = await res.json();
      if (data.success) {
        const { activeWorktrees } = get();
        const updated = { ...activeWorktrees };
        delete updated[sessionId];
        set({ activeWorktrees: updated });
        get().loadDirectory('');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  discardWorktree: async (sessionId) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'worktree:discard',
        payload: { sessionId },
      }));
    }

    try {
      const res = await apiFetch('/api/worktrees/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (data.success) {
        const { activeWorktrees } = get();
        const updated = { ...activeWorktrees };
        delete updated[sessionId];
        set({ activeWorktrees: updated });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  fetchCheckpoints: async (workspaceRoot) => {
    try {
      const { folders, activeFolderId, workspaceInfo } = get();
      const currentFolder = folders.find((f) => f.id === activeFolderId);
      const root = workspaceRoot || currentFolder?.path || workspaceInfo?.rootPath;
      const query = root ? `?workspaceRoot=${encodeURIComponent(root)}` : '';
      const res = await apiFetch(`/api/checkpoints${query}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.checkpoints)) {
          set({ checkpoints: data.checkpoints });
        }
      }
    } catch (err) {
      console.warn('[createWorkspaceSlice] Failed to fetch checkpoints:', err);
    }
  },

  pruneCheckpoints: async (maxRetained) => {
    const { ws, folders, activeFolderId, workspaceInfo } = get();
    const currentFolder = folders.find((f) => f.id === activeFolderId);
    const root = currentFolder?.path || workspaceInfo?.rootPath;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'checkpoint:prune',
        payload: { workspaceRoot: root, maxRetained },
      }));
    }

    try {
      const res = await apiFetch('/api/checkpoints/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceRoot: root, maxRetained }),
      });
      if (res.ok) {
        await get().fetchCheckpoints(root);
      }
    } catch (err) {
      console.warn('[createWorkspaceSlice] Failed to prune checkpoints:', err);
    }
  },

  sendTerminalInput: (data) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      type: 'terminal:input',
      payload: { data },
    };
    ws.send(JSON.stringify(msg));
  },

  resizeTerminal: (cols, rows) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      type: 'terminal:resize',
      payload: { cols, rows },
    };
    ws.send(JSON.stringify(msg));
  },

  registerTerminalDataCallback: (cb) => {
    set({ onTerminalDataCallback: cb });
  },
});
