import React from 'react';
import {
  Activity,
  Brain,
  Coins,
  Compass,
  Cpu,
  Flame,
  FlaskConical,
  FolderGit2,
  Radio,
  Settings as SettingsIcon,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { AgentMode, LLMProviderType, ModelInfo, ThinkingDepth } from '@harni/types';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';
import { HarniLogo } from './HarniLogo.js';

export const Header: React.FC = () => {
  const {
    connected,
    status,
    selectedMode,
    selectedProvider,
    selectedModel,
    thinkingDepth,
    availableModels,
    isLoadingModels,
    tokenUsage,
    workspaceInfo,
    folders,
    activeFolderId,
    customProviderName,
    setMode,
    setProvider,
    setModel,
    setThinkingDepth,
    setSettingsOpen,
  } = useAgentStore(
    useShallow((s) => ({
      connected: s.connected,
      status: s.status,
      selectedMode: s.selectedMode,
      selectedProvider: s.selectedProvider,
      selectedModel: s.selectedModel,
      thinkingDepth: s.thinkingDepth,
      availableModels: s.availableModels,
      isLoadingModels: s.isLoadingModels,
      tokenUsage: s.tokenUsage,
      workspaceInfo: s.workspaceInfo,
      folders: s.folders,
      activeFolderId: s.activeFolderId,
      customProviderName: s.customProviderName,
      setMode: s.setMode,
      setProvider: s.setProvider,
      setModel: s.setModel,
      setThinkingDepth: s.setThinkingDepth,
      setSettingsOpen: s.setSettingsOpen,
    }))
  );

  const rawLiveModels: ModelInfo[] = availableModels[selectedProvider] || [];
  const liveModels = selectedProvider === 'cline'
    ? rawLiveModels.filter((m) => m.id.startsWith('cline-pass/') || m.id.startsWith('deepseek/'))
    : rawLiveModels;
  const activeFolder = folders.find((f) => f.id === activeFolderId);
  const currentPath = activeFolder?.path || workspaceInfo?.rootPath || '';
  const currentName = activeFolder?.name || currentPath.split(/[\\/]/).pop() || 'Workspace';

  const getStatusBeacon = () => {
    switch (status) {
      case 'planning':
        return (
          <div className="flex items-center space-x-2 rounded-full border border-sky-400/50 bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-300 shadow-soft animate-pulse">
            <Compass className="h-3.5 w-3.5 text-sky-500 animate-spin" />
            <span className="tracking-wide font-medium">規劃修改藍圖中...</span>
          </div>
        );
      case 'thinking':
        return (
          <div className="flex items-center space-x-2 rounded-full border border-ag-primary/40 bg-ag-primaryLight px-3 py-1 text-xs font-medium text-ag-textPrimary shadow-soft">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ag-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ag-primary" />
            </span>
            <span className="tracking-wide font-medium">AI 思考與推理中...</span>
          </div>
        );
      case 'executing_tool':
        return (
          <div className="flex items-center space-x-2 rounded-full border border-ag-primary/40 bg-ag-primaryLight px-3 py-1 text-xs font-medium text-ag-textPrimary shadow-soft">
            <Activity className="h-3.5 w-3.5 animate-spin text-ag-primary" />
            <span className="tracking-wide font-medium">執行工具操作中</span>
          </div>
        );
      case 'testing':
        return (
          <div className="flex items-center space-x-2 rounded-full border border-indigo-400/50 bg-indigo-500/15 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 shadow-soft animate-pulse">
            <FlaskConical className="h-3.5 w-3.5 text-indigo-500" />
            <span className="tracking-wide font-medium">背景測試驗證中...</span>
          </div>
        );
      case 'waiting_approval':
        return (
          <div className="flex items-center space-x-2 rounded-full border border-amber-300 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="tracking-wide">需要操作確認</span>
          </div>
        );
      case 'completed':
        return (
          <div className="flex items-center space-x-2 rounded-full border border-emerald-300 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>Agent 就緒</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center space-x-1.5 rounded-full border border-ag-border bg-ag-panel px-2.5 py-0.5 text-xs text-ag-textMuted shadow-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-ag-borderHover" />
            <span>閒置 (Idle)</span>
          </div>
        );
    }
  };

  return (
    <header className="flex h-13 items-center justify-between border-b border-ag-border bg-ag-panel/95 px-4 backdrop-blur-md select-none z-20">
      {/* Brand & Project Info */}
      <div className="flex items-center space-x-3.5">
        <HarniLogo
          size={32}
          showText
          textClassName="text-base font-bold tracking-tight text-ag-textPrimary"
        />

        <div className="h-4 w-px bg-ag-border" />

        {/* Connection status */}
        <div className="flex items-center space-x-1.5 text-xs text-ag-textMuted">
          <Radio
            className={`h-3 w-3 ${
              connected ? 'text-emerald-500 animate-pulse' : 'text-rose-500'
            }`}
          />
          <span className="font-mono text-[11px]">
            {connected ? 'Live WS' : 'Disconnected'}
          </span>
        </div>

        {/* Workspace Root Badge */}
        {currentPath && (
          <div
            className="flex items-center space-x-1.5 rounded-lg border border-ag-border bg-ag-sidebar px-2.5 py-1 text-xs text-ag-textSecondary shadow-soft cursor-default"
            title={`目前工作目錄: ${currentPath}`}
          >
            <FolderGit2 className="h-3.5 w-3.5 text-ag-primary shrink-0" />
            <div className="flex items-center space-x-1 max-w-[220px] truncate">
              <span className="font-semibold text-ag-textPrimary text-[11px] truncate">
                {currentName}
              </span>
              <span className="font-mono text-[10px] text-ag-textMuted truncate">
                ({currentPath})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Middle Status Beacon */}
      <div className="flex items-center space-x-2">{getStatusBeacon()}</div>

      {/* Controls: Mode Tabs, Provider, Dynamic Model Selector, Settings */}
      <div className="flex items-center space-x-2.5">
        {/* Antigravity Mode Pills */}
        <div className="flex items-center space-x-1 rounded-xl border border-ag-border bg-ag-sidebar p-1 shadow-soft">
          {(['code', 'architect', 'ask', 'test'] as AgentMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setMode(mode)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-all duration-150 cursor-pointer ${
                selectedMode === mode
                  ? 'bg-ag-primary text-white shadow-soft font-semibold'
                  : 'text-ag-textMuted hover:bg-ag-panel hover:text-ag-textPrimary'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Provider Selector */}
        <div className="flex items-center space-x-1.5 rounded-xl border border-ag-border bg-ag-panel px-2.5 py-1 text-xs text-ag-textSecondary shadow-soft">
          <Cpu className="h-3.5 w-3.5 text-ag-primary" />
          <select
            value={selectedProvider}
            onChange={(e) => setProvider(e.target.value as LLMProviderType)}
            className="bg-transparent font-medium text-ag-textPrimary outline-none cursor-pointer"
          >
            <option value="antigravity" className="bg-ag-panel text-ag-textPrimary">
              Google Antigravity
            </option>
            <option value="cline" className="bg-ag-panel text-ag-textPrimary">
              Cline API
            </option>
            <option value="anthropic" className="bg-ag-panel text-ag-textPrimary">
              Anthropic
            </option>
            <option value="openai" className="bg-ag-panel text-ag-textPrimary">
              OpenAI
            </option>
            <option value="openrouter" className="bg-ag-panel text-ag-textPrimary">
              OpenRouter
            </option>
            <option value="opencode" className="bg-ag-panel text-ag-textPrimary">
              OpenCode
            </option>
            <option value="ollama" className="bg-ag-panel text-ag-textPrimary">
              Ollama
            </option>
            <option value="custom" className="bg-ag-panel text-ag-textPrimary">
              {customProviderName ? `自訂 (${customProviderName})` : '自訂 (Custom)'}
            </option>
          </select>
        </div>

        {/* Dynamic Model Dropdown */}
        <div className="flex items-center space-x-1.5 rounded-xl border border-ag-border bg-ag-panel px-2.5 py-1 text-xs text-ag-textSecondary shadow-soft">
          <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <select
            value={selectedModel}
            onChange={(e) => setModel(e.target.value)}
            disabled={isLoadingModels}
            className="bg-transparent font-mono text-xs text-ag-textPrimary outline-none cursor-pointer max-w-[160px] truncate"
          >
            {isLoadingModels && (
              <option disabled value="" className="bg-ag-panel text-ag-textMuted">
                Fetching models...
              </option>
            )}

            {liveModels.map((model) => (
              <option
                key={model.id}
                value={model.id}
                className="bg-ag-panel text-ag-textPrimary"
              >
                {model.name || model.id}
              </option>
            ))}

            {selectedModel &&
              !liveModels.some((m) => m.id === selectedModel) && (
                <option value={selectedModel} className="bg-ag-panel text-ag-textPrimary">
                  {selectedModel}
                </option>
              )}

            {liveModels.length === 0 && !isLoadingModels && !selectedModel && (
              <option value="" className="bg-ag-panel text-ag-textMuted">
                (Configure Model)
              </option>
            )}
          </select>
        </div>

        {/* 思考深度 (Thinking Depth / Reasoning Budget Selector) */}
        <div
          className="flex items-center space-x-1.5 rounded-xl border border-ag-border bg-ag-panel px-2.5 py-1 text-xs text-ag-textSecondary shadow-soft transition-all"
          title="調整模型思考深度與推理預算 (Thinking Depth & Reasoning Budget)"
        >
          <Brain className="h-3.5 w-3.5 text-purple-500 shrink-0" />
          <select
            value={thinkingDepth}
            onChange={(e) => setThinkingDepth(e.target.value as ThinkingDepth)}
            className="bg-transparent font-medium text-xs text-ag-textPrimary outline-none cursor-pointer"
          >
            <option value="off" className="bg-ag-panel text-ag-textPrimary">
              Off
            </option>
            <option value="low" className="bg-ag-panel text-ag-textPrimary">
              Low
            </option>
            <option value="medium" className="bg-ag-panel text-ag-textPrimary">
              Med
            </option>
            <option value="high" className="bg-ag-panel text-ag-textPrimary">
              High
            </option>
            <option value="ultra" className="bg-ag-panel text-ag-textPrimary">
              Max
            </option>
          </select>
        </div>

        {/* Token Metrics Badge */}
        <div className="flex items-center space-x-1.5 rounded-xl border border-amber-300/50 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 font-mono shadow-soft">
          <Flame className="h-3.5 w-3.5 text-amber-500" />
          <span>{tokenUsage.totalTokens.toLocaleString()}</span>
        </div>

        {/* Settings Button */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center space-x-1.5 rounded-xl border border-ag-border bg-ag-panel px-3 py-1 text-xs font-medium text-ag-textSecondary hover:border-ag-primary/50 hover:bg-ag-sidebar hover:text-ag-textPrimary transition-all shadow-soft cursor-pointer"
          title="Configure API Endpoints & Models"
        >
          <SettingsIcon className="h-3.5 w-3.5 text-ag-primary" />
          <span>設定</span>
        </button>
      </div>
    </header>
  );
};

