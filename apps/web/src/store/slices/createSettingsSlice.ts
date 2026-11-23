import type { StateCreator } from 'zustand';
import {
  normalizeAgentMode,
  type LLMProviderType,
  type ThinkingDepth,
  type WorkflowPluginMetadata,
} from '@harni/types';
import type { AgentStoreState, SettingsSlice } from '../types.js';
import {
  apiFetch,
  DEFAULT_MCP_CONFIG,
  getServerAuthToken,
  loadSavedCustomProviders,
  loadSavedProviderBaseUrls,
  loadSavedSessions,
  loadSavedSubagentModelTierMaps,
  PROVIDER_DEFAULT_MODELS,
  sanitizeSubagentTierMap,
  syncSettingsToDB,
} from '../utils.js';

const savedProvider =
  (localStorage.getItem('harni_web_provider') as LLMProviderType | null) || 'cline';
const savedModel =
  localStorage.getItem('harni_web_model') ||
  localStorage.getItem(`harni_web_model_${savedProvider}`) ||
  PROVIDER_DEFAULT_MODELS[savedProvider as keyof typeof PROVIDER_DEFAULT_MODELS] ||
  '';
const savedMode = normalizeAgentMode(localStorage.getItem('harni_web_mode'));
const initialSessionsData = loadSavedSessions(savedMode, 'folder_default', savedProvider, savedModel);
const initialProviderBaseUrls = loadSavedProviderBaseUrls();

