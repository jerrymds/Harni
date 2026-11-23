import {
  normalizeAgentMode,
  type AgentMode,
  type AgentStatus,
  type ChatMessage,
  type ChatSession,
  type GoogleAuthInfo,
  type LLMProviderConfig,
  type LLMProviderType,
  type SubagentInstanceInfo,
  type SubagentModelTier,
  type WorkspaceFolder,
} from '@harni/types';

const ACTIVE_TRANSIENT_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  'thinking',
  'executing_tool',
  'streaming',
  'testing',
]);

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  cline: 'cline-pass/deepseek-v4-pro',
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-5.6-sol',
  antigravity: 'gemini-3.8-flash',
  ollama: 'llama3.3',
  openrouter: 'anthropic/claude-3.5-sonnet',
  opencode: 'claude-fable-5',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
  xai: 'grok-3-beta',
  siliconflow: 'deepseek-ai/DeepSeek-V3',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  mistral: 'codestral-latest',
  fireworks: 'accounts/fireworks/models/deepseek-v3',
  cerebras: 'llama-3.3-70b',
  lmstudio: 'local-model',
  vllm: 'default-model',
  custom: 'custom-model',
};

export function loadSavedCustomProviders(): LLMProviderConfig[] {
  try {
    const raw = localStorage.getItem('harni_web_custom_providers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string');
      }
    }
  } catch {}
  return [];
}

export const getApiBase = () => `http://${window.location.hostname}:3001`;

