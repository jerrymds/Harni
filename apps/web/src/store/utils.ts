import type {
  AgentMode,
  ChatMessage,
  ChatSession,
  GoogleAuthInfo,
  LLMProviderType,
  WorkspaceFolder,
} from './types.js';

export const PROVIDER_DEFAULT_MODELS: Record<LLMProviderType, string> = {
  cline: 'cline-pass/deepseek-v4-pro',
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-5.6-sol',
  antigravity: 'gemini-3.7-flash',
  ollama: 'llama3.3',
  openrouter: 'anthropic/claude-3.5-sonnet',
  opencode: 'claude-fable-5',
  custom: 'custom-model',
};

export const getApiBase = () => `http://${window.location.hostname}:3001`;

export const getServerAuthToken = (): string => {
  try {
    return (
      localStorage.getItem('cline_web_server_auth_token') ||
      (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_AUTH_TOKEN || '' : '') ||
      (typeof window !== 'undefined'
        ? (window as any).__CLINE_AUTH_TOKEN__ || (window as any).process?.env?.VITE_AUTH_TOKEN || ''
        : '')
    );
  } catch {
    return '';
  }
};

export const getAuthHeaders = (existingHeaders?: HeadersInit): Record<string, string> => {
  const token = getServerAuthToken();
  const headers: Record<string, string> = {};
  if (existingHeaders) {
    if (typeof Headers !== 'undefined' && existingHeaders instanceof Headers) {
      existingHeaders.forEach((val, key) => {
        headers[key] = val;
      });
    } else if (Array.isArray(existingHeaders)) {
      for (const [key, val] of existingHeaders) {
        headers[key] = val;
      }
    } else {
      Object.assign(headers, existingHeaders);
    }
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-API-Key'] = token;
    headers['X-Auth-Token'] = token;
  }
  return headers;
};

export const apiFetch = async (urlOrPath: string, init: RequestInit = {}): Promise<Response> => {
  const fullUrl = urlOrPath.startsWith('http') ? urlOrPath : `${getApiBase()}${urlOrPath}`;
  const headers = getAuthHeaders(init.headers);
  return fetch(fullUrl, {
    ...init,
    headers,
  });
};

// --- SQLite Backend Sync Helpers ---

let dbSyncSessionTimeout: any = null;
export function syncSessionToDB(session: ChatSession, immediate = false): void {
  const doSync = async () => {
    try {
      await apiFetch('/api/db/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
    } catch (err) {
      console.warn('[store] Failed to sync session to SQLite DB:', err);
    }
  };

  if (immediate) {
    if (dbSyncSessionTimeout) clearTimeout(dbSyncSessionTimeout);
    doSync();
  } else {
    if (dbSyncSessionTimeout) clearTimeout(dbSyncSessionTimeout);
    dbSyncSessionTimeout = setTimeout(doSync, 500);
  }
}

let dbSyncFoldersTimeout: any = null;
export function syncFoldersToDB(folders: WorkspaceFolder[], immediate = false): void {
  const doSync = async () => {
    try {
      await apiFetch('/api/db/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(folders),
      });
    } catch (err) {
      console.warn('[store] Failed to sync folders to SQLite DB:', err);
    }
  };

  if (immediate) {
    if (dbSyncFoldersTimeout) clearTimeout(dbSyncFoldersTimeout);
    doSync();
  } else {
    if (dbSyncFoldersTimeout) clearTimeout(dbSyncFoldersTimeout);
    dbSyncFoldersTimeout = setTimeout(doSync, 500);
  }
}

