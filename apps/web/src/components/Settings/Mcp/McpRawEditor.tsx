import React from 'react';
import { AlertCircle, Code2 } from 'lucide-react';

interface McpRawEditorProps {
  mcpConfig: string;
  mcpJsonError: string | null;
  onConfigChange: (config: string) => void;
  onErrorChange: (error: string | null) => void;
}

export const McpRawEditor: React.FC<McpRawEditorProps> = ({
  mcpConfig,
  mcpJsonError,
  onConfigChange,
  onErrorChange,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-1.5 font-medium text-ag-textPrimary">
          <Code2 className="h-3.5 w-3.5 text-ag-primary" />
          <span>MCP 伺服器清單設定 (JSON Configuration)</span>
        </label>
        {mcpJsonError && (
          <span className="text-[10.5px] text-rose-600 font-mono flex items-center space-x-1 animate-in fade-in">
            <AlertCircle className="h-3 w-3" />
            <span>{mcpJsonError}</span>
          </span>
        )}
      </div>

      <textarea
        rows={12}
        value={mcpConfig}
        onChange={(e) => {
          onConfigChange(e.target.value);
          try {
            JSON.parse(e.target.value);
            onErrorChange(null);
          } catch {
            onErrorChange('JSON 格式尚未合法');
          }
        }}
        placeholder="輸入 MCP 伺服器 JSON 設定..."
        className="w-full rounded-2xl border border-ag-border bg-ag-panel p-3.5 font-mono text-xs text-ag-textPrimary placeholder-ag-textMuted outline-none focus:border-ag-primary shadow-soft leading-relaxed custom-scrollbar"
      />

      <p className="text-[11px] text-ag-textMuted">
        💡 提示：您可以在此直接貼上任何相容 Claude Desktop 或 Cursor 的 <code className="text-ag-primary font-mono">mcpServers</code> JSON 物件，切換回視覺化管理時將自動同步解析。
      </p>
    </div>
  );
};
