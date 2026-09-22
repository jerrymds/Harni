import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Edit2,
  Folder,
  Globe,
  Key,
  Loader2,
  Power,
  Server,
  Shield,
  ShieldAlert,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { McpServerEntry } from './McpEditModal.js';

export interface McpServerLiveStatus {
  status: 'connected' | 'connecting' | 'error' | 'disconnected';
  toolCount: number;
  error?: string;
}

export interface McpServerLiveTool {
  name: string;
  description?: string;
}

interface McpServerCardProps {
  id: string;
  config: McpServerEntry;
  status?: McpServerLiveStatus;
  tools?: McpServerLiveTool[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onDuplicate: () => void;
}

export const McpServerCard: React.FC<McpServerCardProps> = ({
  id,
  config,
  status,
  tools,
  onEdit,
  onDelete,
  onToggle,
  onDuplicate,
}) => {
  const [copied, setCopied] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const isEnabled = !(config.disabled ?? false);
  const isSse = Boolean(config.serverUrl);

  const commandLine = isSse
    ? config.serverUrl
    : [config.command, ...(config.args || [])].filter(Boolean).join(' ');

  const envKeys = config.env ? Object.keys(config.env) : [];

  const handleCopyJson = () => {
    const jsonStr = JSON.stringify({ [id]: config }, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 shadow-soft overflow-hidden ${
        isEnabled
          ? 'border-ag-border bg-ag-panel/40 hover:border-ag-borderHover'
          : 'border-slate-200/60 bg-slate-50/50 opacity-65'
      }`}
    >
      {/* Card Header */}
      <div className="px-4 py-3 border-b border-ag-border flex items-center justify-between bg-ag-surface/50">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div
            className={`h-7 w-7 rounded-xl flex items-center justify-center shrink-0 border ${
              isEnabled
                ? 'bg-ag-primary/10 text-ag-primary border-ag-primary/20'
                : 'bg-slate-200 text-slate-500 border-slate-300'
            }`}
          >
            {isSse ? <Globe className="h-3.5 w-3.5" /> : <Server className="h-3.5 w-3.5" />}
          </div>
          <div className="flex items-center space-x-2 truncate">
            <span className="font-semibold text-ag-textPrimary text-xs truncate font-mono">{id}</span>
            <span
              className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border ${
                isSse
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              {isSse ? 'SSE 遠端' : 'Stdio 本機'}
            </span>

            {/* Connection Status Badge */}
            {status ? (
              status.status === 'connected' ? (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center space-x-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  <span>已連線 ({status.toolCount} 工具)</span>
                </span>
              ) : status.status === 'error' ? (
                <span
                  className="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200 flex items-center space-x-1 cursor-help"
                  title={status.error || '連線錯誤'}
                >
                  <AlertCircle className="h-3 w-3 text-rose-600" />
                  <span>連線失敗</span>
                </span>
              ) : status.status === 'connecting' ? (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 flex items-center space-x-1">
                  <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
                  <span>連線中...</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200 flex items-center space-x-1">
                  <span>已中斷</span>
                </span>
              )
            ) : !isEnabled ? (
              <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                已停用
              </span>
            ) : null}

            {config.requiresApproval ? (
              <span className="px-1.5 py-0.5 rounded-lg text-[10px] bg-amber-50 text-amber-700 border border-amber-200 flex items-center space-x-0.5">
                <ShieldAlert className="h-2.5 w-2.5" />
                <span>需審批</span>
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-lg text-[10px] bg-slate-100 text-slate-600 border border-slate-200 flex items-center space-x-0.5">
                <Shield className="h-2.5 w-2.5" />
                <span>自動核准</span>
              </span>
            )}
          </div>
        </div>

        {/* Toggle Switch */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => onToggle(!isEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              isEnabled ? 'bg-ag-primary' : 'bg-slate-300'
            }`}
            title={isEnabled ? '停用此伺服器' : '啟用此伺服器'}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                isEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Card Body */}
      <div className="p-3.5 space-y-2.5 text-xs">
        {/* Error notification if server failed */}
        {status?.status === 'error' && status.error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-2.5 text-[11px] text-rose-700 flex items-start space-x-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div className="flex-1 overflow-hidden">
              <span className="font-semibold block mb-0.5">伺服器啟動或通訊異常：</span>
              <p className="font-mono text-[10px] break-all text-rose-800/90 whitespace-pre-wrap">{status.error}</p>
            </div>
          </div>
        )}

