import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Code2,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Server,
  Sparkles,
} from 'lucide-react';
import { type McpPreset } from './mcpPresets.js';
import { McpEditModal, type McpServerEntry } from './McpEditModal.js';
import {
  type McpServerLiveStatus,
  type McpServerLiveTool,
} from './McpServerCard.js';
import { McpServerList } from './McpServerList.js';
import { McpPresetMarketplace } from './McpPresetMarketplace.js';
import { McpRawEditor } from './McpRawEditor.js';

interface McpManagerProps {
  mcpEnabled: boolean;
  onMcpEnabledChange: (enabled: boolean) => void;
  mcpConfig: string;
  onMcpConfigChange: (config: string) => void;
  mcpJsonError: string | null;
  setMcpJsonError: (error: string | null) => void;
}

export const McpManager: React.FC<McpManagerProps> = ({
  mcpEnabled,
  onMcpEnabledChange,
  mcpConfig,
  onMcpConfigChange,
  mcpJsonError,
  setMcpJsonError,
}) => {
  const [viewMode, setViewMode] = useState<'visual' | 'raw'>('visual');
  const [serversMap, setServersMap] = useState<Record<string, McpServerEntry>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<{
    id: string;
    config: McpServerEntry;
    envDescriptions?: Record<string, string>;
  } | null>(null);

  const [liveStatuses, setLiveStatuses] = useState<Record<string, McpServerLiveStatus>>({});
  const [liveTools, setLiveTools] = useState<McpServerLiveTool[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/status');
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, McpServerLiveStatus> = {};
        if (Array.isArray(data.servers)) {
          data.servers.forEach((s: any) => {
            map[s.name] = {
              status: s.status,
              toolCount: s.toolCount,
              error: s.error,
            };
          });
        }
        setLiveStatuses(map);
        if (Array.isArray(data.tools)) {
          setLiveTools(data.tools);
        }
      }
    } catch {
      // Ignored
    }
  }, []);

  const handleRestart = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/mcp/restart', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, McpServerLiveStatus> = {};
        if (Array.isArray(data.statuses)) {
          data.statuses.forEach((s: any) => {
            map[s.name] = {
              status: s.status,
              toolCount: s.toolCount,
              error: s.error,
            };
          });
        }
        setLiveStatuses(map);
        if (Array.isArray(data.tools)) {
          setLiveTools(data.tools);
        }
      }
    } catch (e) {
      console.error('Failed to restart MCP servers:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Parse JSON string into server map when mcpConfig changes
  useEffect(() => {
    try {
      if (!mcpConfig.trim()) {
        setServersMap({});
        setMcpJsonError(null);
        return;
      }
      const parsed = JSON.parse(mcpConfig);
      if (parsed && typeof parsed === 'object') {
        const servers = (parsed.mcpServers && typeof parsed.mcpServers === 'object')
          ? parsed.mcpServers
          : parsed;
        setServersMap(servers);
        setMcpJsonError(null);
      }
    } catch (err: any) {
      setMcpJsonError('JSON 格式尚未合法');
    }
  }, [mcpConfig, setMcpJsonError]);

  // Helper to sync server map back to JSON string
  const updateServers = (newMap: Record<string, McpServerEntry>) => {
    setServersMap(newMap);
    const jsonStr = JSON.stringify({ mcpServers: newMap }, null, 2);
    onMcpConfigChange(jsonStr);
    setMcpJsonError(null);
  };

  const handleOpenAddModal = () => {
    setEditingServer(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (id: string) => {
    const config = serversMap[id];
    if (config) {
      setEditingServer({ id, config });
      setIsModalOpen(true);
    }
  };

  const handleApplyPreset = (preset: McpPreset) => {
    const existing = serversMap[preset.id];
    if (existing) {
      handleOpenEditModal(preset.id);
      return;
    }

    const newConfig: McpServerEntry = {
      command: preset.command,
      args: [...preset.args],
      env: { ...preset.env },
      requiresApproval: preset.requiresApproval ?? true,
    };
    if (preset.serverUrl) {
      newConfig.serverUrl = preset.serverUrl;
    }

    setEditingServer({
      id: preset.id,
      config: newConfig,
      envDescriptions: preset.envDescriptions,
    });
    setIsModalOpen(true);
  };

  const handleSaveServer = (
    id: string,
    config: McpServerEntry,
    isEditing: boolean,
    oldId?: string,
  ) => {
    const next = { ...serversMap };
    if (isEditing && oldId && oldId !== id) {
      delete next[oldId];
    }
    next[id] = config;
    updateServers(next);
  };

  const handleDeleteServer = (id: string) => {
    const next = { ...serversMap };
    delete next[id];
    updateServers(next);
  };

  const handleToggleServer = (id: string, enabled: boolean) => {
    const current = serversMap[id];
    if (!current) return;
    const next = {
      ...serversMap,
      [id]: {
        ...current,
        disabled: !enabled,
      },
    };
    updateServers(next);
  };

  const handleDuplicateServer = (id: string) => {
    const target = serversMap[id];
    if (!target) return;
    const baseId = `${id}-copy`;
    let newId = baseId;
    let count = 1;
    while (serversMap[newId]) {
      newId = `${baseId}-${count++}`;
    }
    handleSaveServer(newId, { ...target }, false);
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(mcpConfig);
      const formatted = JSON.stringify(parsed, null, 2);
      onMcpConfigChange(formatted);
      setMcpJsonError(null);
    } catch {
      // ignore
    }
  };

  // Filtered servers list
  const filteredServerIds = useMemo(() => {
    const ids = Object.keys(serversMap);
    if (!searchQuery.trim()) return ids;
    const q = searchQuery.toLowerCase();
    return ids.filter((id) => {
      const item = serversMap[id];
      const matchId = id.toLowerCase().includes(q);
      const matchCmd = item?.command?.toLowerCase().includes(q);
      const matchArgs = item?.args?.some((a) => a.toLowerCase().includes(q));
      const matchUrl = item?.serverUrl?.toLowerCase().includes(q);
      return matchId || matchCmd || matchArgs || matchUrl;
    });
  }, [serversMap, searchQuery]);

  const configuredCount = Object.keys(serversMap).length;
  const activeCount = Object.values(serversMap).filter((s) => !s.disabled).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-150 text-xs">
      {/* 1. Global MCP Enable Switch */}
      <div className="rounded-2xl border border-ag-border bg-ag-sidebar/30 p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 max-w-[80%]">
            <div className="flex items-center space-x-2 text-xs font-semibold text-ag-textPrimary">
              <Server className="h-4 w-4 text-ag-primary" />
              <span>啟用 Model Context Protocol (MCP) 協議擴充</span>
            </div>
            <p className="text-[11px] text-ag-textSecondary leading-relaxed">
              允許 Agent 透過標準 MCP 協議動態擴充外部資料庫、GitHub API、瀏覽器自動化與本機檔案等工具。
            </p>
          </div>

          <button
            type="button"
            onClick={() => onMcpEnabledChange(!mcpEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              mcpEnabled ? 'bg-ag-primary' : 'bg-slate-300'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                mcpEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 2. Mode Selector Bar (Visual vs Raw JSON) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <div className="flex items-center rounded-2xl border border-ag-border p-1 bg-ag-panel shadow-soft self-start">
          <button
            type="button"
            onClick={() => setViewMode('visual')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
              viewMode === 'visual'
                ? 'bg-ag-primary text-white shadow-sm'
                : 'text-ag-textSecondary hover:text-ag-textPrimary'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>視覺化管理 ({activeCount}/{configuredCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('raw')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
              viewMode === 'raw'
                ? 'bg-ag-primary text-white shadow-sm'
                : 'text-ag-textSecondary hover:text-ag-textPrimary'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>JSON 原始碼</span>
          </button>
        </div>

        {viewMode === 'visual' ? (
          <div className="flex items-center space-x-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-ag-textMuted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋已設定伺服器..."
                className="pl-8 pr-3 py-1.5 rounded-2xl border border-ag-border bg-ag-panel text-ag-textPrimary font-mono text-[11px] outline-none focus:border-ag-primary shadow-soft w-48"
              />
            </div>
            <button
              type="button"
              onClick={handleRestart}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded-2xl border border-ag-border bg-ag-surface hover:bg-ag-panel text-ag-textPrimary font-medium transition-all flex items-center space-x-1.5 cursor-pointer shadow-soft text-xs shrink-0 disabled:opacity-50"
              title="重新載入並連線所有已啟用的 MCP 伺服器"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-ag-primary ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? '連線中...' : '重新連線'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="px-3.5 py-1.5 rounded-2xl bg-ag-primary text-white font-medium hover:opacity-90 transition-all flex items-center space-x-1 cursor-pointer shadow-soft text-xs shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增伺服器</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleFormatJson}
            className="px-3 py-1.5 rounded-2xl border border-ag-border bg-ag-surface hover:bg-ag-panel text-ag-textPrimary font-medium transition-colors flex items-center space-x-1.5 cursor-pointer shadow-soft self-start"
          >
            <Sparkles className="h-3.5 w-3.5 text-ag-primary" />
            <span>自動排版 JSON</span>
          </button>
        )}
      </div>

      {/* 3. VISUAL MODE VIEW */}
      {viewMode === 'visual' && (
        <div className="space-y-6">
          <McpServerList
            filteredServerIds={filteredServerIds}
            serversMap={serversMap}
            liveStatuses={liveStatuses}
            liveTools={liveTools}
            searchQuery={searchQuery}
            configuredCount={configuredCount}
            activeCount={activeCount}
            onOpenAddModal={handleOpenAddModal}
            onEditServer={handleOpenEditModal}
            onDeleteServer={handleDeleteServer}
            onToggleServer={handleToggleServer}
            onDuplicateServer={handleDuplicateServer}
          />
          <McpPresetMarketplace
            serversMap={serversMap}
            onApplyPreset={handleApplyPreset}
          />
        </div>
      )}

      {/* 4. RAW JSON MODE VIEW */}
      {viewMode === 'raw' && (
        <McpRawEditor
          mcpConfig={mcpConfig}
          mcpJsonError={mcpJsonError}
          onConfigChange={onMcpConfigChange}
          onErrorChange={setMcpJsonError}
        />
      )}

      {/* Modal for Add / Edit Server */}
      <McpEditModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingServer(null);
        }}
        onSave={handleSaveServer}
        initialData={editingServer}
        existingIds={Object.keys(serversMap)}
      />
    </div>
  );
};