export async function deleteSessionFromDB(sessionId: string): Promise<void> {
  try {
    await apiFetch(`/api/db/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn('[store] Failed to delete session from SQLite DB:', err);
  }
}

export async function deleteFolderFromDB(folderId: string): Promise<void> {
  try {
    await apiFetch(`/api/db/folders/${folderId}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn('[store] Failed to delete folder from SQLite DB:', err);
  }
}

export async function clearMessagesInDB(sessionId: string): Promise<void> {
  try {
    await apiFetch(`/api/db/sessions/${sessionId}/messages`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn('[store] Failed to clear messages in SQLite DB:', err);
  }
}

export async function syncSettingsToDB(settings: Record<string, string>): Promise<void> {
  try {
    await apiFetch('/api/db/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  } catch (err) {
    console.warn('[store] Failed to sync settings to SQLite DB:', err);
  }
}

// Helper to load persisted folders from localStorage (for immediate fallback render)
export function loadSavedFolders(): WorkspaceFolder[] {
  try {
    const raw = localStorage.getItem('cline_web_folders');
    if (raw) {
      const parsed = JSON.parse(raw) as WorkspaceFolder[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((f) => ({
          ...f,
          id: f.id || `folder_${Date.now()}`,
          name: f.name || 'Project Folder',
          createdAt: typeof f.createdAt === 'number' && !isNaN(f.createdAt) ? f.createdAt : Date.now(),
          isCollapsed: Boolean(f.isCollapsed),
        }));
      }
    }
  } catch (err) {
    console.warn('[store] Failed to load saved folders:', err);
  }

  const defaultFolder: WorkspaceFolder = {
    id: 'folder_default',
    name: '預設工作目錄 (Default Project)',
    createdAt: Date.now(),
    isCollapsed: false,
  };
  return [defaultFolder];
}

// Helper to persist folders to localStorage
export function saveFoldersToStorage(folders: WorkspaceFolder[]): void {
  try {
    localStorage.setItem('cline_web_folders', JSON.stringify(folders));
  } catch (err) {
    console.warn('[store] Failed to save folders:', err);
  }
}

// --- Google Auth metadata localStorage persist helpers ---
export function persistGoogleAuthMetadata(info: GoogleAuthInfo | null): void {
  if (info && info.authenticated) {
    const safe: GoogleAuthInfo = {
      authenticated: true,
      email: info.email,
      name: info.name,
      picture: info.picture,
      authenticatedAt: info.authenticatedAt,
    };
    localStorage.setItem('cline_web_google_auth', JSON.stringify(safe));
  } else {
    localStorage.removeItem('cline_web_google_auth');
  }
}

export function loadGoogleAuthMetadata(): GoogleAuthInfo | null {
  try {
    const raw = localStorage.getItem('cline_web_google_auth');
    if (raw) {
      const parsed = JSON.parse(raw) as GoogleAuthInfo;
      if (parsed && parsed.authenticated) {
        return parsed;
      }
    }
  } catch {}
  return null;
}

// Helper to load persisted sessions with resilient fallback
export function loadSavedSessions(
  defaultMode: AgentMode,
  defaultFolderId: string,
  defaultProvider: LLMProviderType,
  defaultModel: string,
): {
  sessions: ChatSession[];
  activeId: string;
  activeFolderId: string;
  initialMessages: ChatMessage[];
  initialProvider: LLMProviderType;
  initialModel: string;
} {
  try {
    const raw = localStorage.getItem('cline_web_sessions');
    const savedActiveId = localStorage.getItem('cline_web_current_session_id');
    const savedActiveFolderId = localStorage.getItem('cline_web_active_folder_id');

    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sanitized = parsed.map((s) => ({
          ...s,
          id: s.id || `session_${Date.now()}_${Math.random()}`,
          folderId: s.folderId || defaultFolderId,
          title: s.title || 'Conversation',
          createdAt: typeof s.createdAt === 'number' && !isNaN(s.createdAt) ? s.createdAt : Date.now(),
          updatedAt: typeof s.updatedAt === 'number' && !isNaN(s.updatedAt) ? s.updatedAt : Date.now(),
          messageCount: Array.isArray(s.messages) ? s.messages.length : (s.messageCount || 0),
          mode: s.mode || defaultMode,
          provider: s.provider || defaultProvider,
          model: s.model || defaultModel,
          status: (['thinking', 'executing_tool', 'streaming', 'testing'] as any[]).includes(s.status)
            ? ('idle' as const)
            : (s.status || 'idle'),
          activeThinking: '',
          pendingApproval: null,
          pendingQuestion: null,
          messages: Array.isArray(s.messages)
            ? s.messages.map((m) => ({
                ...m,
                id: m.id || `msg_${Date.now()}_${Math.random()}`,
                role: m.role || 'user',
                content: m.content || '',
                timestamp: typeof m.timestamp === 'number' && !isNaN(m.timestamp) ? m.timestamp : Date.now(),
              }))
            : [],
        }));

        const targetSession =
          sanitized.find((s) => s.id === savedActiveId) || sanitized[0]!;

        return {
          sessions: sanitized,
          activeId: targetSession.id,
          activeFolderId: targetSession.folderId || savedActiveFolderId || defaultFolderId,
          initialMessages: targetSession.messages || [],
          initialProvider: targetSession.provider || defaultProvider,
          initialModel: targetSession.model || defaultModel,
        };
      }
    }
  } catch (err) {
    console.warn('[store] Failed to load saved sessions:', err);
  }

  const defaultId = `session_${Date.now()}`;
  const defaultSession: ChatSession = {
    id: defaultId,
    folderId: defaultFolderId,
    title: 'Current Task',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    mode: defaultMode,
    provider: defaultProvider,
    model: defaultModel,
    messages: [],
  };

  return {
    sessions: [defaultSession],
    activeId: defaultId,
    activeFolderId: defaultFolderId,
    initialMessages: [],
    initialProvider: defaultProvider,
    initialModel: defaultModel,
  };
}

// Helper to safely persist sessions to localStorage
let saveSessionTimeout: any = null;
export function saveSessionsToStorage(sessions: ChatSession[], immediate = false): void {
  const executeSave = () => {
    try {
      localStorage.setItem('cline_web_sessions', JSON.stringify(sessions));
    } catch (err) {
      console.warn('[store] Failed to save sessions, attempting pruning:', err);
      try {
        const pruned = sessions.map((s, idx) => {
          if (idx > 5 && s.messages && s.messages.length > 20) {
            return { ...s, messages: s.messages.slice(-20) };
          }
          return s;
        });
        localStorage.setItem('cline_web_sessions', JSON.stringify(pruned));
      } catch (pruneErr) {
        console.error('[store] Failed to write sessions to localStorage:', pruneErr);
      }
    }
  };

  if (immediate) {
    if (saveSessionTimeout) clearTimeout(saveSessionTimeout);
    executeSave();
  } else {
    if (saveSessionTimeout) clearTimeout(saveSessionTimeout);
    saveSessionTimeout = setTimeout(executeSave, 400);
  }
}

export function loadSavedProviderBaseUrls(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const raw = localStorage.getItem('cline_web_provider_base_urls');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        Object.assign(result, parsed);
      }
    }
  } catch {}
  const providers: LLMProviderType[] = ['cline', 'anthropic', 'openai', 'antigravity', 'ollama', 'openrouter', 'opencode', 'custom'];
  for (const p of providers) {
    if (!result[p]) {
      const single = localStorage.getItem(`cline_web_base_url_${p}`);
      if (single) result[p] = single;
    }
  }
  const legacyBaseUrl = localStorage.getItem('cline_web_base_url');
  if (legacyBaseUrl && !result['custom']) {
    result['custom'] = legacyBaseUrl;
  }
  return result;
}

export const DEFAULT_MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
      },
      postgres: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
      },
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', './'],
      },
    },
  },
  null,
  2,
);