        {/* Command or URL block */}
        <div className="rounded-xl border border-ag-border bg-ag-panel px-3 py-2 font-mono text-[11px] text-ag-textPrimary break-all select-all flex items-start space-x-2">
          <Terminal className="h-3.5 w-3.5 text-ag-primary shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{commandLine}</span>
        </div>

        {/* Discovered tools collapsible list */}
        {tools && tools.length > 0 && (
          <div className="rounded-xl border border-ag-border bg-ag-surface/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowTools(!showTools)}
              className="w-full px-3 py-1.5 text-[11px] flex items-center justify-between text-ag-textSecondary hover:text-ag-textPrimary hover:bg-ag-panel/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center space-x-1.5 font-medium">
                <Wrench className="h-3 w-3 text-ag-primary" />
                <span>已發現工具 ({tools.length})</span>
              </div>
              {showTools ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showTools && (
              <div className="px-3 py-2 border-t border-ag-border space-y-1.5 max-h-40 overflow-y-auto">
                {tools.map((t) => (
                  <div key={t.name} className="text-[10.5px]">
                    <span className="font-mono font-semibold text-ag-primary">{t.name}</span>
                    {t.description && (
                      <p className="text-ag-textSecondary truncate">{t.description.replace(/^\[MCP:[^\]]+\]\s*/, '')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info pills: CWD & Env Variables */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
          {config.cwd && (
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-ag-surface border border-ag-border text-ag-textSecondary font-mono">
              <Folder className="h-3 w-3 text-ag-primary" />
              <span>目錄: {config.cwd}</span>
            </span>
          )}

          {envKeys.length > 0 ? (
            envKeys.map((key) => (
              <span
                key={key}
                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 font-mono"
              >
                <Key className="h-2.5 w-2.5 text-amber-600" />
                <span>{key}: ••••••••</span>
              </span>
            ))
          ) : (
            <span className="text-[10px] text-ag-textMuted">無自訂環境變數</span>
          )}
        </div>
      </div>

      {/* Card Footer Actions */}
      <div className="px-3.5 py-2 border-t border-ag-border bg-ag-panel/30 flex items-center justify-end space-x-1.5">
        <button
          type="button"
          onClick={handleCopyJson}
          className="px-2.5 py-1 rounded-xl text-[11px] font-medium border border-ag-border bg-ag-surface hover:bg-ag-panel text-ag-textSecondary hover:text-ag-textPrimary transition-colors flex items-center space-x-1 cursor-pointer shadow-soft"
          title="複製此伺服器 JSON 設定"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? '已複製' : '複製 JSON'}</span>
        </button>

        <button
          type="button"
          onClick={onEdit}
          className="px-2.5 py-1 rounded-xl text-[11px] font-medium border border-ag-border bg-ag-surface hover:bg-ag-panel text-ag-textPrimary transition-colors flex items-center space-x-1 cursor-pointer shadow-soft"
          title="編輯設定"
        >
          <Edit2 className="h-3 w-3 text-ag-primary" />
          <span>編輯</span>
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="px-2.5 py-1 rounded-xl text-[11px] font-medium border border-rose-200/80 bg-rose-50/50 hover:bg-rose-100 text-rose-600 transition-colors flex items-center space-x-1 cursor-pointer"
          title="刪除此伺服器"
        >
          <Trash2 className="h-3 w-3" />
          <span>刪除</span>
        </button>
      </div>
    </div>
  );
};
