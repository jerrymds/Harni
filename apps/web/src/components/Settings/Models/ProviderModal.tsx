import React, { useEffect, useState } from 'react';
import {
  Check,
  Code2,
  Cpu,
  ExternalLink,
  Globe,
  Layers,
  Plus,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import type { LLMProviderConfig, LLMProviderProtocol } from '@harni/types';
import { PROVIDER_PRESETS } from './providerRegistry.js';

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingIds: string[];
  initialEditProvider?: LLMProviderConfig | null;
  initialTab?: 'presets' | 'custom';
  onSaveProvider: (provider: LLMProviderConfig) => void;
  onSelectProvider: (providerId: string) => void;
}

const EMOJI_OPTIONS = ['🔌', '🐋', '🚀', '✖️', '💧', '🤝', '🌪️', '🎆', '🔥', '🖥️', '⚙️', '🏢', '☁️', '🧪'];

export const ProviderModal: React.FC<ProviderModalProps> = ({
  isOpen,
  onClose,
  existingIds,
  initialEditProvider,
  initialTab = 'presets',
  onSaveProvider,
  onSelectProvider,
}) => {
  const isEditing = Boolean(initialEditProvider);
  const [tab, setTab] = useState<'presets' | 'custom'>(isEditing ? 'custom' : initialTab);
  const [presetSearch, setPresetSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'cloud' | 'aggregator' | 'local'>('all');

  const [idInput, setIdInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [iconInput, setIconInput] = useState('🔌');
  const [descInput, setDescInput] = useState('');
  const [badgeInput, setBadgeInput] = useState('自訂服務');
  const [protocolInput, setProtocolInput] = useState<LLMProviderProtocol>('openai-compatible');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [defaultModelInput, setDefaultModelInput] = useState('');
  const [requiresKeyInput, setRequiresKeyInput] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (initialEditProvider) {
      setTab('custom');
      setIdInput(initialEditProvider.id);
      setNameInput(initialEditProvider.name);
      setIconInput(initialEditProvider.icon || '🔌');
      setDescInput(initialEditProvider.description || '');
      setBadgeInput(initialEditProvider.badge || '自訂服務');
      setProtocolInput(initialEditProvider.protocol || 'openai-compatible');
      setBaseUrlInput(initialEditProvider.defaultBaseUrl || '');
      setDefaultModelInput(initialEditProvider.defaultModel || '');
      setRequiresKeyInput(initialEditProvider.requiresApiKey ?? true);
    } else {
      setTab(initialTab);
      setIdInput('');
      setNameInput('');
      setIconInput('🔌');
      setDescInput('');
      setBadgeInput('自訂網關');
      setProtocolInput('openai-compatible');
      setBaseUrlInput('');
      setDefaultModelInput('');
      setRequiresKeyInput(true);
    }
  }, [isOpen, initialEditProvider, initialTab]);

  if (!isOpen) return null;

  const filteredPresets = PROVIDER_PRESETS.filter((p) => {
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (!presetSearch.trim()) return true;
    const q = presetSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.badge && p.badge.toLowerCase().includes(q))
    );
  });

  const handleQuickApplyPreset = (preset: LLMProviderConfig) => {
    onSaveProvider({
      ...preset,
      isBuiltin: false,
      enabled: true,
    });
    onSelectProvider(preset.id);
    onClose();
  };

  const handlePrefillFromPreset = (preset: LLMProviderConfig) => {
    setIdInput(preset.id);
    setNameInput(preset.name);
    setIconInput(preset.icon);
    setDescInput(preset.description);
    setBadgeInput(preset.badge || '自訂服務');
    setProtocolInput(preset.protocol);
    setBaseUrlInput(preset.defaultBaseUrl);
    setDefaultModelInput(preset.defaultModel);
    setRequiresKeyInput(preset.requiresApiKey ?? true);
    setTab('custom');
  };

  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setError('請輸入服務商顯示名稱');
      return;
    }

    let rawId = idInput
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
    if (!rawId) {
      rawId = `custom-${Date.now().toString(36)}`;
    }

    // Ensure protocol prefix conventions if needed by backend factory for non-OpenAI protocols
    if (!isEditing) {
      if (protocolInput === 'anthropic' && rawId !== 'anthropic' && !rawId.startsWith('anthropic-')) {
        rawId = `anthropic-${rawId}`;
      } else if (protocolInput === 'ollama' && rawId !== 'ollama' && !rawId.startsWith('ollama-')) {
        rawId = `ollama-${rawId}`;
      }
      if (existingIds.includes(rawId)) {
        setError(`服務商 ID "${rawId}" 已存在，請更換識別碼或直接編輯該服務商。`);
        return;
      }
    }

    const trimmedUrl = baseUrlInput.trim();
    if (!trimmedUrl) {
      setError('請填寫 API 端點 (Base URL)');
      return;
    }

    const config: LLMProviderConfig = {
      id: rawId,
      name: trimmedName,
      icon: iconInput.trim() || '🔌',
      description: descInput.trim() || trimmedUrl,
      badge: badgeInput.trim() || '自訂服務',
      protocol: protocolInput,
      defaultBaseUrl: trimmedUrl,
      defaultModel: defaultModelInput.trim() || 'default-model',
      requiresApiKey: requiresKeyInput,
      isBuiltin: false,
      enabled: true,
      category: 'custom',
    };

    onSaveProvider(config);
    onSelectProvider(config.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="flex w-full max-w-2xl max-h-[85vh] flex-col rounded-3xl border border-ag-border bg-ag-panel shadow-2xl overflow-hidden text-xs">
        {/* Modal Header */}
        <div className="flex h-13 items-center justify-between border-b border-ag-border px-5 bg-ag-sidebar">
          <div className="flex items-center space-x-2.5 text-sm font-semibold text-ag-textPrimary">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-ag-primaryLight text-ag-primary border border-ag-border shadow-soft">
              <Cpu className="h-4 w-4" />
            </div>
            <span>{isEditing ? `編輯服務商：${initialEditProvider?.name}` : '新增模型服務商與範本市集 (Provider Registry)'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-ag-textMuted hover:bg-ag-panel hover:text-ag-textPrimary transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        {!isEditing && (
          <div className="flex items-center justify-between border-b border-ag-border bg-ag-sidebar/50 px-5 py-2.5">
            <div className="flex items-center space-x-1.5 rounded-2xl border border-ag-border bg-ag-panel p-1 shadow-soft">
              <button
                type="button"
                onClick={() => setTab('presets')}
                className={`flex items-center space-x-1.5 rounded-xl px-3.5 py-1.5 font-medium transition-all cursor-pointer ${
                  tab === 'presets'
                    ? 'bg-ag-primary text-white shadow-xs'
                    : 'text-ag-textSecondary hover:text-ag-textPrimary'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>熱門服務商範本 ({PROVIDER_PRESETS.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('custom')}
                className={`flex items-center space-x-1.5 rounded-xl px-3.5 py-1.5 font-medium transition-all cursor-pointer ${
                  tab === 'custom'
                    ? 'bg-ag-primary text-white shadow-xs'
                    : 'text-ag-textSecondary hover:text-ag-textPrimary'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>完全自訂服務商 (Custom API)</span>
              </button>
            </div>
            <span className="text-[11px] text-ag-textMuted hidden sm:inline">
              免改程式碼，一鍵擴充 OpenAI / Anthropic / Ollama 相容供應商
            </span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {tab === 'presets' ? (
            <div className="space-y-4">
              {/* Search & Category Filter */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    placeholder="搜尋 DeepSeek, Groq, xAI, SiliconFlow, Mistral, LM Studio, vLLM..."
                    className="w-full rounded-xl border border-ag-border bg-white pl-9 pr-3 py-2 font-mono text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>
                <div className="flex items-center space-x-1 rounded-xl border border-ag-border bg-ag-sidebar/40 p-1">
                  {[
                    { id: 'all', label: '全部' },
                    { id: 'cloud', label: '官方雲端' },
                    { id: 'aggregator', label: '聚合平台' },
                    { id: 'local', label: '本機/私有' },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategoryFilter(c.id as any)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer ${
                        categoryFilter === c.id
                          ? 'bg-white text-slate-800 shadow-xs font-semibold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preset Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredPresets.map((preset) => {
                  const isAdded = existingIds.includes(preset.id);
                  return (
                    <div
                      key={preset.id}
                      className={`flex flex-col justify-between rounded-2xl border p-3.5 transition-all ${
                        isAdded
                          ? 'border-emerald-300/80 bg-emerald-50/30'
                          : 'border-ag-border bg-white hover:border-ag-blue/60 shadow-soft'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center space-x-2.5">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-lg shrink-0">
                              {preset.icon}
                            </span>
                            <div>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-semibold text-slate-800 text-xs">
                                  {preset.name}
                                </span>
                                {preset.badge && (
                                  <span className="rounded-md bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[9.5px] font-medium text-blue-700">
                                    {preset.badge}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[10px] text-slate-400 truncate max-w-[200px]">
                                {preset.defaultBaseUrl}
                              </div>
                            </div>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {preset.description}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-[10px] text-slate-400">
                            預設: {preset.defaultModel.split('/').pop()}
                          </span>
                          {preset.docUrl && (
                            <a
                              href={preset.docUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center space-x-0.5 text-[10px] text-ag-blue hover:underline"
                              title="取得 API Key"
                            >
                              <span>申請金鑰</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handlePrefillFromPreset(preset)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10.5px] text-slate-600 hover:bg-slate-50 cursor-pointer"
                          >
                            微調參數
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickApplyPreset(preset)}
                            className={`flex items-center space-x-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                              isAdded
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'bg-ag-primary text-white hover:opacity-90'
                            }`}
                          >
                            {isAdded ? (
                              <>
                                <Check className="h-3 w-3" />
                                <span>已加入 (切換)</span>
                              </>
                            ) : (
                              <>
                                <Plus className="h-3 w-3" />
                                <span>一鍵加入</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitCustom} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-rose-700 text-xs font-medium">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                    <Tag className="h-3.5 w-3.5 text-ag-blue" />
                    <span>顯示名稱 (Provider Name) *</span>
                  </label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => {
                      setNameInput(e.target.value);
                      if (!isEditing && !idInput) {
                        // optional auto-hint
                      }
                    }}
                    placeholder="例如: DeepSeek 官方, 公司內部 vLLM, Azure OpenAI..."
                    className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                    <Code2 className="h-3.5 w-3.5 text-ag-blue" />
                    <span>唯一識別碼 (Provider ID)</span>
                  </label>
                  <input
                    type="text"
                    value={idInput}
                    disabled={isEditing}
                    onChange={(e) => setIdInput(e.target.value)}
                    placeholder="例如: deepseek, company-vllm (留空自動產生)"
                    className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2 font-mono text-xs text-slate-800 outline-none focus:border-ag-blue shadow-soft disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
              </div>

              {/* Icon & Protocol */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-800 block">圖示 (Icon Emoji)</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={iconInput}
                      onChange={(e) => setIconInput(e.target.value)}
                      className="w-12 text-center rounded-xl border border-ag-border bg-white py-1.5 text-base outline-none focus:border-ag-blue shadow-soft"
                    />
                    <div className="flex items-center flex-wrap gap-1">
                      {EMOJI_OPTIONS.slice(0, 8).map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setIconInput(emoji)}
                          className={`h-7 w-7 rounded-lg border text-sm flex items-center justify-center cursor-pointer transition-all ${
                            iconInput === emoji
                              ? 'border-ag-blue bg-blue-50 shadow-xs'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                    <Layers className="h-3.5 w-3.5 text-ag-blue" />
                    <span>API 通訊協定 (Wire Protocol)</span>
                  </label>
                  <select
                    value={protocolInput}
                    onChange={(e) => setProtocolInput(e.target.value as LLMProviderProtocol)}
                    className="w-full rounded-xl border border-ag-border bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-ag-blue shadow-soft cursor-pointer"
                  >
                    <option value="openai-compatible">
                      OpenAI 相容協定 (/v1/chat/completions - 最通用)
                    </option>
                    <option value="anthropic">
                      Anthropic 相容協定 (/v1/messages)
                    </option>
                    <option value="ollama">
                      Ollama 本地協定 (/api/tags & /v1)
                    </option>
                  </select>
                </div>
              </div>

              {/* Base URL & Default Model */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                    <Globe className="h-3.5 w-3.5 text-ag-blue" />
                    <span>預設 API 端點 (Base URL) *</span>
                  </label>
                  <input
                    type="text"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    placeholder="例如: https://api.deepseek.com/v1 或 http://localhost:8000/v1"
                    className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2 font-mono text-xs text-slate-800 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center space-x-1.5 font-medium text-slate-800">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    <span>預設模型 ID (Default Model ID)</span>
                  </label>
                  <input
                    type="text"
                    value={defaultModelInput}
                    onChange={(e) => setDefaultModelInput(e.target.value)}
                    placeholder="例如: deepseek-chat, llama-3.3-70b..."
                    className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2 font-mono text-xs text-slate-800 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>
              </div>

              {/* Description & Badge */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-800 block">簡短說明 (Description)</label>
                  <input
                    type="text"
                    value={descInput}
                    onChange={(e) => setDescInput(e.target.value)}
                    placeholder="選填，顯示於服務商卡片副標題"
                    className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-slate-800 block">分類標籤 (Badge)</label>
                  <input
                    type="text"
                    value={badgeInput}
                    onChange={(e) => setBadgeInput(e.target.value)}
                    placeholder="例如: 私有部署, 雲端推理"
                    className="w-full rounded-xl border border-ag-border bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-ag-blue shadow-soft"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-ag-border">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-ag-border bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-1.5 rounded-xl bg-ag-primary px-5 py-2 text-xs font-semibold text-white hover:opacity-90 shadow-soft cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>{isEditing ? '儲存變更' : '新增並切換至此服務商'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
