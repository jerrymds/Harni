import type { StateCreator } from 'zustand';
import type { ThinkingDepth } from '@harni/types';
import type { AgentStoreState, SettingsSlice } from '../types.js';
import {
  DEFAULT_MCP_CONFIG,
  getServerAuthToken,
  loadSavedProviderBaseUrls,
  loadSavedSessions,
  PROVIDER_DEFAULT_MODELS,
  syncSettingsToDB,
} from '../utils.js';

const savedProvider = (localStorage.getItem('cline_web_provider') as any) || 'cline';
const savedModel =
  localStorage.getItem('cline_web_model') ||
  localStorage.getItem(`cline_web_model_${savedProvider}`) ||
  PROVIDER_DEFAULT_MODELS[savedProvider as keyof typeof PROVIDER_DEFAULT_MODELS] ||
  '';
const savedMode = (localStorage.getItem('cline_web_mode') as any) || 'code';
const initialSessionsData = loadSavedSessions(savedMode, 'folder_default', savedProvider, savedModel);
const initialProviderBaseUrls = loadSavedProviderBaseUrls();

const loadSavedModelContextWindows = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem('cline_web_context_windows');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const savedContextWindow = (() => {
  const raw = localStorage.getItem('cline_web_context_window');
  if (!raw) return null;
  const num = parseInt(raw, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
})();

export const createSettingsSlice: StateCreator<AgentStoreState, [], [], SettingsSlice> = (set, get) => ({
  thinkingDepth: ((localStorage.getItem('cline_web_thinking_depth') as ThinkingDepth) || 'medium'),
  autoApprove: localStorage.getItem('cline_web_auto_approve') === 'true',
  customApiKey: '',
  customBaseUrl: initialProviderBaseUrls[initialSessionsData.initialProvider || savedProvider] || '',
  providerBaseUrls: initialProviderBaseUrls,
  customProviderName: localStorage.getItem('cline_web_custom_provider_name') || '',
  isSettingsOpen: false,
  theme: localStorage.getItem('cline_web_theme') || 'eye-friendly',
  fontSize: localStorage.getItem('cline_web_font_size') || 'sm',
  codeFont: localStorage.getItem('cline_web_code_font') || 'fira',
  compactMode: localStorage.getItem('cline_web_compact_mode') === 'true',
  mcpEnabled: localStorage.getItem('cline_web_mcp_enabled') === 'true',
  mcpConfig: localStorage.getItem('cline_web_mcp_config') || DEFAULT_MCP_CONFIG,
  serverAuthToken: getServerAuthToken(),
  autoTestEnabled: localStorage.getItem('cline_web_auto_test_enabled') !== 'false',
  autoTestCommand: localStorage.getItem('cline_web_auto_test_command') || '',
  gitCheckpointEnabled: localStorage.getItem('cline_web_git_checkpoint_enabled') !== 'false',
  worktreeIsolationEnabled: localStorage.getItem('cline_web_worktree_isolation_enabled') === 'true',
  subagentsEnabled: localStorage.getItem('cline_web_subagents_enabled') !== 'false',
  contextWindow: savedContextWindow,
  modelContextWindows: loadSavedModelContextWindows(),

  setThinkingDepth: (depth) => {
    localStorage.setItem('cline_web_thinking_depth', depth);
    set({ thinkingDepth: depth });
    syncSettingsToDB({ thinking_depth: depth });
  },

  setAutoApprove: (enabled) => {
    localStorage.setItem('cline_web_auto_approve', String(enabled));
    set({ autoApprove: enabled });
    syncSettingsToDB({ auto_approve: String(enabled) });
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
    localStorage.setItem('cline_web_provider_base_urls', JSON.stringify(updated));
    localStorage.setItem(`cline_web_base_url_${provider}`, trimmed);
    if (provider === get().selectedProvider) {
      set({ customBaseUrl: trimmed, providerBaseUrls: updated });
    } else {
      set({ providerBaseUrls: updated });
    }
    syncSettingsToDB({ [`base_url_${provider}`]: trimmed });
  },

  setCustomProviderName: (name) => {
    localStorage.setItem('cline_web_custom_provider_name', name);
    set({ customProviderName: name });
    syncSettingsToDB({ custom_provider_name: name });
  },

  setTheme: (theme) => {
    localStorage.setItem('cline_web_theme', theme);
    set({ theme });
    syncSettingsToDB({ theme });
  },

  setFontSize: (fontSize) => {
    localStorage.setItem('cline_web_font_size', fontSize);
    set({ fontSize });
    syncSettingsToDB({ font_size: fontSize });
  },

  setCodeFont: (codeFont) => {
    localStorage.setItem('cline_web_code_font', codeFont);
    set({ codeFont });
    syncSettingsToDB({ code_font: codeFont });
  },

  setCompactMode: (compactMode) => {
    localStorage.setItem('cline_web_compact_mode', String(compactMode));
    set({ compactMode });
    syncSettingsToDB({ compact_mode: String(compactMode) });
  },

  setServerAuthToken: (token: string) => {
    try {
      localStorage.setItem('cline_web_server_auth_token', token);
    } catch {}
    set({ serverAuthToken: token });
  },

  setMcpEnabled: (mcpEnabled) => {
    localStorage.setItem('cline_web_mcp_enabled', String(mcpEnabled));
    set({ mcpEnabled });
    syncSettingsToDB({ mcp_enabled: String(mcpEnabled) });
  },

  setMcpConfig: (mcpConfig) => {
    localStorage.setItem('cline_web_mcp_config', mcpConfig);
    set({ mcpConfig });
    syncSettingsToDB({ mcp_config: mcpConfig });
  },

  setAutoTestEnabled: (enabled) => {
    localStorage.setItem('cline_web_auto_test_enabled', String(enabled));
    set({ autoTestEnabled: enabled });
    syncSettingsToDB({ auto_test_enabled: String(enabled) });
  },

  setAutoTestCommand: (cmd) => {
    localStorage.setItem('cline_web_auto_test_command', cmd);
    set({ autoTestCommand: cmd });
    syncSettingsToDB({ auto_test_command: cmd });
  },

  setGitCheckpointEnabled: (enabled) => {
    localStorage.setItem('cline_web_git_checkpoint_enabled', String(enabled));
    set({ gitCheckpointEnabled: enabled });
    syncSettingsToDB({ git_checkpoint_enabled: String(enabled) });
  },

  setWorktreeIsolationEnabled: (enabled) => {
    localStorage.setItem('cline_web_worktree_isolation_enabled', String(enabled));
    set({ worktreeIsolationEnabled: enabled });
    syncSettingsToDB({ worktree_isolation_enabled: String(enabled) });
  },

  setSubagentsEnabled: (enabled) => {
    localStorage.setItem('cline_web_subagents_enabled', String(enabled));
    set({ subagentsEnabled: enabled });
    syncSettingsToDB({ subagents_enabled: String(enabled) });
  },

  setContextWindow: (contextWindow) => {
    if (contextWindow && contextWindow > 0) {
      localStorage.setItem('cline_web_context_window', String(contextWindow));
      syncSettingsToDB({ context_window: String(contextWindow) });
    } else {
      localStorage.removeItem('cline_web_context_window');
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
    localStorage.setItem('cline_web_context_windows', JSON.stringify(current));
    set({ modelContextWindows: current });
  },

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
});
