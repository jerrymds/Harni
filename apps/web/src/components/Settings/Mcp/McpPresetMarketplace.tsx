import React from 'react';
import { Check, Plus, Sparkles } from 'lucide-react';
import { MCP_PRESETS, type McpPreset } from './mcpPresets.js';
import type { McpServerEntry } from './McpEditModal.js';

interface McpPresetMarketplaceProps {
  serversMap: Record<string, McpServerEntry>;
  onApplyPreset: (preset: McpPreset) => void;
}

export const McpPresetMarketplace: React.FC<McpPresetMarketplaceProps> = ({
  serversMap,
  onApplyPreset,
}) => {
  return (
    <div className="space-y-3 pt-3 border-t border-ag-border">
      <div className="flex items-center justify-between">
        <div>
          <label className="font-semibold text-ag-textPrimary flex items-center space-x-1.5 text-[12.5px]">
            <Sparkles className="h-4 w-4 text-ag-primary" />
            <span>💡 精選推薦 MCP 伺服器市集 (Preset Marketplace)</span>
          </label>
          <p className="text-[11px] text-ag-textMuted mt-0.5">
            點擊「+ 一鍵加入」即可自動載入標準參數與環境變數模板
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MCP_PRESETS.map((preset) => {
          const isAdded = Boolean(serversMap[preset.id]);
          return (
            <div
              key={preset.id}
              className="flex flex-col justify-between p-3.5 rounded-2xl border border-ag-border bg-ag-panel/40 hover:bg-ag-panel hover:border-ag-borderHover transition-all shadow-soft group"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-ag-textPrimary text-xs">{preset.name}</span>
                    <span className="px-2 py-0.5 rounded-lg text-[9.5px] font-medium bg-ag-primaryLight text-ag-primary border border-ag-primary/20">
                      {preset.badge}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-ag-textSecondary leading-relaxed line-clamp-2">
                  {preset.description}
                </p>
                <div className="font-mono text-[10px] text-ag-primary bg-ag-surface px-2.5 py-1.5 rounded-xl border border-ag-border break-all">
                  {preset.command} {preset.args.join(' ')}
                </div>
              </div>

              <div className="pt-3 mt-2 border-t border-ag-border/60 flex items-center justify-between">
                <span className="text-[10px] font-mono text-ag-textMuted">
                  {preset.npmPackage || preset.id}
                </span>
                <button
                  type="button"
                  onClick={() => onApplyPreset(preset)}
                  className={`px-3 py-1 rounded-xl font-medium text-[11px] flex items-center space-x-1 transition-all cursor-pointer shadow-soft ${
                    isAdded
                      ? 'bg-ag-surface border border-ag-border text-emerald-700 hover:bg-ag-panel'
                      : 'bg-ag-primary text-white hover:opacity-90'
                  }`}
                >
                  {isAdded ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-600" />
                      <span>已加入 (點擊編輯)</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3" />
                      <span>+ 一鍵加入</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