const loadSavedModelContextWindows = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem('harni_web_context_windows');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const savedContextWindow = (() => {
  const raw = localStorage.getItem('harni_web_context_window');
  if (!raw) return null;
  const num = parseInt(raw, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
})();

const ensureGitWorkspacePluginEnabled = (get: () => AgentStoreState): void => {
  const gitPlugin = get().workflowPlugins.find((p) => p.id === 'harni.git-workspace');
  if (gitPlugin && !gitPlugin.enabled) {
    void get().toggleWorkflowPlugin('harni.git-workspace', true);
  }
};

export const createSettingsSlice: StateCreator<AgentStoreState, [], [], SettingsSlice> = (set, get) => ({
  thinkingDepth: ((localStorage.getItem('harni_web_thinking_depth') as ThinkingDepth) || 'medium'),
  autoApprove: localStorage.getItem('harni_web_auto_approve') === 'true',
  customApiKey: '',
  customBaseUrl: initialProviderBaseUrls[initialSessionsData.initialProvider || savedProvider] || '',
  providerBaseUrls: initialProviderBaseUrls,
  customProviderName: localStorage.getItem('harni_web_custom_provider_name') || '',
  customProviders: loadSavedCustomProviders(),
  isSettingsOpen: false,
  theme: localStorage.getItem('harni_web_theme') || 'eye-friendly',
  fontSize: localStorage.getItem('harni_web_font_size') || 'sm',
  codeFont: localStorage.getItem('harni_web_code_font') || 'fira',
  compactMode: localStorage.getItem('harni_web_compact_mode') === 'true',
  mcpEnabled: localStorage.getItem('harni_web_mcp_enabled') === 'true',
  mcpConfig: localStorage.getItem('harni_web_mcp_config') || DEFAULT_MCP_CONFIG,
  serverAuthToken: getServerAuthToken(),
  autoTestEnabled: localStorage.getItem('harni_web_auto_test_enabled') !== 'false',
  autoTestCommand: localStorage.getItem('harni_web_auto_test_command') || '',
  gitCheckpointEnabled: localStorage.getItem('harni_web_git_checkpoint_enabled') !== 'false',
  worktreeIsolationEnabled: localStorage.getItem('harni_web_worktree_isolation_enabled') === 'true',
  subagentsEnabled: localStorage.getItem('harni_web_subagents_enabled') !== 'false',
  subagentModelTierMaps: loadSavedSubagentModelTierMaps(),
  strictOrchestration: localStorage.getItem('harni_web_strict_orchestration') === 'true',
  contextWindow: savedContextWindow,
  modelContextWindows: loadSavedModelContextWindows(),
  quotaInfo: null,
  isLoadingQuota: false,
  antigravityMode: ((localStorage.getItem('harni_web_antigravity_mode') as 'acp' | 'direct') || 'acp'),
  workflowPlugins: [],
  isLoadingPlugins: false,

  setThinkingDepth: (depth) => {
    localStorage.setItem('harni_web_thinking_depth', depth);
    set({ thinkingDepth: depth });
    syncSettingsToDB({ thinking_depth: depth });
  },

  setAutoApprove: (enabled) => {
    localStorage.setItem('harni_web_auto_approve', String(enabled));
    set({ autoApprove: enabled });
    syncSettingsToDB({ auto_approve: String(enabled) });
  },

  setAntigravityMode: (mode) => {
    localStorage.setItem('harni_web_antigravity_mode', mode);
    set({ antigravityMode: mode });
    syncSettingsToDB({ antigravity_bridge_mode: mode });
  },

  setCustomApiKey: (key) => {
    set({ customApiKey: key });
  },

  setCustomBaseUrl: (url) => {
    get().setProviderBaseUrl(get().selectedProvider, url);
  },

  setProviderBaseUrl: (provider, url) => {
    const trimmed = url.trim();
    const updated = { ...get().providerBaseUrls, [provider]: trimmed };
    localStorage.setItem('harni_web_provider_base_urls', JSON.stringify(updated));
    localStorage.setItem(`harni_web_base_url_${provider}`, trimmed);
    if (provider === get().selectedProvider) {
      set({ customBaseUrl: trimmed, providerBaseUrls: updated });
    } else {
      set({ providerBaseUrls: updated });
    }
    syncSettingsToDB({ [`base_url_${provider}`]: trimmed });
  },

  setCustomProviderName: (name) => {
    localStorage.setItem('harni_web_custom_provider_name', name);
    set({ customProviderName: name });
    syncSettingsToDB({ custom_provider_name: name });
  },

  setCustomProviders: (providers) => {
    const serialized = JSON.stringify(providers);
    localStorage.setItem('harni_web_custom_providers', serialized);
    set({ customProviders: providers });
    syncSettingsToDB({ custom_providers: serialized });
  },

  upsertCustomProvider: (provider) => {
    const current = get().customProviders || [];
    const idx = current.findIndex((p) => p.id === provider.id);
    const updated =
      idx >= 0
        ? current.map((p, i) => (i === idx ? { ...p, ...provider } : p))
        : [...current, provider];
    get().setCustomProviders(updated);
    if (provider.defaultBaseUrl && !get().providerBaseUrls[provider.id]) {
      get().setProviderBaseUrl(provider.id, provider.defaultBaseUrl);
    }
  },

  deleteCustomProvider: (providerId) => {
    const current = get().customProviders || [];
    const updated = current.filter((p) => p.id !== providerId);
    get().setCustomProviders(updated);
    get().deleteCredential(providerId);
    if (get().selectedProvider === providerId) {
      get().setProvider('antigravity');
    }
  },

  setTheme: (theme) => {
    localStorage.setItem('harni_web_theme', theme);
    set({ theme });
    syncSettingsToDB({ theme });
  },

  setFontSize: (fontSize) => {
    localStorage.setItem('harni_web_font_size', fontSize);
    set({ fontSize });
    syncSettingsToDB({ font_size: fontSize });
  },

  setCodeFont: (codeFont) => {
    localStorage.setItem('harni_web_code_font', codeFont);
    set({ codeFont });
    syncSettingsToDB({ code_font: codeFont });
  },

  setCompactMode: (compactMode) => {
    localStorage.setItem('harni_web_compact_mode', String(compactMode));
    set({ compactMode });
    syncSettingsToDB({ compact_mode: String(compactMode) });
  },

  setServerAuthToken: (token: string) => {
    try {
      localStorage.setItem('harni_web_server_auth_token', token);
    } catch {}
    set({ serverAuthToken: token });
  },

  setMcpEnabled: (mcpEnabled) => {
    localStorage.setItem('harni_web_mcp_enabled', String(mcpEnabled));
    set({ mcpEnabled });
    syncSettingsToDB({ mcp_enabled: String(mcpEnabled) });
  },

  setMcpConfig: (mcpConfig) => {
    localStorage.setItem('harni_web_mcp_config', mcpConfig);
    set({ mcpConfig });
    syncSettingsToDB({ mcp_config: mcpConfig });
  },

  setAutoTestEnabled: (enabled) => {
    localStorage.setItem('harni_web_auto_test_enabled', String(enabled));
    set({ autoTestEnabled: enabled });
    syncSettingsToDB({ auto_test_enabled: String(enabled) });
  },

  setAutoTestCommand: (cmd) => {
    localStorage.setItem('harni_web_auto_test_command', cmd);
    set({ autoTestCommand: cmd });
    syncSettingsToDB({ auto_test_command: cmd });
  },

  setGitCheckpointEnabled: (enabled) => {
    localStorage.setItem('harni_web_git_checkpoint_enabled', String(enabled));
    set({ gitCheckpointEnabled: enabled });
    syncSettingsToDB({ git_checkpoint_enabled: String(enabled) });
    if (enabled) {
      ensureGitWorkspacePluginEnabled(get);
    }
  },

  setWorktreeIsolationEnabled: (enabled) => {
    localStorage.setItem('harni_web_worktree_isolation_enabled', String(enabled));
    set({ worktreeIsolationEnabled: enabled });
    syncSettingsToDB({ worktree_isolation_enabled: String(enabled) });
    if (enabled) {
      ensureGitWorkspacePluginEnabled(get);
    }
  },

  setSubagentsEnabled: (enabled) => {
    localStorage.setItem('harni_web_subagents_enabled', String(enabled));
    set({ subagentsEnabled: enabled });
    syncSettingsToDB({ subagents_enabled: String(enabled) });
  },

  setSubagentModelTierMap: (provider, tierMap) => {
    const clean = sanitizeSubagentTierMap(tierMap);
    const next = { ...(get().subagentModelTierMaps || {}) };
    if (Object.keys(clean).length > 0) {
      next[provider] = clean;
    } else {
      delete next[provider];
    }
    const serialized = JSON.stringify(next);
    localStorage.setItem('harni_web_subagent_model_tier_maps', serialized);
    set({ subagentModelTierMaps: next });
    syncSettingsToDB({ subagent_model_tier_maps: serialized });
  },

  setStrictOrchestration: (enabled) => {
    localStorage.setItem('harni_web_strict_orchestration', String(enabled));
    set({ strictOrchestration: enabled });
    syncSettingsToDB({ strict_orchestration: String(enabled) });
  },

  setContextWindow: (contextWindow) => {
    if (contextWindow && contextWindow > 0) {
      localStorage.setItem('harni_web_context_window', String(contextWindow));
      syncSettingsToDB({ context_window: String(contextWindow) });
    } else {
      localStorage.removeItem('harni_web_context_window');
      syncSettingsToDB({ context_window: '' });
    }
    set({ contextWindow });
  },

  setModelContextWindow: (modelId, contextWindow) => {
    const current = { ...get().modelContextWindows };
    if (contextWindow && contextWindow > 0) {
      current[modelId] = contextWindow;
      syncSettingsToDB({ [`context_window_${modelId}`]: String(contextWindow) });
    } else {
      delete current[modelId];
      syncSettingsToDB({ [`context_window_${modelId}`]: '' });
    }
    localStorage.setItem('harni_web_context_windows', JSON.stringify(current));
    set({ modelContextWindows: current });
  },

  setSettingsOpen: (open) => {
    set({ isSettingsOpen: open });
    if (open) {
      get().fetchWorkflowPlugins();
      if (get().selectedProvider === 'antigravity') {
        get().fetchModelQuota('antigravity');
      }
    }
  },

  fetchModelQuota: async (providerParam, forceRefresh = false) => {
    const provider = providerParam || get().selectedProvider;
    set({ isLoadingQuota: true });
    try {
      const query = new URLSearchParams({
        provider,
        ...(forceRefresh ? { refresh: 'true' } : {}),
      });
      const res = await apiFetch(`/api/models/quota?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        set({ quotaInfo: data });
        return data;
      }
    } catch (err) {
      console.warn('[createSettingsSlice] Failed to fetch quota info:', err);
    } finally {
      set({ isLoadingQuota: false });
    }
    return null;
  },
  fetchWorkflowPlugins: async () => {
    set({ isLoadingPlugins: true });
    try {
      const res = await apiFetch('/api/plugins');
      if (res.ok) {
        const data = await res.json();
        const plugins: WorkflowPluginMetadata[] = data.plugins || [];
        const autoTestPlugin = plugins.find((p) => p.id === 'harni.auto-test-repair');
        if (autoTestPlugin) {
          localStorage.setItem('harni_web_auto_test_enabled', String(autoTestPlugin.enabled));
          set({ workflowPlugins: plugins, autoTestEnabled: autoTestPlugin.enabled });
        } else {
          set({ workflowPlugins: plugins });
        }
      }
    } catch (err) {
      console.warn('[createSettingsSlice] Failed to fetch workflow plugins:', err);
    } finally {
      set({ isLoadingPlugins: false });
    }
  },

  toggleWorkflowPlugin: async (id: string, enabled: boolean) => {
    const prev = get().workflowPlugins;
    const optimistic = prev.map((p) => (p.id === id ? { ...p, enabled } : p));
    set({
      workflowPlugins: optimistic,
    });

    try {
      const res = await apiFetch('/api/plugins/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        const nextPlugins: WorkflowPluginMetadata[] = data.plugins || optimistic;
        if (data.plugins) {
          set({ workflowPlugins: nextPlugins });
        }
        if (id === 'harni.auto-test-repair') {
          const updatedPlugin = nextPlugins.find((p) => p.id === id);
          const nextEnabled = updatedPlugin ? updatedPlugin.enabled : enabled;
          localStorage.setItem('harni_web_auto_test_enabled', String(nextEnabled));
          set({ autoTestEnabled: nextEnabled });
          syncSettingsToDB({ auto_test_enabled: String(nextEnabled) });
        } else if (id === 'harni.git-workspace') {
          const updatedPlugin = nextPlugins.find((p) => p.id === id);
          const nextEnabled = updatedPlugin ? updatedPlugin.enabled : enabled;
          if (nextEnabled && !get().gitCheckpointEnabled && !get().worktreeIsolationEnabled) {
            get().setGitCheckpointEnabled(true);
          }
        }
      } else {
        set({ workflowPlugins: prev });
      }
    } catch (err) {
      console.warn('[createSettingsSlice] Failed to toggle workflow plugin:', err);
      set({ workflowPlugins: prev });
    }
  },
});