export const getServerAuthToken = (): string => {
  try {
    return (
      localStorage.getItem('harni_web_server_auth_token') ||
      (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_AUTH_TOKEN || '' : '') ||
      (typeof window !== 'undefined'
        ? (window as any).__HARNI_AUTH_TOKEN__ || (window as any).process?.env?.VITE_AUTH_TOKEN || ''
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

let dbSyncSessionTimeout: ReturnType<typeof setTimeout> | null = null;
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

let dbSyncFoldersTimeout: ReturnType<typeof setTimeout> | null = null;
export function syncFoldersToDB(folders: WorkspaceFolder[], immediate = false): Promise<void> {
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
    return doSync();
  }
  if (dbSyncFoldersTimeout) clearTimeout(dbSyncFoldersTimeout);
  return new Promise<void>((resolve) => {
    dbSyncFoldersTimeout = setTimeout(() => {
      void doSync().finally(resolve);
    }, 500);
  });
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
    const raw = localStorage.getItem('harni_web_folders');
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
    localStorage.setItem('harni_web_folders', JSON.stringify(folders));
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
    localStorage.setItem('harni_web_google_auth', JSON.stringify(safe));
  } else {
    localStorage.removeItem('harni_web_google_auth');
  }
}

export function loadGoogleAuthMetadata(): GoogleAuthInfo | null {
  try {
    const raw = localStorage.getItem('harni_web_google_auth');
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
    const raw = localStorage.getItem('harni_web_sessions');
    const savedActiveId = localStorage.getItem('harni_web_current_session_id');
    const savedActiveFolderId = localStorage.getItem('harni_web_active_folder_id');

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
          mode: normalizeAgentMode(s.mode || defaultMode),
          provider: s.provider || defaultProvider,
          model: s.model || defaultModel,
          status: s.status && ACTIVE_TRANSIENT_STATUSES.has(s.status)
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
let saveSessionTimeout: ReturnType<typeof setTimeout> | null = null;
export function saveSessionsToStorage(sessions: ChatSession[], immediate = false): void {
  const executeSave = () => {
    try {
      localStorage.setItem('harni_web_sessions', JSON.stringify(sessions));
    } catch (err) {
      console.warn('[store] Failed to save sessions, attempting pruning:', err);
      try {
        const pruned = sessions.map((s, idx) => {
          if (idx > 5 && s.messages && s.messages.length > 20) {
            return { ...s, messages: s.messages.slice(-20) };
          }
          return s;
        });
        localStorage.setItem('harni_web_sessions', JSON.stringify(pruned));
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
    const raw = localStorage.getItem('harni_web_provider_base_urls');
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
      const single = localStorage.getItem(`harni_web_base_url_${p}`);
      if (single) result[p] = single;
    }
  }
  const legacyBaseUrl = localStorage.getItem('harni_web_base_url');
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

export function loadSavedSubagents(): Record<string, SubagentInstanceInfo[]> {
  try {
    const raw = localStorage.getItem('harni_web_subagents');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const result: Record<string, SubagentInstanceInfo[]> = {};
        for (const [sessionId, list] of Object.entries(parsed)) {
          if (Array.isArray(list)) {
            result[sessionId] = (list as SubagentInstanceInfo[]).map((sub) => {
              if (
                sub.status === 'running' ||
                sub.status === 'pending' ||
                sub.status === 'waiting_for_input'
              ) {
                return {
                  ...sub,
                  streamingText: undefined,
                  streamingThinking: undefined,
                };
              }
              return sub;
            });
          }
        }
        return result;
      }
    }
  } catch {}
  return {};
}

let saveSubagentsTimeout: ReturnType<typeof setTimeout> | null = null;
export function saveSubagentsToStorage(subagents: Record<string, SubagentInstanceInfo[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  if (saveSubagentsTimeout) {
    clearTimeout(saveSubagentsTimeout);
  }
  saveSubagentsTimeout = setTimeout(() => {
    try {
      const sanitized: Record<string, SubagentInstanceInfo[]> = {};
      for (const [sessionId, list] of Object.entries(subagents)) {
        if (Array.isArray(list) && list.length > 0) {
          sanitized[sessionId] = list.map((sub) => {
            const { streamingText: _st, streamingThinking: _sth, ...rest } = sub;
            return rest as SubagentInstanceInfo;
          });
        }
      }
      localStorage.setItem('harni_web_subagents', JSON.stringify(sanitized));
    } catch (err) {
      console.warn('[store] Failed to save subagents to localStorage:', err);
    }
  }, 300);
}

const ALLOWED_SUBAGENT_TIERS: ReadonlyArray<SubagentModelTier> = ['fast', 'reasoning', 'inherit'];

export function sanitizeSubagentTierMap(
  raw: unknown,
): Partial<Record<SubagentModelTier, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const sanitized: Partial<Record<SubagentModelTier, string>> = {};
  for (const tier of ALLOWED_SUBAGENT_TIERS) {
    const value = record[tier];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        sanitized[tier] = trimmed;
      }
    }
  }
  return sanitized;
}

export function sanitizeSubagentModelTierMaps(
  raw: unknown,
): Record<string, Partial<Record<SubagentModelTier, string>>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, Partial<Record<SubagentModelTier, string>>> = {};
  for (const [providerId, rawMap] of Object.entries(raw as Record<string, unknown>)) {
    const clean = sanitizeSubagentTierMap(rawMap);
    if (Object.keys(clean).length > 0) {
      result[providerId] = clean;
    }
  }
  return result;
}

export function loadSavedSubagentModelTierMaps(): Record<
  string,
  Partial<Record<SubagentModelTier, string>>
> {
  try {
    const raw = localStorage.getItem('harni_web_subagent_model_tier_maps');
    if (raw) {
      return sanitizeSubagentModelTierMaps(JSON.parse(raw));
    }
  } catch {}
  return {};
}

const NO_MODIFICATION_PATTERN =
  /^(?:無|无|none|n\/a|nil|沒有|没有|未修改|no\s+files?(?:\s+modified|\s+changed)?)(?:$|\.$|\.\s|[（(\s:：—–]|-\s|-$|修改|變更|变更|任何|檔案|文件)/i;

function stripOuterFormatting(input: string): string {
  let current = input.trim();
  let changed = true;
  while (changed) {
    const prev = current;
    current = current.trim();
    current = current.replace(/^[-*•]\s+/, '').trim();
    if (current.startsWith('**')) {
      current = current.slice(2);
    }
    if (current.endsWith('**')) {
      current = current.slice(0, -2);
    }
    current = current.replace(/^`+/, '').replace(/`+$/, '').trim();
    if (
      (current.startsWith('"') && current.endsWith('"') && current.length >= 2) ||
      (current.startsWith("'") && current.endsWith("'") && current.length >= 2)
    ) {
      current = current.slice(1, -1);
    }
    current = current.trim();
    changed = current !== prev;
  }
  return current;
}

function stripFileProtocol(input: string): string {
  return input
    .trim()
    .replace(/^file:[\\/]+([a-zA-Z]:[\\/])/i, '$1')
    .replace(/^file:(?:\/\/|\/)(?=\/)/i, '')
    .replace(/^file:(?=\/)/i, '')
    .replace(/^file:[\\]+/i, '');
}

function safeDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function normalizeLinkCandidate(raw: string): string {
  let value = stripOuterFormatting(raw);
  value = safeDecodeURIComponent(value);
  value = stripFileProtocol(value);
  value = value.replace(/#L\d+(?:[-–—]L?\d+)?$/i, '').replace(/#.*$/, '');
  return stripOuterFormatting(value);
}

/**
 * 淨化變更檔案路徑：解析 Markdown 連結、剝除 `file:` 協定與行號錨點、
 * 移除後方附帶說明、過濾「無修改」等非路徑描述，並在提供 `workspaceRoot` 時正規化為相對路徑。
 */
export function cleanChangedFilePath(rawPath: string, workspaceRoot?: string): string | null {
  if (typeof rawPath !== 'string') {
    return null;
  }

  let candidate = stripOuterFormatting(rawPath);
  if (!candidate || NO_MODIFICATION_PATTERN.test(candidate)) {
    return null;
  }

  const mdLinkMatch =
    candidate.match(/\[([^\]]+)\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/) ??
    candidate.match(/\[([^\]]+)\]\(([^)]*)\)/);
  if (mdLinkMatch) {
    const label = mdLinkMatch[1] ?? '';
    const target = mdLinkMatch[2] ?? '';
    const cleanedTarget = normalizeLinkCandidate(target);
    const isNonFileScheme = /^[a-zA-Z][a-zA-Z0-9+.-]{1,}:/i.test(cleanedTarget);
    if (
      cleanedTarget &&
      !cleanedTarget.startsWith('#') &&
      !isNonFileScheme &&
      !NO_MODIFICATION_PATTERN.test(cleanedTarget)
    ) {
      candidate = cleanedTarget;
    } else {
      candidate = stripOuterFormatting(label);
      if (/^file:/i.test(candidate)) {
        candidate = safeDecodeURIComponent(candidate);
      }
    }
  } else if (/^file:/i.test(candidate)) {
    candidate = safeDecodeURIComponent(candidate);
  }

  candidate = candidate.replace(/[：].*$/, '');
  candidate = candidate.replace(/\s*:\s+.*$/, '');
  candidate = candidate.replace(/\s+[-–—]\s+.*$/, '');
  candidate = candidate.replace(/\s+[（(][^（）()]*[）)]$/, '');
  candidate = candidate.replace(/[（][^（）]*[）]$/, '');
  candidate = candidate.replace(/#L\d+(?:[-–—]L?\d+)?$/i, '').replace(/#.*$/, '');
  candidate = stripFileProtocol(candidate);
  candidate = stripOuterFormatting(candidate);
  candidate = candidate.replace(/^(.{2,}?):\d+(?:[:-]\d+)*$/, '$1');
  candidate = stripOuterFormatting(candidate);

  if (
    !candidate ||
    /[\r\n]/.test(candidate) ||
    candidate.includes('[') ||
    candidate.includes(']') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]{1,}:/i.test(candidate) ||
    NO_MODIFICATION_PATTERN.test(candidate)
  ) {
    return null;
  }

  const normalizedPath = candidate.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (typeof workspaceRoot === 'string' && workspaceRoot.trim().length > 0) {
    const normRoot = workspaceRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (normRoot.length > 0) {
      const isWindowsDrive = /^[a-zA-Z]:(?:\/|$)/.test(normRoot);
      const matchesExactRoot = isWindowsDrive
        ? normalizedPath.toLowerCase() === normRoot.toLowerCase()
        : normalizedPath === normRoot;
      if (matchesExactRoot) {
        return null;
      }
      const matchesRoot = isWindowsDrive
        ? normalizedPath.toLowerCase().startsWith(`${normRoot.toLowerCase()}/`)
        : normalizedPath.startsWith(`${normRoot}/`);
      if (matchesRoot) {
        const stripped = normalizedPath
          .slice(normRoot.length + 1)
          .replace(/^\/+/, '')
          .replace(/^(?:\.\/)+/, '');
        return stripped || null;
      }
    }
  }

  return normalizedPath || null;
}
