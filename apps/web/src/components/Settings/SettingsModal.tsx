import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  Check,
  Code2,
  Copy,
  Cpu,
  FileCode,
  FlaskConical,
  FolderTree,
  GitBranch,
  Globe,
  Hash,
  Key,
  Layers,
  Lock,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  Type,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { AgentSkill, LLMProviderType, ModelInfo } from '@harni/types';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';
import { formatTokenCount, resolveModelContextWindow } from '../../utils/modelContext.js';
import { McpManager } from './Mcp/McpManager.js';

type SettingsTab = 'models' | 'tools' | 'skills' | 'mcp' | 'appearance';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    setSettingsOpen,
    selectedProvider,
    setProvider,
    selectedModel,
    setModel,
    contextWindow,
    setContextWindow,
    modelContextWindows,
    setModelContextWindow,
    serverAuthToken,
    setServerAuthToken,
    availableModels,
    isLoadingModels,
    fetchModels,
    customApiKey,
    setCustomApiKey,
    customBaseUrl,
    setCustomBaseUrl,
    customProviderName,
    setCustomProviderName,
    autoApprove,
    setAutoApprove,
    autoTestEnabled,
    setAutoTestEnabled,
    autoTestCommand,
    setAutoTestCommand,
    subagentsEnabled,
    setSubagentsEnabled,
    theme,
    setTheme,
    fontSize,
    setFontSize,
    codeFont,
    setCodeFont,
    compactMode,
    setCompactMode,
    mcpEnabled,
    setMcpEnabled,
    mcpConfig,
    setMcpConfig,
    skills,
    isLoadingSkills,
    fetchSkills,
    credentials,
    fetchCredentials,
    saveCredential,
    deleteCredential,
    providerBaseUrls,
    setProviderBaseUrl,

    anthropicAuthInfo,
    fetchAnthropicAuthStatus,
    startAnthropicLogin,
    submitAnthropicCode,
    logoutAnthropic,
    openaiAuthInfo,
    fetchOpenAIAuthStatus,
    loginWithOpenAI,
    logoutOpenAI,
    gitCheckpointEnabled,
    setGitCheckpointEnabled,
    worktreeIsolationEnabled,
    setWorktreeIsolationEnabled,
    checkpoints,
    rollbackCheckpoint,
    isRevertingCheckpoint,
    currentSessionId,
  } = useAgentStore(
    useShallow((s) => ({
      isSettingsOpen: s.isSettingsOpen,
      setSettingsOpen: s.setSettingsOpen,
      selectedProvider: s.selectedProvider,
      setProvider: s.setProvider,
      selectedModel: s.selectedModel,
      setModel: s.setModel,
      contextWindow: s.contextWindow,
      setContextWindow: s.setContextWindow,
      modelContextWindows: s.modelContextWindows,
      setModelContextWindow: s.setModelContextWindow,
      serverAuthToken: s.serverAuthToken,
      setServerAuthToken: s.setServerAuthToken,
      availableModels: s.availableModels,
      isLoadingModels: s.isLoadingModels,
      fetchModels: s.fetchModels,
      customApiKey: s.customApiKey,
      setCustomApiKey: s.setCustomApiKey,
      customBaseUrl: s.customBaseUrl,
      setCustomBaseUrl: s.setCustomBaseUrl,
      customProviderName: s.customProviderName,
      setCustomProviderName: s.setCustomProviderName,
      autoApprove: s.autoApprove,
      setAutoApprove: s.setAutoApprove,
      autoTestEnabled: s.autoTestEnabled,
      setAutoTestEnabled: s.setAutoTestEnabled,
      autoTestCommand: s.autoTestCommand,
      setAutoTestCommand: s.setAutoTestCommand,
      gitCheckpointEnabled: s.gitCheckpointEnabled,
      setGitCheckpointEnabled: s.setGitCheckpointEnabled,
      worktreeIsolationEnabled: s.worktreeIsolationEnabled,
      setWorktreeIsolationEnabled: s.setWorktreeIsolationEnabled,
      subagentsEnabled: s.subagentsEnabled,
      setSubagentsEnabled: s.setSubagentsEnabled,
      checkpoints: s.checkpoints,
      rollbackCheckpoint: s.rollbackCheckpoint,
      isRevertingCheckpoint: s.isRevertingCheckpoint,
      currentSessionId: s.currentSessionId,
      theme: s.theme,
      setTheme: s.setTheme,
      fontSize: s.fontSize,
      setFontSize: s.setFontSize,
      codeFont: s.codeFont,
      setCodeFont: s.setCodeFont,
      compactMode: s.compactMode,
      setCompactMode: s.setCompactMode,
      mcpEnabled: s.mcpEnabled,
      setMcpEnabled: s.setMcpEnabled,
      mcpConfig: s.mcpConfig,
      setMcpConfig: s.setMcpConfig,
      skills: s.skills,
      isLoadingSkills: s.isLoadingSkills,
      fetchSkills: s.fetchSkills,
      credentials: s.credentials,
      fetchCredentials: s.fetchCredentials,
      saveCredential: s.saveCredential,
      deleteCredential: s.deleteCredential,
      providerBaseUrls: s.providerBaseUrls,
      setProviderBaseUrl: s.setProviderBaseUrl,

      anthropicAuthInfo: s.anthropicAuthInfo,
      fetchAnthropicAuthStatus: s.fetchAnthropicAuthStatus,
      startAnthropicLogin: s.startAnthropicLogin,
      submitAnthropicCode: s.submitAnthropicCode,
      logoutAnthropic: s.logoutAnthropic,
      openaiAuthInfo: s.openaiAuthInfo,
      fetchOpenAIAuthStatus: s.fetchOpenAIAuthStatus,
      loginWithOpenAI: s.loginWithOpenAI,
      logoutOpenAI: s.logoutOpenAI,
    }))
  );


  const [activeTab, setActiveTab] = useState<SettingsTab>('models');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [googleClientIdInput, setGoogleClientIdInput] = useState('');
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState('');
  const [showGcpConfig, setShowGcpConfig] = useState(false);
  const [claudeCodeInput, setClaudeCodeInput] = useState('');
  const [claudeLoginStarted, setClaudeLoginStarted] = useState(false);
  const [claudeSubmitting, setClaudeSubmitting] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [openaiLoggingIn, setOpenaiLoggingIn] = useState(false);
  const [openaiError, setOpenaiError] = useState<string | null>(null);

  // Form State
  const [customModelInput, setCustomModelInput] = useState(selectedModel);
  const [contextInput, setContextInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [serverAuthTokenInput, setServerAuthTokenInput] = useState(serverAuthToken);
  const [baseUrlInput, setBaseUrlInput] = useState(providerBaseUrls[selectedProvider] || '');
  const [providerNameInput, setProviderNameInput] = useState(customProviderName);
  const [autoApproveInput, setAutoApproveInput] = useState(autoApprove);
  const [autoTestEnabledInput, setAutoTestEnabledInput] = useState(autoTestEnabled);
  const [autoTestCommandInput, setAutoTestCommandInput] = useState(autoTestCommand);
  const [gitCheckpointEnabledInput, setGitCheckpointEnabledInput] = useState(gitCheckpointEnabled);
  const [worktreeIsolationEnabledInput, setWorktreeIsolationEnabledInput] = useState(worktreeIsolationEnabled);
  const [subagentsEnabledInput, setSubagentsEnabledInput] = useState(subagentsEnabled);
  const [themeInput, setThemeInput] = useState(theme);
  const [fontSizeInput, setFontSizeInput] = useState(fontSize);
  const [codeFontInput, setCodeFontInput] = useState(codeFont);
  const [compactModeInput, setCompactModeInput] = useState(compactMode);
  const [mcpEnabledInput, setMcpEnabledInput] = useState(mcpEnabled);
  const [mcpConfigInput, setMcpConfigInput] = useState(mcpConfig);
  const [mcpJsonError, setMcpJsonError] = useState<string | null>(null);

  // Store initial appearance to revert on cancel
  const [initialAppearance, setInitialAppearance] = useState({
    theme,
    fontSize,
    codeFont,
    compactMode,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [viewingSkill, setViewingSkill] = useState<AgentSkill | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  useEffect(() => {
    if (isSettingsOpen) {
      setCustomModelInput(selectedModel);
      const initialCtx = (selectedModel && modelContextWindows[selectedModel]) || contextWindow;
      setContextInput(initialCtx ? String(initialCtx) : '');
      setServerAuthTokenInput(serverAuthToken);
      const currentProviderBaseUrl = providerBaseUrls[selectedProvider] || '';
      setBaseUrlInput(currentProviderBaseUrl);
      setApiKeyInput(credentials[selectedProvider]?.maskedKey || '');
      setProviderNameInput(customProviderName);
      setAutoApproveInput(autoApprove);
      setAutoTestEnabledInput(autoTestEnabled);
      setAutoTestCommandInput(autoTestCommand);
      setGitCheckpointEnabledInput(gitCheckpointEnabled);
      setWorktreeIsolationEnabledInput(worktreeIsolationEnabled);
      setSubagentsEnabledInput(subagentsEnabled);
      setThemeInput(theme);
      setFontSizeInput(fontSize);
      setCodeFontInput(codeFont);
      setCompactModeInput(compactMode);
      setInitialAppearance({
        theme,
        fontSize,
        codeFont,
        compactMode,
      });
      setMcpEnabledInput(mcpEnabled);
      setMcpConfigInput(mcpConfig);
      fetchCredentials().then(() => {
        const latest = useAgentStore.getState().credentials[selectedProvider];
        if (latest?.maskedKey) {
          setApiKeyInput(latest.maskedKey);
        }
      });
      fetchAnthropicAuthStatus();
      fetchOpenAIAuthStatus();
      fetchModels(selectedProvider, undefined, currentProviderBaseUrl || undefined);
      fetchSkills();
    }
  }, [isSettingsOpen]);




  if (!isSettingsOpen) return null;

  // Real, live models returned from the ModelService / API
  const rawLiveModels: ModelInfo[] = availableModels[selectedProvider] || [];
  const liveModels = selectedProvider === 'cline'
    ? rawLiveModels.filter((m) => m.id.startsWith('cline-pass/') || m.id.startsWith('deepseek/'))
    : rawLiveModels;

  // Filter models based on search query
  const filteredModels = liveModels.filter(
    (m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const currentTargetModel = customModelInput.trim() || selectedModel;
  const currentModelInfo = rawLiveModels.find((m) => m.id === currentTargetModel);
  const defaultModelContext = resolveModelContextWindow(
    currentTargetModel,
    selectedProvider,
    currentModelInfo,
  );
  const parsedCustomContext = parseInt(contextInput.trim(), 10);
  const hasCustomContext = Number.isFinite(parsedCustomContext) && parsedCustomContext > 0;

  const handleProviderChange = (newProvider: LLMProviderType) => {
    setProvider(newProvider);
    const targetBaseUrl = providerBaseUrls[newProvider] || '';
    setBaseUrlInput(targetBaseUrl);
    setApiKeyInput(credentials[newProvider]?.maskedKey || '');

    if (newProvider === 'anthropic') {
      fetchAnthropicAuthStatus();
    }
    if (newProvider === 'openai') fetchOpenAIAuthStatus();
    fetchModels(newProvider, undefined, targetBaseUrl || undefined);
  };

  const handleSelectModel = (modelId: string) => {
    setCustomModelInput(modelId);
    const existing = modelContextWindows[modelId];
    if (existing) {
      setContextInput(String(existing));
    } else {
      setContextInput('');
    }
  };

  // Live preview handlers for appearance
  const handleLiveThemeChange = (newTheme: string) => {
    setThemeInput(newTheme);
    setTheme(newTheme); // Live preview immediately!
  };

  const handleLiveFontSizeChange = (newSize: string) => {
    setFontSizeInput(newSize);
    setFontSize(newSize); // Live preview immediately!
  };

  const handleLiveCodeFontChange = (newFont: string) => {
    setCodeFontInput(newFont);
    setCodeFont(newFont); // Live preview immediately!
  };

  const handleLiveCompactToggle = () => {
    const next = !compactModeInput;
    setCompactModeInput(next);
    setCompactMode(next); // Live preview immediately!
  };

  const handleCancel = () => {
    // Revert live changes
    setTheme(initialAppearance.theme);
    setFontSize(initialAppearance.fontSize);
    setCodeFont(initialAppearance.codeFont);
    setCompactMode(initialAppearance.compactMode);
    setSettingsOpen(false);
  };

  const handleSave = () => {
    // Validate MCP JSON if modified
    if (mcpEnabledInput) {
      try {
        JSON.parse(mcpConfigInput);
        setMcpJsonError(null);
      } catch (err: any) {
        setMcpJsonError('MCP 配置 JSON 格式錯誤：' + err.message);
        setActiveTab('mcp');
        return;
      }
    }

    const currentMasked = credentials[selectedProvider]?.maskedKey || '';
    const trimmedKey = apiKeyInput.trim();

    if (!trimmedKey) {
      if (credentials[selectedProvider]?.configured) {
        deleteCredential(selectedProvider);
      }
    } else if (trimmedKey !== currentMasked) {
      saveCredential(selectedProvider, trimmedKey);
    }

    const trimmedModel = customModelInput.trim();
    setModel(trimmedModel);
    const parsedCtx = parseInt(contextInput.trim(), 10);
    const validCustomCtx = Number.isFinite(parsedCtx) && parsedCtx > 0 ? parsedCtx : null;
    setContextWindow(validCustomCtx);
    if (trimmedModel) {
      setModelContextWindow(trimmedModel, validCustomCtx);
    }

    setServerAuthToken(serverAuthTokenInput.trim());
    setProviderBaseUrl(selectedProvider, baseUrlInput.trim());
    setCustomProviderName(providerNameInput.trim());
    setAutoApprove(autoApproveInput);
    setAutoTestEnabled(autoTestEnabledInput);
    setAutoTestCommand(autoTestCommandInput.trim());
    setGitCheckpointEnabled(gitCheckpointEnabledInput);
    setWorktreeIsolationEnabled(worktreeIsolationEnabledInput);
    setSubagentsEnabled(subagentsEnabledInput);
    setTheme(themeInput);
    setFontSize(fontSizeInput);
    setCodeFont(codeFontInput);
    setCompactMode(compactModeInput);
    setMcpEnabled(mcpEnabledInput);
    setMcpConfig(mcpConfigInput);

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      setSettingsOpen(false);
    }, 400);
  };

  const handleRefreshModels = () => {
    const currentMasked = credentials[selectedProvider]?.maskedKey || '';
    const trimmedKey = apiKeyInput.trim();
    const effectiveKey = trimmedKey && trimmedKey !== currentMasked ? trimmedKey : undefined;
    fetchModels(selectedProvider, effectiveKey, baseUrlInput.trim() || undefined);
  };

  const handleCopySkillTemplate = () => {
    const template = `---
name: my_custom_skill
description: 自訂專業工作流程說明
category: workflow
tools: execute_command, read_file, replace_file_content
---

### 標準作業程序 (SOP):
1. 步驟一：檢查專案相關檔案
2. 步驟二：執行分析或修改
3. 步驟三：驗證結果
`;
    navigator.clipboard.writeText(template);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 select-none animate-in fade-in duration-200">
      <div className="flex w-full max-w-3xl flex-col rounded-3xl border border-ag-border bg-ag-panel shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-ag-border px-6 bg-ag-sidebar">
          <div className="flex items-center space-x-2.5 text-sm font-semibold text-ag-textPrimary">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-ag-primaryLight text-ag-primary border border-ag-border shadow-soft">
              <Zap className="h-4 w-4" />
            </div>
            <span>系統與偏好設定 (Settings & Preferences)</span>
          </div>
          <button
            onClick={handleCancel}
            className="rounded-xl p-1.5 text-ag-textMuted hover:bg-ag-panel hover:text-ag-textPrimary transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Navigation Bar */}
        <div className="flex border-b border-ag-border bg-ag-sidebar/70 px-4 pt-2 gap-1.5 overflow-x-auto custom-scrollbar">
          {[
            { id: 'models', label: '模型 (Models)', icon: Cpu },
            { id: 'tools', label: '工具 (Tools)', icon: Wrench },
            { id: 'skills', label: '技能 (Skills)', icon: Sparkles },
            { id: 'mcp', label: 'MCP', icon: Server },
            { id: 'appearance', label: '外觀 (Appearance)', icon: Palette },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as SettingsTab)}
                className={`flex items-center space-x-2 py-2 px-3.5 text-xs font-medium rounded-t-xl transition-all cursor-pointer ${
                  isActive
                    ? 'border-b-2 border-ag-primary bg-ag-panel text-ag-primary font-semibold shadow-soft'
                    : 'text-ag-textMuted hover:text-ag-textPrimary hover:bg-ag-panel/50'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-ag-primary' : 'text-ag-textMuted'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Contents */}
        <div className="max-h-[68vh] overflow-y-auto p-6 space-y-6 text-xs text-ag-textSecondary bg-ag-panel">
          {/* ================= TAB 1: MODELS ================= */}
          {activeTab === 'models' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* 1. Provider Selection */}
              <div className="space-y-2.5">
                <label className="flex items-center space-x-2 font-medium text-slate-800 text-[12.5px]">
                  <Cpu className="h-4 w-4 text-ag-blue" />
                  <span>大語言模型服務商 (LLM Provider)</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: 'antigravity', name: 'Google Antigravity', icon: '🌌', desc: 'Gemini 官方額度池' },
                    { id: 'cline', name: 'Cline 官方 API', icon: '⚡', desc: 'api.cline.bot' },
                    { id: 'anthropic', name: 'Anthropic Claude', icon: '🧠', desc: 'Official API' },
                    { id: 'openai', name: 'OpenAI GPT', icon: '🤖', desc: 'api.openai.com' },
                    { id: 'openrouter', name: 'OpenRouter', icon: '🌐', desc: 'openrouter.ai' },
                    { id: 'opencode', name: 'OpenCode', icon: '💻', desc: 'opencode.ai/zen' },
                    { id: 'ollama', name: 'Ollama 本地模型', icon: '🦙', desc: 'Local daemon' },
                    {
                      id: 'custom',
                      name: providerNameInput || customProviderName || '自訂服務商',
                      icon: '🛠️',
                      desc: 'OpenAI 相容網關',
                    },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleProviderChange(p.id as LLMProviderType)}
                      className={`flex flex-col rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                        selectedProvider === p.id
                          ? 'border-ag-blue bg-blue-50/80 text-blue-900 shadow-soft'
                          : 'border-ag-border bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <span className="text-lg">{p.icon}</span>
                        <span className="font-semibold text-slate-800 truncate">{p.name}</span>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 mt-1">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Provider Name Input */}
              {selectedProvider === 'custom' && (
                <div className="space-y-1.5 p-3.5 border border-ag-blue/40 rounded-2xl bg-blue-50/40">
                  <label className="flex items-center space-x-1.5 font-medium text-blue-900">
                    <Tag className="h-3.5 w-3.5 text-ag-blue" />
                    <span>自訂服務商名稱 (Custom Provider Name / Label)</span>
                  </label>
                  <input
                    type="text"
                    value={providerNameInput}
                    onChange={(e) => setProviderNameInput(e.target.value)}
                    placeholder="例如: Groq AI, vLLM, OpenRouter, 公司私有網關..."
                    className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>
              )}

              {/* 2. Provider Config: Google Auth for Antigravity, or Base URL & API Key for others */}
              {selectedProvider === 'antigravity' ? (
                <div className="space-y-4">
                  {/* Antigravity Bridge URL */}
                  <div className="rounded-2xl border border-ag-border bg-ag-panel p-4 space-y-2 shadow-soft">
                    <div className="flex items-center space-x-2">
                      <Globe className="h-4 w-4 text-ag-blue" />
                      <span className="text-xs font-semibold text-slate-800">外部 Antigravity Bridge URL (選填)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      若要使用自建的 Antigravity Bridge 服務，請在此填入其 URL。
                    </p>
                    <input
                      type="text"
                      value={baseUrlInput}
                      onChange={(e) => setBaseUrlInput(e.target.value)}
                      placeholder="例如: http://localhost:8000"
                      className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedProvider === 'anthropic' && (
                    <div className="rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50/80 via-amber-50/60 to-yellow-50/60 p-5 space-y-4 shadow-soft">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start space-x-3.5">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white border border-orange-200 shadow-soft text-2xl">
                            🧡
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-slate-900 text-sm">使用 Claude 訂閱登入 (Pro / Max)</span>
                            {anthropicAuthInfo?.authenticated || credentials['anthropic-oauth']?.configured ? (
                              <span className="inline-flex items-center space-x-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 font-medium text-[10.5px] border border-emerald-300">
                                <Check className="h-3 w-3" />
                                <span>已完成認證</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 font-medium text-[10.5px] border border-amber-300">
                                <AlertCircle className="h-3 w-3" />
                                <span>尚未登入</span>
                              </span>
                            )}
                          </div>
                          <p className="text-[11.5px] text-slate-600 leading-relaxed max-w-lg">
                            採 <strong>Claude Code 相容</strong> 的 Anthropic 官方 OAuth：以 claude.ai 帳號授權後，<strong>直接使用 Claude Pro / Max 訂閱額度</strong>驅動 Agent，無需 API Key。
                          </p>
                          {(anthropicAuthInfo?.email || credentials['anthropic-oauth']?.configured) && (
                            <div className="flex items-center space-x-1.5 font-mono text-[11px] text-orange-900 font-medium pt-0.5">
                              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                              <span>
                                授權帳號：{anthropicAuthInfo?.email || credentials['anthropic-oauth']?.maskedKey || 'claude 訂閱帳號'}
                                {anthropicAuthInfo?.plan ? `（${anthropicAuthInfo.plan}）` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-end gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            setClaudeError(null);
                            const ok = await startAnthropicLogin();
                            setClaudeLoginStarted(ok);
                            if (!ok) setClaudeError('無法開啟授權頁面');
                          }}
                          className="flex items-center space-x-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white px-4 py-2 text-xs font-semibold shadow-soft cursor-pointer transition-all"
                        >
                          <Key className="h-3.5 w-3.5" />
                          <span>
                            {anthropicAuthInfo?.authenticated || credentials['anthropic-oauth']?.configured
                              ? '重新登入 Claude'
                              : '使用 Claude 登入'}
                          </span>
                        </button>
                        {(anthropicAuthInfo?.authenticated || credentials['anthropic-oauth']?.configured) && (
                          <button
                            type="button"
                            onClick={() => logoutAnthropic()}
                            className="text-[11px] text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
                          >
                            解除帳號綁定
                          </button>
                        )}
                      </div>
                    </div>

                    {claudeLoginStarted && (
                      <div className="space-y-2 rounded-xl border border-orange-200 bg-white/70 p-3">
                        <p className="text-[11px] text-slate-600">
                          在新分頁完成授權後，claude.ai 會顯示一段授權碼（<code className="font-mono">code#state</code>），複製整段貼到下方：
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={claudeCodeInput}
                            onChange={(e) => setClaudeCodeInput(e.target.value)}
                            placeholder="貼上授權碼 code#state..."
                            className="flex-1 rounded-lg border border-ag-border bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-orange-400"
                          />
                          <button
                            type="button"
                            disabled={claudeSubmitting || !claudeCodeInput.trim()}
                            onClick={async () => {
                              setClaudeSubmitting(true);
                              setClaudeError(null);
                              const r = await submitAnthropicCode(claudeCodeInput);
                              setClaudeSubmitting(false);
                              if (r.ok) {
                                setClaudeCodeInput('');
                                setClaudeLoginStarted(false);
                              } else {
                                setClaudeError(r.error || '交換失敗');
                              }
                            }}
                            className="rounded-lg bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 text-xs font-semibold shadow-soft cursor-pointer disabled:opacity-50"
                          >
                            {claudeSubmitting ? '驗證中...' : '完成登入'}
                          </button>
                        </div>
                        {claudeError && (
                          <p className="text-[10.5px] text-rose-600 flex items-center space-x-1">
                            <AlertCircle className="h-3 w-3" />
                            <span>{claudeError}</span>
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center space-x-1.5 text-[10.5px] text-slate-500 pt-1 border-t border-orange-200/60">
                      <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>Access / Refresh Token 皆以 AES-256-GCM 加密儲存於本地端 SQLite，並自動續期。</span>
                    </div>
                  </div>
                )}
                {selectedProvider === 'openai' && (
                  <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50/80 via-teal-50/60 to-cyan-50/60 p-5 space-y-4 shadow-soft">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start space-x-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white border border-emerald-200 shadow-soft text-2xl">🤖</div>
                        <div className="space-y-1.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-slate-900 text-sm">使用 OpenAI 訂閱登入 (Plus / Pro)</span>
                            {openaiAuthInfo?.authenticated || credentials['openai-oauth']?.configured ? (
                              <span className="inline-flex items-center space-x-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 font-medium text-[10.5px] border border-emerald-300"><Check className="h-3 w-3" /><span>已完成認證</span></span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 font-medium text-[10.5px] border border-amber-300"><AlertCircle className="h-3 w-3" /><span>尚未登入</span></span>
                            )}
                          </div>
                          <p className="text-[11.5px] text-slate-600 leading-relaxed max-w-lg">
                            透過 <strong>Codex 相容的 OpenAI OAuth</strong> 登入 ChatGPT，使用 Plus / Pro 方案內含的 Codex 額度。這與下方 API Key 的獨立 API 計費不同。
                          </p>
                          {(openaiAuthInfo?.email || credentials['openai-oauth']?.configured) && (
                            <div className="flex items-center space-x-1.5 font-mono text-[11px] text-emerald-900 font-medium pt-0.5">
                              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                              <span>授權帳號：{openaiAuthInfo?.email || credentials['openai-oauth']?.maskedKey || 'OpenAI 訂閱帳號'}{openaiAuthInfo?.plan ? `（${openaiAuthInfo.plan}）` : ''}</span>
                            </div>
                          )}
                          {openaiError && <p className="text-[10.5px] text-rose-600">{openaiError}</p>}
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-end gap-2 shrink-0">
                        <button type="button" disabled={openaiLoggingIn} onClick={async () => {
                          setOpenaiLoggingIn(true); setOpenaiError(null);
                          const ok = await loginWithOpenAI();
                          if (!ok) setOpenaiError('登入未完成，請重試並確認本機 1455 連接埠可用。');
                          setOpenaiLoggingIn(false);
                        }} className="flex items-center space-x-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-4 py-2 text-xs font-semibold shadow-soft cursor-pointer transition-all disabled:opacity-50">
                          <Key className="h-3.5 w-3.5" /><span>{openaiLoggingIn ? '等待登入...' : openaiAuthInfo?.authenticated || credentials['openai-oauth']?.configured ? '重新登入 OpenAI' : '使用 OpenAI 登入'}</span>
                        </button>
                        {(openaiAuthInfo?.authenticated || credentials['openai-oauth']?.configured) && (
                          <button type="button" onClick={async () => {
                            setOpenaiError(null);
                            try {
                              await logoutOpenAI();
                            } catch (err) {
                              setOpenaiError(`解除綁定失敗：${err instanceof Error ? err.message : String(err)}`);
                            }
                          }} className="text-[11px] text-slate-500 hover:text-rose-600 transition-colors cursor-pointer">解除帳號綁定</button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-1.5 text-[10.5px] text-slate-500 pt-1 border-t border-emerald-200/60">
                      <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" /><span>Access / Refresh Token 以 AES-256-GCM 加密儲存於本機 SQLite，並在到期前自動續期。</span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                      <Globe className="h-3.5 w-3.5 text-ag-blue" />
                      <span>API 端點 (Base URL)</span>
                      {selectedProvider === 'custom' && (
                        <span className="text-[10.5px] text-ag-blue font-normal">（必填）</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={baseUrlInput}
                      onChange={(e) => setBaseUrlInput(e.target.value)}
                      placeholder={
                        selectedProvider === 'cline'
                          ? '預設: https://api.cline.bot/api/v1 (未自訂則留空)'
                          : selectedProvider === 'anthropic'
                            ? '預設: https://api.anthropic.com/v1 (未自訂則留空)'
                            : selectedProvider === 'openai'
                              ? '預設: https://api.openai.com/v1 (未自訂則留空)'
                              : selectedProvider === 'openrouter'
                                ? '預設: https://openrouter.ai/api/v1 (未自訂則留空)'
                                : selectedProvider === 'opencode'
                                  ? '預設: https://opencode.ai/zen/v1 (未自訂則留空)'
                                  : selectedProvider === 'ollama'
                                    ? '預設: http://localhost:11434 (未自訂則留空)'
                                    : '例如: https://api.groq.com/openai/v1 或 http://localhost:8000/v1'
                      }
                      className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                      <Key className="h-3.5 w-3.5 text-amber-500" />
                      <span>API Key</span>
                      {selectedProvider === 'custom' && (
                        <span className="text-[10.5px] text-slate-400 font-normal">（若免密可留空）</span>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={
                          selectedProvider === 'custom'
                            ? '自訂 API Key (如 sk-..., gsk-... 或本機留空)'
                            : selectedProvider === 'openrouter'
                              ? '輸入 OpenRouter API Key (sk-or-v1-...)'
                              : selectedProvider === 'opencode'
                                ? '輸入 OpenCode Zen API Key'
                                : '輸入 API Key (將使用 AES-256-GCM 安全加密儲存)'
                        }
                        className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft pr-8"
                      />
                      {apiKeyInput && (
                        <button
                          type="button"
                          onClick={() => setApiKeyInput('')}
                          title="清空金鑰"
                          className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center space-x-1 text-[10px] text-slate-400">
                      <Lock className="h-3 w-3 text-slate-400" />
                      <span>AES-256-GCM 欄位加密儲存於後端 SQLite，不外洩至 localStorage 或 Git。</span>
                    </div>
                  </div>
                </div>
                </div>
              )}

              {/* 3. Live Model Selection & Search */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                    <Layers className="h-3.5 w-3.5 text-ag-blue" />
                    <span>可選模型清單 ({liveModels.length} 款可用)</span>
                  </label>
                  <button
                    onClick={handleRefreshModels}
                    disabled={isLoadingModels}
                    className="flex items-center space-x-1.5 text-xs text-ag-blue hover:text-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    <span>從 API 重新整理</span>
                  </button>
                </div>

                {/* Search filter input */}
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜尋模型名稱或 Model ID (例如: deepseek, kimi, glm, qwen, llama)..."
                    className="w-full rounded-xl border border-ag-border bg-white pl-9 pr-3.5 py-2 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>

                {/* Models list */}
                {filteredModels.length > 0 ? (
                  <div className="space-y-3 max-h-52 overflow-y-auto p-1.5 border border-ag-border rounded-2xl bg-ag-sidebar/30 custom-scrollbar">
                    {selectedProvider === 'cline' ? (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-semibold text-amber-800 flex items-center space-x-1">
                          <Sparkles className="h-3 w-3 text-amber-500" />
                          <span>Cline 官方推薦模型 ({filteredModels.length} 款 Cline Pass)</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                          {filteredModels.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => handleSelectModel(model.id)}
                              className={`flex flex-col rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                                customModelInput === model.id
                                  ? 'border-ag-blue bg-blue-50/80 text-blue-900 shadow-soft'
                                  : 'border-ag-border bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                              }`}
                            >
                              <span className="font-semibold text-slate-800 truncate">{model.name || model.id}</span>
                              <span className="font-mono text-[10px] text-amber-700 truncate">{model.id}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-semibold text-slate-600 flex items-center space-x-1">
                          <Layers className="h-3 w-3 text-ag-blue" />
                          <span>可用模型 ({filteredModels.length} 款)</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                          {filteredModels.slice(0, 50).map((model) => (
                            <button
                              key={model.id}
                              onClick={() => handleSelectModel(model.id)}
                              className={`flex flex-col rounded-xl border p-2 text-left transition-all cursor-pointer ${
                                customModelInput === model.id
                                  ? 'border-ag-blue bg-blue-50/80 text-blue-900 shadow-soft'
                                  : 'border-ag-border bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                              }`}
                            >
                              <span className="font-semibold text-slate-800 truncate text-xs">{model.name || model.id}</span>
                              <span className="font-mono text-[9.5px] text-slate-400 truncate">{model.id}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-ag-border bg-ag-sidebar/20 p-4 text-center text-slate-500">
                    {isLoadingModels ? (
                      <div className="flex items-center justify-center space-x-2 text-ag-blue">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>正在請求 /models 端點獲取即時模型清單...</span>
                      </div>
                    ) : (
                      <p>尚未從 API 取得模型清單，可直接在下方填入自訂 Model ID。</p>
                    )}
                  </div>
                )}
              </div>

              {/* 4. Selected Model & Context Window Configuration */}
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Model ID */}
                  <div className="space-y-1.5">
                    <label className="flex items-center space-x-1.5 font-medium text-slate-800 text-[12.5px]">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      <span>當前選擇 / 自訂模型 ID (Model ID)</span>
                    </label>
                    <input
                      type="text"
                      value={customModelInput}
                      onChange={(e) => setCustomModelInput(e.target.value)}
                      placeholder="例如: llama-3.3-70b-versatile, claude-3-5-sonnet-20241022..."
                      className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft"
                    />
                  </div>

                  {/* Context Window / 上下文長度限制 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center space-x-1.5 font-medium text-slate-800 text-[12.5px]">
                        <Sliders className="h-3.5 w-3.5 text-ag-blue" />
                        <span>上下文限制 (Context Window / Tokens)</span>
                      </label>
                      <span className="font-mono text-[10.5px]">
                        {hasCustomContext ? (
                          <span className="text-ag-blue font-semibold">
                            已自訂: {formatTokenCount(parsedCustomContext)}
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            預設: {formatTokenCount(defaultModelContext)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        min="1024"
                        max="10000000"
                        step="1024"
                        value={contextInput}
                        onChange={(e) => setContextInput(e.target.value)}
                        placeholder={`預設: ${defaultModelContext.toLocaleString()} (${formatTokenCount(defaultModelContext)})`}
                        className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft pr-14"
                      />
                      {contextInput && (
                        <button
                          type="button"
                          onClick={() => setContextInput('')}
                          title="恢復為模型預設"
                          className="absolute right-2.5 top-2.5 text-[11px] text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        >
                          重設
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Presets for Context Window */}
                <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
                  <span className="text-slate-500 mr-1 flex items-center space-x-1">
                    <Hash className="h-3 w-3 text-slate-400" />
                    <span>Context 快捷設定:</span>
                  </span>
                  {[
                    { label: `模型預設 (${formatTokenCount(defaultModelContext)})`, val: '' },
                    { label: '32k', val: '32768' },
                    { label: '64k', val: '65536' },
                    { label: '128k', val: '128000' },
                    { label: '200k', val: '200000' },
                    { label: '1M', val: '1048576' },
                    { label: '2M', val: '2097152' },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setContextInput(preset.val)}
                      className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono transition-all cursor-pointer ${
                        (preset.val === '' && !contextInput) || (preset.val && contextInput === preset.val)
                          ? 'border-ag-blue bg-blue-50 text-blue-700 font-semibold shadow-xs'
                          : 'border-ag-border bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center space-x-1.5 text-[10.5px] text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>
                    設定此模型執行的 Context 上下文視窗上限（Tokens，留空則自動依所選模型標準規格解析）。當長對話或工具輸出超出限制時，系統將自動進行滑動視窗修剪保護以維護推理品質。
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 2: TOOLS ================= */}
          {activeTab === 'tools' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Auto Approval Banner (Theme Adaptive) */}
              <div
                className={`rounded-2xl border p-4 space-y-3 shadow-soft transition-all duration-200 ${
                  autoApproveInput
                    ? 'border-ag-primary/40 bg-ag-primaryLight text-ag-textPrimary'
                    : 'border-ag-border bg-ag-sidebar/40 text-ag-textSecondary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1 max-w-[80%]">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                      <Zap
                        className={`h-4 w-4 transition-colors ${
                          autoApproveInput ? 'text-ag-primary fill-ag-primary/25' : 'text-ag-textMuted'
                        }`}
                      />
                      <span>全自動審批模式 (All Approve / Yolo Mode)</span>
                      {autoApproveInput && (
                        <span className="rounded-full bg-ag-primary/15 border border-ag-primary/30 px-2 py-0.5 font-mono text-[9.5px] text-ag-primary font-semibold">
                          已啟用
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ag-textSecondary leading-relaxed">
                      開啟後，終端機指令（如編譯、執行腳本）與重要檔案變更將自動執行，不再中斷暫停等待手動核准。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAutoApproveInput(!autoApproveInput)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      autoApproveInput ? 'bg-ag-primary shadow-glow-primary' : 'bg-ag-borderHover'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        autoApproveInput ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Auto Test-Driven Repair Banner */}
              <div
                className={`rounded-2xl border p-4 space-y-3 shadow-soft transition-all duration-200 ${
                  autoTestEnabledInput
                    ? 'border-indigo-400/40 bg-indigo-500/10 text-ag-textPrimary'
                    : 'border-ag-border bg-ag-sidebar/40 text-ag-textSecondary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1 max-w-[80%]">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                      <FlaskConical
                        className={`h-4 w-4 transition-colors ${
                          autoTestEnabledInput ? 'text-indigo-500' : 'text-ag-textMuted'
                        }`}
                      />
                      <span>自動測試驅動修復 (Auto Test-Driven Repair)</span>
                      {autoTestEnabledInput && (
                        <span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 font-mono text-[9.5px] text-indigo-600 dark:text-indigo-400 font-semibold">
                          自癒修復中
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ag-textSecondary leading-relaxed">
                      Agent 在修改完代碼後，系統自動在背景執行單元測試。若測試失敗，錯誤堆疊將自動轉為下一輪 Observation 由 Agent 自動重試修復，直到測試全數通過才通知您完成。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAutoTestEnabledInput(!autoTestEnabledInput)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      autoTestEnabledInput ? 'bg-indigo-600 shadow-glow-primary' : 'bg-ag-borderHover'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        autoTestEnabledInput ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {autoTestEnabledInput && (
                  <div className="pt-2 border-t border-ag-border/50">
                    <label className="block text-[11px] font-medium text-ag-textSecondary mb-1">
                      自訂測試指令 (選填，留空將自動偵測 pnpm / npm / yarn / bun / pytest / cargo / go test):
                    </label>
                    <input
                      type="text"
                      value={autoTestCommandInput}
                      onChange={(e) => setAutoTestCommandInput(e.target.value)}
                      placeholder="例如: pnpm test 或 vitest run --project core"
                      className="w-full rounded-xl border border-ag-border bg-ag-panel px-3 py-1.5 font-mono text-xs text-ag-textPrimary placeholder:text-ag-textMuted focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Git Checkpoint & Safe Rollback Banner */}
              <div
                className={`rounded-2xl border p-4 space-y-3 shadow-soft transition-all duration-200 ${
                  gitCheckpointEnabledInput
                    ? 'border-amber-400/40 bg-amber-500/10 text-ag-textPrimary'
                    : 'border-ag-border bg-ag-sidebar/40 text-ag-textSecondary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1 max-w-[80%]">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                      <RotateCcw
                        className={`h-4 w-4 transition-colors ${
                          gitCheckpointEnabledInput ? 'text-amber-500' : 'text-ag-textMuted'
                        }`}
                      />
                      <span>自動 Git Checkpoint 快照與一鍵復原 (Safe Rollback)</span>
                      {gitCheckpointEnabledInput && (
                        <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 font-mono text-[9.5px] text-amber-800 dark:text-amber-300 font-semibold">
                          安全守護中
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ag-textSecondary leading-relaxed">
                      在 Agent 開始執行任何檔案修改前，自動建立影子快照（Shadow Commit / Stash）。若 Agent 修改方向偏差或失敗，可隨時一鍵還原工作區，消除「AI 把專案改壞修不回去」的焦慮。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setGitCheckpointEnabledInput(!gitCheckpointEnabledInput)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      gitCheckpointEnabledInput ? 'bg-amber-500 shadow-glow-primary' : 'bg-ag-borderHover'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        gitCheckpointEnabledInput ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Git Worktree Isolation Banner */}
              <div
                className={`rounded-2xl border p-4 space-y-3 shadow-soft transition-all duration-200 ${
                  worktreeIsolationEnabledInput
                    ? 'border-emerald-400/40 bg-emerald-500/10 text-ag-textPrimary'
                    : 'border-ag-border bg-ag-sidebar/40 text-ag-textSecondary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1 max-w-[80%]">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                      <GitBranch
                        className={`h-4 w-4 transition-colors ${
                          worktreeIsolationEnabledInput ? 'text-emerald-500' : 'text-ag-textMuted'
                        }`}
                      />
                      <span>Git Worktree 隔離開發 (Worktree Isolation)</span>
                      {worktreeIsolationEnabledInput && (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-[9.5px] text-emerald-800 dark:text-emerald-300 font-semibold">
                          沙盒隔離中
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ag-textSecondary leading-relaxed">
                      讓背景執行的 Agent 在獨立的 Git Worktree 隔離目錄中作業，共用依賴函式庫，完全不干擾使用者當前編輯中的檔案。待驗證測試通過後再 Merge 回主目錄。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setWorktreeIsolationEnabledInput(!worktreeIsolationEnabledInput)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      worktreeIsolationEnabledInput ? 'bg-emerald-600 shadow-glow-primary' : 'bg-ag-borderHover'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        worktreeIsolationEnabledInput ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Hierarchical Subagents Banner */}
              <div
                className={`rounded-2xl border p-4 space-y-3 shadow-soft transition-all duration-200 ${
                  subagentsEnabledInput
                    ? 'border-purple-400/40 bg-purple-500/10 text-ag-textPrimary'
                    : 'border-ag-border bg-ag-sidebar/40 text-ag-textSecondary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1 max-w-[80%]">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                      <Bot
                        className={`h-4 w-4 transition-colors ${
                          subagentsEnabledInput ? 'text-purple-500' : 'text-ag-textMuted'
                        }`}
                      />
                      <span>多子代理人協同 (Hierarchical Subagents)</span>
                      {subagentsEnabledInput ? (
                        <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 font-mono text-[9.5px] text-purple-700 dark:text-purple-300 font-semibold">
                          多代理人模式
                        </span>
                      ) : (
                        <span className="rounded-full bg-ag-border/30 px-2 py-0.5 font-mono text-[9.5px] text-ag-textMuted font-semibold">
                          單一 Agent (省 Token)
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ag-textSecondary leading-relaxed">
                      啟用後，主代理人可透過 invoke_subagent 調度 Researcher、Coder、Reviewer 等專屬子代理人並行處理複雜任務。關閉後強制維持單一 Agent 自主作業，避免多代理人高頻呼叫衝破 API 頻率配額限制 (429 Rate Limit) 並大幅節省 Token。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSubagentsEnabledInput(!subagentsEnabledInput)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      subagentsEnabledInput ? 'bg-purple-600 shadow-glow-primary' : 'bg-ag-borderHover'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        subagentsEnabledInput ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Checkpoints History Card */}
              {checkpoints.length > 0 && (
                <div className="space-y-3 rounded-2xl border border-ag-border bg-ag-sidebar/30 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                      <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
                      <span>工作區快照歷史 (Recent Checkpoints)</span>
                    </div>
                    <span className="text-[10.5px] text-ag-textMuted font-mono">
                      共 {checkpoints.length} 個快照點
                    </span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                    {checkpoints.slice(0, 5).map((cp) => (
                      <div
                        key={cp.id}
                        className="flex items-center justify-between rounded-xl border border-ag-border bg-ag-panel p-2.5 text-xs shadow-soft"
                      >
                        <div className="flex flex-col space-y-0.5 max-w-[70%]">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-[11px] font-semibold text-ag-textPrimary">
                              {cp.id}
                            </span>
                            {cp.stashRef && (
                              <span className="rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 px-1.5 py-0.5 text-[9.5px]">
                                包含未暫存異動
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-ag-textMuted">
                            {new Date(cp.createdAt).toLocaleString()} • Commit: {cp.commitHash.slice(0, 7)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => rollbackCheckpoint(cp.sessionId, cp.id)}
                          disabled={isRevertingCheckpoint}
                          className="flex items-center space-x-1 rounded-lg border border-amber-300/80 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 px-2.5 py-1 text-[11px] font-medium transition-all shadow-soft cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className={`h-3 w-3 ${isRevertingCheckpoint ? 'animate-spin' : ''}`} />
                          <span>復原</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Built-in Tools List */}
              <div className="space-y-3">
                <label className="flex items-center space-x-2 font-medium text-slate-800 text-[12.5px]">
                  <Wrench className="h-4 w-4 text-ag-blue" />
                  <span>Agent 內建原子工具清單 (Built-in Tools)</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      name: 'write_to_file',
                      desc: '建立新檔案或覆寫現有檔案，支援自動建立父目錄。',
                      tag: '寫入權限',
                      color: 'text-blue-800 border-blue-200 bg-blue-50',
                    },
                    {
                      name: 'replace_file_content',
                      desc: '行層級精確取代修改，保留現有排版與註解。',
                      tag: '寫入權限',
                      color: 'text-amber-800 border-amber-200 bg-amber-50',
                    },
                    {
                      name: 'read_file',
                      desc: '讀取工作區檔案內容，帶有行號輔助比對。',
                      tag: '唯讀探索',
                      color: 'text-emerald-800 border-emerald-200 bg-emerald-50',
                    },
                    {
                      name: 'execute_command',
                      desc: '在工作區環境中執行 Shell 終端機指令（如 npm test, git）。',
                      tag: '終端審批',
                      color: 'text-rose-800 border-rose-200 bg-rose-50',
                    },
                    {
                      name: 'search_files',
                      desc: '全專案跨目錄進行關鍵字與正規表達式搜尋。',
                      tag: '唯讀探索',
                      color: 'text-indigo-800 border-indigo-200 bg-indigo-50',
                    },
                    {
                      name: 'list_files',
                      desc: '探索工作區目錄階層與遞迴檔案清單。',
                      tag: '唯讀探索',
                      color: 'text-slate-700 border-slate-200 bg-slate-50',
                    },
                    {
                      name: 'use_skill',
                      desc: '啟用並串接高階專業 SOP 技能（如測試、Git、審查）。',
                      tag: '高階技能',
                      color: 'text-purple-800 border-purple-200 bg-purple-50',
                    },
                  ].map((tool) => (
                    <div
                      key={tool.name}
                      className="flex flex-col p-3 rounded-2xl border border-ag-border bg-white hover:border-slate-300 transition-all shadow-soft"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-slate-800">{tool.name}</span>
                        <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] ${tool.color}`}>
                          {tool.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{tool.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Server Connection & Security Auth Token */}
              <div className="space-y-2 p-4 rounded-2xl border border-ag-border bg-ag-sidebar/30">
                <label className="flex items-center space-x-2 font-medium text-slate-800 text-[12.5px]">
                  <Lock className="h-4 w-4 text-ag-blue" />
                  <span>後端連線驗證權杖 (Server Auth Token / API Key)</span>
                </label>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  若後端伺服器啟用了 <code>AUTH_TOKEN</code> 或跨主機/區域網路部署，請在此輸入金鑰。前端進行 REST API 請求與 WebSocket 握手時將自動附帶此權杖進行身分驗證。
                </p>
                <div className="relative">
                  <Key className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="password"
                    value={serverAuthTokenInput}
                    onChange={(e) => setServerAuthTokenInput(e.target.value)}
                    placeholder="輸入後端 AUTH_TOKEN (若後端未配置則可留空)..."
                    className="w-full rounded-xl border border-ag-border bg-white pl-9 pr-3.5 py-2 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>
              </div>

              {/* Safety Sandbox Notice */}
              <div className="flex items-start space-x-2.5 rounded-2xl border border-blue-200 bg-blue-50/60 p-3.5 text-[11px] text-slate-700">
                <Shield className="h-4 w-4 text-ag-blue shrink-0 mt-0.5" />
                <p>
                  <strong>工作區沙箱防護 (Path Traversal Guard)：</strong>所有檔案讀寫工具皆嚴格鎖定於當前專案工作區目錄內，防止未經授權逃逸至系統目錄。
                </p>
              </div>
            </div>
          )}

          {/* ================= TAB 3: SKILLS ================= */}
          {activeTab === 'skills' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Skills Overview Header & Search & Refresh */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center space-x-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-ag-primaryLight text-ag-primary border border-ag-primary/20">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <span className="font-semibold text-ag-textPrimary text-xs">
                      已載入之 Agent 技能清單
                    </span>
                    <span className="ml-2 font-mono text-[10.5px] text-ag-primary bg-ag-primaryLight px-2 py-0.5 rounded-full border border-ag-primary/20">
                      {skills.length} 款可用
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => fetchSkills(true)}
                    disabled={isLoadingSkills}
                    className="flex items-center space-x-1.5 rounded-xl border border-ag-border bg-ag-panel px-3 py-1.5 text-xs text-ag-primary hover:bg-ag-primaryLight transition-all cursor-pointer shadow-soft disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoadingSkills ? 'animate-spin' : ''}`} />
                    <span>{isLoadingSkills ? '掃描中...' : '重新掃描磁碟'}</span>
                  </button>
                </div>
              </div>

              {/* Search Box */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-ag-textMuted" />
                <input
                  type="text"
                  value={skillSearchQuery}
                  onChange={(e) => setSkillSearchQuery(e.target.value)}
                  placeholder="搜尋技能名稱、說明、關鍵字或依賴工具 (例如: commit, verifier, memory, test)..."
                  className="w-full rounded-xl border border-ag-border bg-ag-panel pl-9 pr-3.5 py-2 font-mono text-xs text-ag-textPrimary placeholder-ag-textMuted outline-none focus:border-ag-primary shadow-soft"
                />
              </div>

              {/* Skills Grid */}
              {(() => {
                const filteredSkills = skills.filter((s) => {
                  const q = skillSearchQuery.toLowerCase().trim();
                  if (!q) return true;
                  return (
                    s.name.toLowerCase().includes(q) ||
                    s.description.toLowerCase().includes(q) ||
                    (s.category && s.category.toLowerCase().includes(q)) ||
                    (s.sourcePath && s.sourcePath.toLowerCase().includes(q)) ||
                    (s.requiredTools && s.requiredTools.some((t) => t.toLowerCase().includes(q)))
                  );
                });

                if (filteredSkills.length === 0) {
                  return (
                    <div className="rounded-2xl border border-dashed border-ag-border bg-ag-sidebar/20 p-8 text-center text-ag-textMuted space-y-2">
                      <Sparkles className="h-6 w-6 mx-auto text-ag-textMuted" />
                      <p className="text-xs">
                        {isLoadingSkills ? '正在探索磁碟中技能...' : '未找到符合搜尋條件的技能'}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[46vh] overflow-y-auto p-1 custom-scrollbar">
                    {filteredSkills.map((skill) => {
                      const getSkillIcon = (name: string, cat?: string) => {
                        if (name.includes('test')) return '🧪';
                        if (name.includes('git') || name.includes('commit')) return '📦';
                        if (name.includes('review') || name.includes('verify') || name.includes('verifier')) return '🛡️';
                        if (name.includes('arch') || name.includes('structure')) return '🏗️';
                        if (name.includes('design') || name.includes('ui') || name.includes('frontend')) return '🎨';
                        if (name.includes('memory') || name.includes('bank')) return '🧠';
                        if (name.includes('find') || name.includes('search')) return '🔍';
                        if (name.includes('creator') || name.includes('custom')) return '⚙️';
                        switch (cat) {
                          case 'testing': return '🧪';
                          case 'git': return '📦';
                          case 'refactor': return '🛡️';
                          case 'architecture': return '🏗️';
                          case 'workflow': return '⚡';
                          default: return '✨';
                        }
                      };

                      const getSourceBadge = (sourcePath?: string) => {
                        if (!sourcePath) {
                          return {
                            label: '核心內建',
                            className: 'bg-ag-primaryLight text-ag-primary border-ag-primary/20',
                          };
                        }
                        if (sourcePath.includes('.agents') || sourcePath.includes('.agent')) {
                          return {
                            label: '~/.agents/skills',
                            className: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                          };
                        }
                        if (sourcePath.includes('.gemini') || sourcePath.includes('antigravity')) {
                          return {
                            label: '系統擴充',
                            className: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
                          };
                        }
                        return {
                          label: '專案技能 (.skills/)',
                          className: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                        };
                      };

                      const sourceBadge = getSourceBadge(skill.sourcePath);

                      return (
                        <div
                          key={skill.name}
                          className="flex flex-col justify-between p-3.5 rounded-2xl border border-ag-border bg-ag-panel hover:border-ag-primary/40 hover:shadow-soft transition-all space-y-2.5"
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="flex items-center space-x-2 truncate">
                                <span className="text-base shrink-0">{getSkillIcon(skill.name, skill.category)}</span>
                                <span className="font-mono font-semibold text-ag-textPrimary text-xs truncate" title={skill.name}>
                                  {skill.name}
                                </span>
                              </div>
                              <div className="flex items-center space-x-1 shrink-0">
                                <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[9px] ${sourceBadge.className}`}>
                                  {sourceBadge.label}
                                </span>
                                {skill.category && (
                                  <span className="rounded-md border border-ag-border bg-ag-sidebar px-1.5 py-0.5 font-mono text-[9px] uppercase text-ag-textMuted">
                                    {skill.category}
                                  </span>
                                )}
                              </div>
                            </div>

                            <p className="text-[11px] text-ag-textSecondary leading-relaxed line-clamp-2" title={skill.description}>
                              {skill.description}
                            </p>
                          </div>

                          <div className="pt-2 border-t border-ag-border/50 flex items-center justify-between text-[10px]">
                            <div className="truncate text-ag-textMuted font-mono max-w-[70%]">
                              {skill.requiredTools && skill.requiredTools.length > 0 ? (
                                <span>
                                  <span className="text-ag-primary font-medium">工具：</span>
                                  {skill.requiredTools.join(', ')}
                                </span>
                              ) : (
                                <span>通用自動分析</span>
                              )}
                            </div>

                            <button
                              onClick={() => setViewingSkill(skill)}
                              className="text-ag-primary hover:underline font-medium cursor-pointer shrink-0 ml-2"
                            >
                              檢視 SOP 詳情 →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Custom Workspace Skills Info & Template Copy */}
              <div className="rounded-2xl border border-ag-border bg-ag-sidebar/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                    <BookOpen className="h-4 w-4 text-ag-primary" />
                    <span>擴充自訂專案技能 (Workspace Custom Skills)</span>
                  </div>
                  <button
                    onClick={handleCopySkillTemplate}
                    className="flex items-center space-x-1 rounded-lg border border-ag-border bg-ag-panel px-2.5 py-1 text-[11px] text-ag-textPrimary hover:border-ag-primary transition-all cursor-pointer shadow-soft"
                  >
                    {copiedTemplate ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-ag-textMuted" />}
                    <span>{copiedTemplate ? '已複製範本！' : '複製技能 Markdown 範本'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-ag-textSecondary leading-relaxed">
                  在使用者全域目錄 <code className="text-ag-primary bg-ag-primaryLight px-1.5 py-0.5 rounded border border-ag-primary/20">~/.agents/skills/&lt;name&gt;/SKILL.md</code> 或專案目錄 <code className="text-ag-primary bg-ag-primaryLight px-1.5 py-0.5 rounded border border-ag-primary/20">.skills/&lt;name&gt;/SKILL.md</code> 下放置技能定義，系統將自動識別並註冊為專屬 SOP。
                </p>
              </div>
            </div>
          )}


          {/* ================= TAB 4: MCP ================= */}
          {activeTab === 'mcp' && (
            <McpManager
              mcpEnabled={mcpEnabledInput}
              onMcpEnabledChange={setMcpEnabledInput}
              mcpConfig={mcpConfigInput}
              onMcpConfigChange={setMcpConfigInput}
              mcpJsonError={mcpJsonError}
              setMcpJsonError={setMcpJsonError}
            />
          )}

          {/* ================= TAB 5: APPEARANCE ================= */}
          {activeTab === 'appearance' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Theme Preset */}
              <div className="space-y-2.5">
                <label className="flex items-center space-x-2 font-medium text-ag-textPrimary text-[12.5px]">
                  <Palette className="h-4 w-4 text-ag-primary" />
                  <span>主題風格 (Theme Preset - 即時預覽)</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'eye-friendly', name: '晨霧護眼 (Eye-Friendly)', desc: '晨霧灰底與莫蘭迪靛青，沉著低飽和護眼', bg: 'bg-[#6366F1]' },
                    { id: 'indigo', name: '恬淡矢車菊 (Cornflower)', desc: '天空霧底與澄澈湛藍，清新明亮專注', bg: 'bg-[#2563EB]' },
                    { id: 'lavender', name: '柔霧薰衣草 (Lavender)', desc: '淺柔優雅薰衣草紫，溫潤明亮沉浸', bg: 'bg-[#8B7FD9]' },
                    { id: 'grass', name: '鼠尾草綠 (Sage)', desc: '清新柔和自然草本綠調，舒緩雙眼', bg: 'bg-[#10B981]' },
                    { id: 'khaki', name: '奶油杏黃 (Butter)', desc: '柔和溫暖杏黃米色，奶茶焦糖質感', bg: 'bg-[#D97706]' },
                    { id: 'slate', name: '曜石淺灰 (Slate)', desc: '純粹沉穩極簡灰階底色，俐落工程感', bg: 'bg-[#475569]' },
                    { id: 'dark', name: '深炭黑曜 (Dark Slate)', desc: '深炭藍黑與石墨黑底色，專業高對比沉浸', bg: 'bg-[#0F172A]' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleLiveThemeChange(t.id)}
                      className={`flex flex-col rounded-2xl border p-3.5 text-left transition-all cursor-pointer ${
                        themeInput === t.id
                          ? 'border-ag-primary bg-ag-primaryLight text-ag-textPrimary shadow-soft font-medium ring-2 ring-ag-primary/40'
                          : 'border-ag-border bg-ag-panel text-ag-textSecondary hover:border-ag-borderHover hover:text-ag-textPrimary'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className={`h-4 w-4 rounded-full border border-slate-300 shrink-0 ${t.bg}`} />
                        <span className="font-semibold text-ag-textPrimary text-xs truncate">{t.name}</span>
                      </div>
                      <span className="text-[10.5px] text-ag-textMuted mt-1 leading-tight line-clamp-2">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size & Code Font */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center space-x-1.5 font-medium text-ag-textPrimary">
                    <Type className="h-3.5 w-3.5 text-ag-primary" />
                    <span>介面字體大小 (Font Size)</span>
                  </label>
                  <select
                    value={fontSizeInput}
                    onChange={(e) => handleLiveFontSizeChange(e.target.value)}
                    className="w-full rounded-xl border border-ag-border bg-ag-panel px-3.5 py-2.5 font-medium text-xs text-ag-textPrimary outline-none focus:border-ag-primary cursor-pointer shadow-soft"
                  >
                    <option value="sm" className="bg-ag-panel text-ag-textPrimary">緊湊 (Small - 13px)</option>
                    <option value="base" className="bg-ag-panel text-ag-textPrimary">標準 (Standard - 14px)</option>
                    <option value="lg" className="bg-ag-panel text-ag-textPrimary">寬敞 (Large - 16px)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center space-x-1.5 font-medium text-ag-textPrimary">
                    <Code2 className="h-3.5 w-3.5 text-ag-primary" />
                    <span>程式碼與等寬字型 (Code Font)</span>
                  </label>
                  <select
                    value={codeFontInput}
                    onChange={(e) => handleLiveCodeFontChange(e.target.value)}
                    className="w-full rounded-xl border border-ag-border bg-ag-panel px-3.5 py-2.5 font-mono text-xs text-ag-textPrimary outline-none focus:border-ag-primary cursor-pointer shadow-soft"
                  >
                    <option value="fira" className="bg-ag-panel text-ag-textPrimary">Fira Code (推薦)</option>
                    <option value="jetbrains" className="bg-ag-panel text-ag-textPrimary">JetBrains Mono</option>
                    <option value="consolas" className="bg-ag-panel text-ag-textPrimary">Consolas</option>
                    <option value="system" className="bg-ag-panel text-ag-textPrimary">系統預設等寬字型</option>
                  </select>
                </div>
              </div>

              {/* Message Density Toggle */}
              <div className="rounded-2xl border border-ag-border bg-ag-sidebar/40 p-4 space-y-3 shadow-soft">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                      <Sliders className="h-4 w-4 text-ag-primary" />
                      <span>緊湊對話佈局 (Compact Message Density)</span>
                    </div>
                    <p className="text-[11px] text-ag-textMuted leading-relaxed">
                      減少對話泡泡內外間距，在較小螢幕上展示更多對話與代碼內容。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleLiveCompactToggle}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      compactModeInput ? 'bg-ag-primary' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        compactModeInput ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex h-16 items-center justify-between border-t border-ag-border bg-ag-sidebar px-6">
          <span className="text-[11px] text-ag-textMuted">
            設定會自動儲存於瀏覽器，並於執行任務時生效。
          </span>
          <div className="flex items-center space-x-2.5">
            <button
              onClick={handleCancel}
              className="rounded-xl border border-ag-border bg-ag-panel px-4 py-2 text-xs font-medium text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary transition-colors cursor-pointer shadow-soft"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex items-center space-x-1.5 rounded-xl bg-ag-primary px-5 py-2 text-xs font-semibold text-white hover:opacity-90 shadow-soft transition-all cursor-pointer active:scale-98"
            >
              {isSaved ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                  <span>已儲存！</span>
                </>
              ) : (
                <span>儲存設定</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Skill SOP Preview Modal */}
      {viewingSkill && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
          <div className="flex w-full max-w-xl max-h-[82vh] flex-col rounded-3xl border border-ag-border bg-ag-panel shadow-2xl overflow-hidden">
            <div className="flex h-12 items-center justify-between border-b border-ag-border px-5 bg-ag-sidebar">
              <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
                <Sparkles className="h-4 w-4 text-ag-primary" />
                <span>技能 SOP 流程詳情：{viewingSkill.name}</span>
              </div>
              <button
                onClick={() => setViewingSkill(null)}
                className="rounded-xl p-1 text-ag-textMuted hover:text-ag-textPrimary hover:bg-ag-panel transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs custom-scrollbar">
              <div className="space-y-1">
                <span className="font-semibold text-ag-textPrimary">技能說明 (Description)：</span>
                <p className="text-ag-textSecondary leading-relaxed bg-ag-sidebar/40 p-3 rounded-xl border border-ag-border">
                  {viewingSkill.description}
                </p>
              </div>

              {viewingSkill.sourcePath && (
                <div className="space-y-1">
                  <span className="font-semibold text-ag-textPrimary">檔案來源路徑 (Source Path)：</span>
                  <div className="font-mono text-[10.5px] text-ag-textMuted bg-ag-sidebar/40 px-3 py-1.5 rounded-xl border border-ag-border truncate" title={viewingSkill.sourcePath}>
                    {viewingSkill.sourcePath}
                  </div>
                </div>
              )}

              {viewingSkill.requiredTools && viewingSkill.requiredTools.length > 0 && (
                <div className="space-y-1">
                  <span className="font-semibold text-ag-textPrimary">推薦調用工具 (Recommended Tools)：</span>
                  <div className="flex flex-wrap gap-1.5">
                    {viewingSkill.requiredTools.map((t) => (
                      <span key={t} className="rounded-md border border-ag-primary/30 bg-ag-primaryLight px-2 py-0.5 font-mono text-[10px] text-ag-primary font-medium">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <span className="font-semibold text-ag-textPrimary">標準作業程序 (SOP Instructions)：</span>
                <pre className="font-mono text-[11px] whitespace-pre-wrap text-ag-textSecondary bg-ag-void/70 p-3.5 rounded-2xl border border-ag-border leading-relaxed max-h-64 overflow-y-auto custom-scrollbar">
                  {viewingSkill.instructions}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-ag-border px-5 py-3 bg-ag-sidebar">
              <button
                onClick={() => setViewingSkill(null)}
                className="rounded-xl border border-ag-border bg-ag-panel px-4 py-1.5 text-xs font-semibold text-ag-textPrimary hover:border-ag-primary transition-all cursor-pointer shadow-soft"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
