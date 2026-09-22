import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Folder,
  Globe,
  HelpCircle,
  Key,
  Plus,
  Server,
  Shield,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { validateAndBuildMcpServer } from './mcpValidation.js';

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  serverUrl?: string;
  requiresApproval?: boolean;
  cwd?: string;
  callTimeoutMs?: number;
  disabled?: boolean;
}

interface McpEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, config: McpServerEntry, isEditing: boolean, oldId?: string) => void;
  initialData?: { id: string; config: McpServerEntry; envDescriptions?: Record<string, string> } | null;
  existingIds: string[];
}

export const McpEditModal: React.FC<McpEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  existingIds,
}) => {
  const isEditing = Boolean(initialData?.id);
  const oldId = initialData?.id;

  const [id, setId] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState<string[]>([]);
  const [argInput, setArgInput] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [cwd, setCwd] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [envList, setEnvList] = useState<Array<{ key: string; value: string; isSecret: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (initialData) {
      setId(initialData.id || '');
      const cfg = initialData.config;
      if (cfg.serverUrl) {
        setTransport('sse');
        setServerUrl(cfg.serverUrl);
      } else {
        setTransport('stdio');
        setCommand(cfg.command || 'npx');
        setArgs(Array.isArray(cfg.args) ? [...cfg.args] : []);
        setCwd(cfg.cwd || '');
      }
      setRequiresApproval(cfg.requiresApproval ?? true);

      // Populate Env List
      if (cfg.env && typeof cfg.env === 'object') {
        const envEntries = Object.entries(cfg.env).map(([k, v]) => ({
          key: k,
          value: String(v),
          isSecret: true,
        }));
        setEnvList(envEntries);
      } else {
        setEnvList([]);
      }
    } else {
      // Defaults for new server
      setId('');
      setTransport('stdio');
      setCommand('npx');
      setArgs([]);
      setArgInput('');
      setServerUrl('');
      setCwd('');
      setRequiresApproval(true);
      setEnvList([]);
    }
    setError(null);
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleAddArg = () => {
    const trimmed = argInput.trim();
    if (!trimmed) return;
    // Support pasting multiple space-separated arguments if they start with '-' or are commands
    setArgs([...args, trimmed]);
    setArgInput('');
  };

  const handleRemoveArg = (index: number) => {
    setArgs(args.filter((_, i) => i !== index));
  };

  const handleAddEnv = () => {
    setEnvList([...envList, { key: '', value: '', isSecret: true }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value' | 'isSecret', val: any) => {
    const next = [...envList];
    next[index] = { ...next[index], [field]: val };
    setEnvList(next);
  };

  const handleRemoveEnv = (index: number) => {
    setEnvList(envList.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateAndBuildMcpServer({
      id,
      isEditing,
      oldId,
      existingIds,
      transport,
      command,
      args,
      serverUrl,
      cwd,
      requiresApproval,
      disabled: initialData?.config.disabled,
      envList,
    });

    if (!result.isValid || !result.cleanId || !result.config) {
      setError(result.error || '伺服器設定不合法');
      return;
    }

    onSave(result.cleanId, result.config, isEditing, oldId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-ag-surface border border-ag-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-ag-border flex items-center justify-between bg-ag-panel">
          <div className="flex items-center space-x-2.5">
            <div className="h-9 w-9 rounded-2xl bg-ag-primary/10 text-ag-primary flex items-center justify-center border border-ag-primary/20">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ag-textPrimary">
                {isEditing ? `編輯 MCP 伺服器 (${id || oldId})` : '新增 MCP 伺服器'}
              </h3>
              <p className="text-[11px] text-ag-textMuted mt-0.5">
                設定 Agent 透過 Model Context Protocol 連線的自訂伺服器
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-ag-textMuted hover:text-ag-textPrimary hover:bg-ag-surface transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar text-xs">
          {error && (
            <div className="flex items-center space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs animate-in shake">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Server ID & Transport Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5">
                <span>伺服器唯一識別碼 (ID)</span>
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setError(null);
                }}
                placeholder="例如: github, postgres, my-tool"
                className="w-full px-3.5 py-2.5 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono outline-none focus:border-ag-primary shadow-soft"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-ag-textPrimary">傳輸通訊協定 (Transport)</label>
              <div className="flex rounded-2xl border border-ag-border p-1 bg-ag-panel shadow-soft">
                <button
                  type="button"
                  onClick={() => setTransport('stdio')}
                  className={`flex-1 py-1.5 rounded-xl text-center font-medium transition-all cursor-pointer ${
                    transport === 'stdio'
                      ? 'bg-ag-primary text-white shadow-sm'
                      : 'text-ag-textSecondary hover:text-ag-textPrimary'
                  }`}
                >
                  Stdio (本機指令)
                </button>
                <button
                  type="button"
                  onClick={() => setTransport('sse')}
                  className={`flex-1 py-1.5 rounded-xl text-center font-medium transition-all cursor-pointer ${
                    transport === 'sse'
                      ? 'bg-ag-primary text-white shadow-sm'
                      : 'text-ag-textSecondary hover:text-ag-textPrimary'
                  }`}
                >
                  SSE (遠端 URL)
                </button>
              </div>
            </div>
          </div>

          {/* Stdio Form */}
          {transport === 'stdio' && (
            <>
              {/* Command */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5">
                    <Terminal className="h-3.5 w-3.5 text-ag-primary" />
                    <span>執行指令 (Command)</span>
                    <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center space-x-1 text-[10px]">
                    <span className="text-ag-textMuted">快捷選擇:</span>
                    {['npx', 'uvx', 'python', 'node', 'docker'].map((cmd) => (
                      <button
                        key={cmd}
                        type="button"
                        onClick={() => setCommand(cmd)}
                        className={`px-1.5 py-0.5 rounded-md border font-mono transition-colors cursor-pointer ${
                          command === cmd
                            ? 'bg-ag-primary text-white border-ag-primary'
                            : 'bg-ag-panel border-ag-border text-ag-textSecondary hover:text-ag-textPrimary'
                        }`}
                      >
                        {cmd}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  required
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="例如: npx, python, node"
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono outline-none focus:border-ag-primary shadow-soft"
                />
              </div>

              {/* Arguments */}
              <div className="space-y-2">
                <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5">
                  <span>執行參數清單 (Arguments)</span>
                </label>

                {args.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-2.5 rounded-2xl border border-ag-border bg-ag-panel/50">
                    {args.map((arg, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-ag-surface border border-ag-border text-[11px] font-mono text-ag-textPrimary shadow-sm"
                      >
                        <span>{arg}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveArg(idx)}
                          className="text-ag-textMuted hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={argInput}
                    onChange={(e) => setArgInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddArg();
                      }
                    }}
                    placeholder="輸入單一參數 (如 -y 或 @org/server) 按 Enter 加入"
                    className="flex-1 px-3.5 py-2 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono outline-none focus:border-ag-primary shadow-soft"
                  />
                  <button
                    type="button"
                    onClick={handleAddArg}
                    className="px-3.5 py-2 rounded-2xl border border-ag-border bg-ag-surface hover:bg-ag-panel text-ag-textPrimary font-medium flex items-center space-x-1 cursor-pointer transition-colors shadow-soft"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>加入</span>
                  </button>
                </div>
              </div>

              {/* Working Directory */}
              <div className="space-y-1.5">
                <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5">
                  <Folder className="h-3.5 w-3.5 text-ag-primary" />
                  <span>指定工作目錄 (Working Directory - 選填)</span>
                </label>
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="留空則預設為目前工作區根目錄"
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono outline-none focus:border-ag-primary shadow-soft"
                />
              </div>

              {/* Environment Variables */}
              <div className="space-y-2 pt-1 border-t border-ag-border">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5">
                    <Key className="h-3.5 w-3.5 text-ag-primary" />
                    <span>環境變數 (Environment Variables / API Tokens)</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddEnv}
                    className="text-[11px] font-medium text-ag-primary hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>新增變數</span>
                  </button>
                </div>

                {envList.length === 0 ? (
                  <p className="text-[11px] text-ag-textMuted py-1">無額外環境變數，將自動繼承系統環境。</p>
                ) : (
                  <div className="space-y-2">
                    {envList.map((item, idx) => (
                      <div key={idx} className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={item.key}
                          onChange={(e) => handleUpdateEnv(idx, 'key', e.target.value)}
                          placeholder="KEY (例如 GITHUB_TOKEN)"
                          className="w-1/3 px-3 py-2 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono outline-none focus:border-ag-primary shadow-soft"
                        />
                        <div className="relative flex-1">
                          <input
                            type={item.isSecret ? 'password' : 'text'}
                            value={item.value}
                            onChange={(e) => handleUpdateEnv(idx, 'value', e.target.value)}
                            placeholder="變數值或密鑰"
                            className="w-full pl-3 pr-8 py-2 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono outline-none focus:border-ag-primary shadow-soft"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateEnv(idx, 'isSecret', !item.isSecret)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ag-textMuted hover:text-ag-textPrimary cursor-pointer"
                            title={item.isSecret ? '顯示明文' : '隱藏密碼'}
                          >
                            {item.isSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveEnv(idx)}
                          className="p-2 text-ag-textMuted hover:text-rose-500 rounded-xl hover:bg-rose-50 transition-colors cursor-pointer"
                          title="刪除此變數"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* SSE Form */}
          {transport === 'sse' && (
            <div className="space-y-1.5">
              <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5">
                <Globe className="h-3.5 w-3.5 text-ag-primary" />
                <span>SSE 伺服器端點 URL (Server URL)</span>
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="url"
                required
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://mcp.example.com/sse 或 http://localhost:8000/sse"
                className="w-full px-3.5 py-2.5 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono outline-none focus:border-ag-primary shadow-soft"
              />
            </div>
          )}

          {/* Security & Approval Option */}
          <div className="pt-2 border-t border-ag-border">
            <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-2xl border border-ag-border bg-ag-panel/50 hover:bg-ag-panel transition-colors">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="h-4 w-4 rounded border-ag-border text-ag-primary focus:ring-ag-primary cursor-pointer"
              />
              <div className="flex-1">
                <div className="flex items-center space-x-1.5 font-medium text-ag-textPrimary">
                  <Shield className="h-3.5 w-3.5 text-ag-primary" />
                  <span>工具調用審批 (Requires Manual Approval)</span>
                </div>
                <p className="text-[10.5px] text-ag-textMuted mt-0.5">
                  開啟後，Agent 每次呼叫此伺服器的 Tool 皆需使用者點擊批准方可執行。
                </p>
              </div>
            </label>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end space-x-2.5 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-2xl border border-ag-border text-ag-textSecondary hover:bg-ag-panel font-medium transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-2xl bg-ag-primary text-white font-medium hover:opacity-90 shadow-soft transition-all cursor-pointer"
            >
              {isEditing ? '儲存變更' : '新增伺服器'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
