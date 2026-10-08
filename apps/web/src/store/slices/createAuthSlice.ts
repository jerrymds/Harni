import type { StateCreator } from 'zustand';
import type { ChatSession, LLMProviderType, WorkspaceFolder } from '@harni/types';
import type { AgentStoreState, AuthSlice } from '../types.js';
import {
  apiFetch,
  getApiBase,
  loadGoogleAuthMetadata,
  persistGoogleAuthMetadata,
} from '../utils.js';

export const createAuthSlice: StateCreator<AgentStoreState, [], [], AuthSlice> = (set, get) => ({
  credentials: {},
  googleAuthInfo: loadGoogleAuthMetadata(),
  anthropicAuthInfo: null,
  openaiAuthInfo: null,

  fetchGoogleAuthStatus: async () => {
    try {
      const res = await apiFetch('/api/auth/google/status');
      if (res.ok) {
        const data = await res.json();
        set({ googleAuthInfo: data });
        // Sync non-sensitive metadata to localStorage so UI shows logged-in state immediately on refresh
        persistGoogleAuthMetadata(data);
      } else {
        // Server returned not-ok — clear any stale localStorage metadata
        persistGoogleAuthMetadata(null);
      }
    } catch (err) {
      console.warn('[createAuthSlice] Failed to fetch Google auth status:', err);
    }
  },

  saveGoogleConfig: async (clientId?: string, clientSecret?: string): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/auth/google/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      if (res.ok) {
        await get().fetchGoogleAuthStatus();
        return true;
      }
    } catch (err) {
      console.warn('[createAuthSlice] Failed to save Google config:', err);
    }
    return false;
  },

  loginWithGoogle: async (email?: string, name?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const width = 480;
      const height = 620;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      let authWindow: Window | null = null;
      try {
        authWindow = window.open(
          `${getApiBase()}/auth/google/login`,
          'GoogleAuthPopup',
          `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no,location=no`,
        );
      } catch (e) {
        console.warn('[createAuthSlice] Popup open failed:', e);
      }

      let pollTimer: any = null;

      const cleanup = () => {
        window.removeEventListener('message', handleMessage);
        if (pollTimer) clearInterval(pollTimer);
      };

      const handleMessage = async (event: MessageEvent) => {
        if (event.data && event.data.type === 'GOOGLE_AUTH_SUCCESS') {
          cleanup();
          const authData = event.data.data;
          const newAuthInfo = {
            authenticated: true,
            email: authData.email,
            name: authData.name,
            picture: authData.picture,
            authenticatedAt: authData.authenticatedAt,
          };
          set({ googleAuthInfo: newAuthInfo });
          // Persist non-sensitive metadata to localStorage for immediate restore on page refresh
          persistGoogleAuthMetadata(newAuthInfo);
          await get().fetchCredentials();
          await get().fetchModels('antigravity');
          resolve(true);
        }
      };

      window.addEventListener('message', handleMessage);

      // Poll in case popup closes
      pollTimer = setInterval(async () => {
        if (authWindow && authWindow.closed) {
          cleanup();
          await get().fetchGoogleAuthStatus();
          await get().fetchCredentials();
          await get().fetchModels('antigravity');
          resolve(get().googleAuthInfo?.authenticated || false);
        }
      }, 500);

      // If popup was blocked or not allowed, fallback to direct login
      if (!authWindow) {
        cleanup();
        apiFetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name }),
        })
          .then((res) => res.json())
          .then(async (data) => {
            const newAuthInfo = {
              authenticated: true,
              email: data.email,
              name: data.name,
              picture: data.picture,
              authenticatedAt: data.authenticatedAt,
            };
            set({ googleAuthInfo: newAuthInfo });
            // Persist non-sensitive metadata to localStorage
            persistGoogleAuthMetadata(newAuthInfo);
            await get().fetchCredentials();
            await get().fetchModels('antigravity');
            resolve(true);
          })
          .catch(() => resolve(false));
      }
    });
  },

  logoutGoogle: async () => {
    try {
      await apiFetch('/api/auth/google', { method: 'DELETE' });
      set({ googleAuthInfo: { authenticated: false } });
      // Clear localStorage metadata so page refresh shows logged-out state
      persistGoogleAuthMetadata(null);
      await get().fetchCredentials();
    } catch (err) {
      console.warn('[createAuthSlice] Failed to logout Google auth:', err);
    }
  },

  fetchAnthropicAuthStatus: async () => {
    try {
      const res = await apiFetch('/api/auth/anthropic/status');
      if (res.ok) {
        const data = await res.json();
        set({ anthropicAuthInfo: data });
      }
    } catch (err) {
      console.warn('[createAuthSlice] Failed to fetch Claude auth status:', err);
    }
  },

  startAnthropicLogin: async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/auth/anthropic/login?format=json');
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.url) return false;
      window.open(data.url, '_blank', 'noopener,noreferrer');
      return true;
    } catch (err) {
      console.warn('[createAuthSlice] Failed to start Claude login:', err);
      return false;
    }
  },

  submitAnthropicCode: async (code: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/auth/anthropic/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
      set({
        anthropicAuthInfo: {
          authenticated: true,
          email: data.email,
          organization: data.organization,
          plan: data.plan,
          authenticatedAt: data.authenticatedAt,
        },
      });
      await get().fetchCredentials();
      await get().fetchModels('anthropic');
      const claudeModels = get().availableModels['anthropic'] || [];
      if (claudeModels.length > 0 && !claudeModels.some((m) => m.id === get().selectedModel)) {
        get().setModel(claudeModels[0]!.id);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  logoutAnthropic: async () => {
    try {
      await apiFetch('/api/auth/anthropic', { method: 'DELETE' });
      set({ anthropicAuthInfo: { authenticated: false } });
      await get().fetchCredentials();
    } catch (err) {
      console.warn('[createAuthSlice] Failed to logout Claude auth:', err);
    }
  },

  fetchOpenAIAuthStatus: async () => {
    try {
      const res = await apiFetch('/api/auth/openai/status');
      if (res.ok) set({ openaiAuthInfo: await res.json() });
    } catch (err) {
      console.warn('[createAuthSlice] Failed to fetch OpenAI auth status:', err);
    }
  },

  loginWithOpenAI: async (): Promise<boolean> => {
    try {
      const previousAuthenticatedAt = get().openaiAuthInfo?.authenticatedAt || 0;
      const res = await apiFetch('/api/auth/openai/login');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) return false;
      const popup = window.open(data.url, 'OpenAIAuthPopup', 'width=520,height=720,status=no,menubar=no,toolbar=no');
      const deadline = Date.now() + 5 * 60 * 1000;
      return await new Promise<boolean>((resolve) => {
        const timer = setInterval(async () => {
          await get().fetchOpenAIAuthStatus();
          const currentAuth = get().openaiAuthInfo;
          if (currentAuth?.authenticated && (currentAuth.authenticatedAt || 0) > previousAuthenticatedAt) {
            clearInterval(timer);
            try { popup?.close(); } catch {}
            await get().fetchCredentials();
            await get().fetchModels('openai');
            const models = get().availableModels.openai || [];
            if (models.length && !models.some((m) => m.id === get().selectedModel)) get().setModel(models[0]!.id);
            resolve(true);
          } else if (Date.now() >= deadline || (popup && popup.closed)) {
            clearInterval(timer);
            resolve(false);
          }
        }, 700);
      });
    } catch (err) {
      console.warn('[createAuthSlice] Failed to start OpenAI login:', err);
      return false;
    }
  },

  logoutOpenAI: async () => {
    try {
      const res = await apiFetch('/api/auth/openai', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      set({
        openaiAuthInfo: { authenticated: false },
        ...(data.credentials ? { credentials: data.credentials } : {}),
      });
      if (!data.credentials) await get().fetchCredentials();
    } catch (err) {
      console.warn('[createAuthSlice] Failed to logout OpenAI:', err);
      throw err;
    }
  },

  fetchCredentials: async () => {
    try {
      const res = await apiFetch('/api/credentials');
      if (res.ok) {
        const data = await res.json();
        if (data && data.credentials) {
          set({ credentials: data.credentials });
        }
      }
    } catch (err) {
      console.warn('[createAuthSlice] Failed to fetch credentials:', err);
    }
  },

  saveCredential: async (provider: string, apiKey: string) => {
    try {
      const res = await apiFetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.credentials) {
          set({ credentials: data.credentials, customApiKey: '' });
        }
        // Auto refresh models after saving key
        get().fetchModels(provider as LLMProviderType);
      }
    } catch (err) {
      console.warn('[createAuthSlice] Failed to save encrypted credential:', err);
    }
  },

  deleteCredential: async (provider: string) => {
    try {
      const res = await apiFetch(`/api/credentials/${provider}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.credentials) {
          set({ credentials: data.credentials, customApiKey: '' });
        }
        get().fetchModels(provider as LLMProviderType);
      }
    } catch (err) {
      console.warn('[createAuthSlice] Failed to delete credential:', err);
    }
  },

  initFromDB: async () => {
    try {
      // Auto-migrate any legacy plaintext key from localStorage into encrypted backend vault
      const legacyLocalApiKey = localStorage.getItem('cline_web_api_key');
      if (legacyLocalApiKey && legacyLocalApiKey.trim()) {
        const provider = get().selectedProvider;
        await get().saveCredential(provider, legacyLocalApiKey.trim());
        localStorage.removeItem('cline_web_api_key');
      }

      const res = await apiFetch('/api/db/init');
      if (res.ok) {
        const data = await res.json();
        const { folders, sessions, activeSessionId, activeFolderId, settings, credentials } = data;

        let loadedUrls: Record<string, string> = { ...get().providerBaseUrls };
        let loadedContextWindows: Record<string, number> = { ...get().modelContextWindows };
        let loadedGlobalContextWindow: number | null = get().contextWindow;

        if (settings && typeof settings === 'object') {
          for (const [k, v] of Object.entries(settings)) {
            if (k.startsWith('base_url_') && typeof v === 'string') {
              const p = k.replace('base_url_', '');
              loadedUrls[p] = v;
            } else if (k === 'context_window' && typeof v === 'string') {
              const parsed = parseInt(v, 10);
              if (Number.isFinite(parsed) && parsed > 0) {
                loadedGlobalContextWindow = parsed;
              }
            } else if (k.startsWith('context_window_') && typeof v === 'string') {
              const modelKey = k.replace('context_window_', '');
              const parsed = parseInt(v, 10);
              if (Number.isFinite(parsed) && parsed > 0) {
                loadedContextWindows[modelKey] = parsed;
              }
            }
          }
        }

        if (credentials) {
          set({
            credentials,
            providerBaseUrls: loadedUrls,
            contextWindow: loadedGlobalContextWindow,
            modelContextWindows: loadedContextWindows,
          });
        } else {
          set({
            providerBaseUrls: loadedUrls,
            contextWindow: loadedGlobalContextWindow,
            modelContextWindows: loadedContextWindows,
          });
        }

        if (Array.isArray(sessions) && sessions.length > 0) {
          // SQLite has data! Use it as primary source of truth
          const targetSession =
            sessions.find((s: ChatSession) => s.id === activeSessionId) || sessions[0]!;

          const sessionProvider = targetSession.provider || get().selectedProvider;
          const sessionModel = targetSession.model || get().selectedModel;

          set({
            folders: Array.isArray(folders) && folders.length > 0 ? folders : get().folders,
            sessions,
            currentSessionId: targetSession.id,
            activeFolderId: targetSession.folderId || activeFolderId || folders[0]?.id || 'folder_default',
            messages: targetSession.messages || [],
            selectedMode: targetSession.mode || get().selectedMode,
            selectedProvider: sessionProvider,
            selectedModel: sessionModel,
            customBaseUrl: loadedUrls[sessionProvider] || '',
          });

          // Fetch models for the active session's provider
          get().fetchModels(sessionProvider, undefined, loadedUrls[sessionProvider] || undefined);
          return;
        } else {
          // SQLite is empty, check if we have legacy data in localStorage to auto-migrate
          const rawFolders = localStorage.getItem('cline_web_folders');
          const rawSessions = localStorage.getItem('cline_web_sessions');

          if (rawFolders || rawSessions) {
            console.log('[createAuthSlice] Auto-migrating legacy localStorage conversations to SQLite...');
            let legacyFolders: WorkspaceFolder[] = [];
            let legacySessions: ChatSession[] = [];
            try {
              if (rawFolders) legacyFolders = JSON.parse(rawFolders);
              if (rawSessions) legacySessions = JSON.parse(rawSessions);
            } catch (parseErr) {
              console.warn('[createAuthSlice] Failed to parse legacy storage:', parseErr);
            }

            if (legacySessions.length > 0 || legacyFolders.length > 0) {
              await apiFetch('/api/db/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  folders: legacyFolders,
                  sessions: legacySessions,
                }),
              });

              // Re-fetch after import
              const postImportRes = await apiFetch('/api/db/init');
              if (postImportRes.ok) {
                const importedData = await postImportRes.json();
                if (importedData.sessions && importedData.sessions.length > 0) {
                  const targetSession = importedData.sessions[0];
                  const targetProv = targetSession.provider || get().selectedProvider;
                  set({
                    folders: importedData.folders || get().folders,
                    sessions: importedData.sessions,
                    currentSessionId: targetSession.id,
                    activeFolderId: targetSession.folderId || 'folder_default',
                    messages: targetSession.messages || [],
                    selectedMode: targetSession.mode || get().selectedMode,
                    selectedProvider: targetProv,
                    selectedModel: targetSession.model || get().selectedModel,
                    customBaseUrl: loadedUrls[targetProv] || '',
                  });
                  return;
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[createAuthSlice] Failed to initialize from SQLite DB:', err);
    }
  },
});
