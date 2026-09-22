import React, { useEffect, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import {
  Check,
  Code2,
  FileCode,
  GitCompare,
  Layers,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';

export const EditorPanel: React.FC = () => {
  const {
    activeFile,
    activeDiff,
    saveActiveFile,
    closeActiveFile,
    setActiveDiff,
    theme,
  } = useAgentStore(
    useShallow((s) => ({
      activeFile: s.activeFile,
      activeDiff: s.activeDiff,
      saveActiveFile: s.saveActiveFile,
      closeActiveFile: s.closeActiveFile,
      setActiveDiff: s.setActiveDiff,
      theme: s.theme,
    }))
  );

  const isDark = theme === 'dark' || theme === 'charcoal';
  const [currentContent, setCurrentContent] = useState('');

  useEffect(() => {
    if (activeFile) {
      setCurrentContent(activeFile.content);
    }
  }, [activeFile]);

  const getLanguage = (path: string) => {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.md')) return 'markdown';
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.sh') || path.endsWith('.ps1')) return 'shell';
    return 'plaintext';
  };

  const handleSave = () => {
    if (activeFile) {
      saveActiveFile(currentContent);
    }
  };

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentContent, activeFile]);

  // Diff Review View
  if (activeDiff) {
    return (
      <div className="flex h-full flex-col bg-ag-bg select-none">
        <div className="flex h-10 items-center justify-between border-b border-ag-border bg-ag-panel px-4 shadow-soft">
          <div className="flex items-center space-x-2.5 text-xs font-medium text-ag-textPrimary">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-ag-primaryLight text-ag-primary border border-ag-border">
              <GitCompare className="h-3.5 w-3.5" />
            </div>
            <span className="font-mono text-[12px]">{activeDiff.path}</span>
            {activeDiff.isNewFile && (
              <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                新增檔案 (New File)
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveDiff(null)}
              className="flex items-center space-x-1.5 rounded-lg border border-ag-border bg-ag-panel px-3 py-1 text-xs font-medium text-ag-textSecondary hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800 transition-all cursor-pointer shadow-soft"
            >
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              <span>關閉審查 (Done)</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-ag-panel">
          <DiffEditor
            height="100%"
            language={getLanguage(activeDiff.path)}
            original={activeDiff.originalContent}
            modified={activeDiff.newContent}
            theme={isDark ? 'vs-dark' : 'vs'}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    );
  }

  // Standard File Editor
  if (activeFile) {
    return (
      <div className="flex h-full flex-col bg-ag-bg">
        {/* Sleek File Tab */}
        <div className="flex h-10 items-center justify-between border-b border-ag-border bg-ag-sidebar px-3 select-none">
          <div className="flex items-center space-x-1">
            <div className="flex items-center space-x-2 rounded-t-lg border-t-2 border-ag-primary bg-ag-panel px-3.5 py-1.5 text-xs text-ag-textPrimary font-mono shadow-soft">
              <FileCode className="h-3.5 w-3.5 text-ag-primary" />
              <span className="font-medium text-[12px]">{activeFile.path.split(/[\\/]/).pop()}</span>
              {currentContent !== activeFile.content && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" title="Unsaved changes" />
              )}
              <button
                onClick={closeActiveFile}
                className="ml-1 rounded-sm p-0.5 text-ag-textMuted hover:bg-ag-sidebar hover:text-ag-textPrimary cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              className="flex items-center space-x-1.5 rounded-lg bg-ag-primary px-3 py-1 text-xs font-semibold text-white hover:opacity-90 shadow-soft transition-all cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              <span>儲存</span>
              <span className="font-mono text-[10px] opacity-75">(Ctrl+S)</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-ag-panel">
          <Editor
            height="100%"
            language={getLanguage(activeFile.path)}
            value={currentContent}
            onChange={(val) => setCurrentContent(val || '')}
            theme={isDark ? 'vs-dark' : 'vs'}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: '"Fira Code", JetBrains Mono, monospace',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              padding: { top: 12 },
            }}
          />
        </div>
      </div>
    );
  }

  // Minimal Empty State
  return (
    <div className="flex h-full flex-col items-center justify-center bg-ag-bg text-ag-textMuted select-none p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-ag-border bg-ag-panel text-ag-primary mb-4 shadow-soft">
        <Code2 className="h-8 w-8" />
      </div>
      <h3 className="text-sm font-semibold text-ag-textPrimary mb-1">
        Coding Agent 工作畫布
      </h3>
      <p className="text-xs text-ag-textMuted max-w-sm">
        從左側目錄選擇檔案進行檢視，或於右側對話窗向 Agent 發送指令開始撰寫。
      </p>
    </div>
  );
};
