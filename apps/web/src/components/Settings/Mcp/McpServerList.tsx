import React from 'react';
import { Plus, Server } from 'lucide-react';
import { McpServerCard, type McpServerLiveStatus, type McpServerLiveTool } from './McpServerCard.js';
import type { McpServerEntry } from './McpEditModal.js';

interface McpServerListProps {
  filteredServerIds: string[];
  serversMap: Record<string, McpServerEntry>;
  liveStatuses: Record<string, McpServerLiveStatus>;
  liveTools: McpServerLiveTool[];
  searchQuery: string;
  configuredCount: number;
  activeCount: number;
  onOpenAddModal: () => void;
  onEditServer: (id: string) => void;
  onDeleteServer: (id: string) => void;
  onToggleServer: (id: string, enabled: boolean) => void;
  onDuplicateServer: (id: string) => void;
}

export const McpServerList: React.FC<McpServerListProps> = ({
  filteredServerIds,
  serversMap,
  liveStatuses,
  liveTools,
  searchQuery,
  configuredCount,
  activeCount,
  onOpenAddModal,
  onEditServer,
  onDeleteServer,
  onToggleServer,
  onDuplicateServer,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5 text-[12.5px]">
          <Server className="h-4 w-4 text-ag-primary" />
          <span>已設定伺服器清單 ({filteredServerIds.length})</span>
        </label>
        {configuredCount > 0 && (
          <span className="text-[11px] text-ag-textMuted">
            已啟用 {activeCount} 個 / 共有 {configuredCount} 個
          </span>
        )}
      </div>

      {filteredServerIds.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ag-border bg-ag-panel/30 p-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-ag-primary/10 text-ag-primary mx-auto flex items-center justify-center border border-ag-primary/20">
            <Server className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold text-ag-textPrimary text-xs">
              {searchQuery ? '找不到符合搜尋條件的 MCP 伺服器' : '尚未設定任何 MCP 伺服器'}
            </p>
            <p className="text-[11px] text-ag-textMuted mt-1">
              {searchQuery
                ? '請嘗試更換搜尋關鍵字，或新增自訂伺服器。'
                : '您可以點擊下方「推薦市集套件」一鍵加入常用工具，或手動自訂新增。'}
            </p>
          </div>
          {!searchQuery && (
            <button
              type="button"
              onClick={onOpenAddModal}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-2xl bg-ag-primary text-white font-medium hover:opacity-90 transition-all cursor-pointer shadow-soft"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增自訂 MCP 伺服器</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredServerIds.map((id) => {
            const sanitizedId = id.replace(/[^A-Za-z0-9_-]/g, '_');
            const prefix = `mcp__${sanitizedId}__`;
            const matchingTools = liveTools.filter((t) => t.name.startsWith(prefix));
            const config = serversMap[id];
            if (!config) return null;

            return (
              <McpServerCard
                key={id}
                id={id}
                config={config}
                status={liveStatuses[id]}
                tools={matchingTools}
                onEdit={() => onEditServer(id)}
                onDelete={() => onDeleteServer(id)}
                onToggle={(enabled) => onToggleServer(id, enabled)}
                onDuplicate={() => onDuplicateServer(id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
