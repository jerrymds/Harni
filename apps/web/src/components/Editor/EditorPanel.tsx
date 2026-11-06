import React, { useEffect, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Code2,
  Eye,
  FileCode,
  GitCompare,
  Maximize2,
  Minimize2,
  Save,
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
    documentViewerWidth,
    setDocumentViewerWidth,
    setDocumentViewerOpen,
  } = useAgentStore(
    useShallow((s) => ({
      activeFile: s.activeFile,
      activeDiff: s.activeDiff,
      saveActiveFile: s.saveActiveFile,
      closeActiveFile: s.closeActiveFile,
      setActiveDiff: s.setActiveDiff,
      theme: s.theme,
      documentViewerWidth: s.documentViewerWidth,
      setDocumentViewerWidth: s.setDocumentViewerWidth,
      setDocumentViewerOpen: s.setDocumentViewerOpen,
    }))
  );

  const isDark = theme === 'dark' || theme === 'charcoal';
  const [currentContent, setCurrentContent] = useState('');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('code');
  const prevPathRef = useRef<string | null>(null);

  const isMarkdown = Boolean(
    activeFile &&
      (activeFile.path.toLowerCase().endsWith('.md') ||
        activeFile.path.toLowerCase().endsWith('.markdown'))
  );

  useEffect(() => {
    if (activeFile) {
      setCurrentContent(activeFile.content);
      if (prevPathRef.current !== activeFile.path) {
        prevPathRef.current = activeFile.path;
        const isMd =
          activeFile.path.toLowerCase().endsWith('.md') ||
          activeFile.path.toLowerCase().endsWith('.markdown');
        setViewMode(isMd ? 'preview' : 'code');
      }
    } else {
      prevPathRef.current = null;
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

  const handleToggleWidth = () => {
    setDocumentViewerWidth(documentViewerWidth === 80 ? 50 : 80);
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
          <div className="flex items-center space-x-2.5 text-xs font-medium text-ag-textPrimary min-w-0 flex-1 mr-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-ag-primaryLight text-ag-primary border border-ag-border shrink-0">
              <GitCompare className="h-3.5 w-3.5" />
            </div>
            <span className="font-mono text-[12px] truncate" title={activeDiff.path}>
              {activeDiff.path}
            </span>
            {activeDiff.isNewFile && (
              <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 shrink-0">
                新增檔案 (New File)
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            {/* Width Toggle */}
            <button
              type="button"
              onClick={handleToggleWidth}
              className="flex items-center space-x-1 rounded-lg border border-ag-border bg-ag-panel px-2.5 py-1 text-xs font-medium text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary transition-all cursor-pointer shadow-soft"
              title={documentViewerWidth === 80 ? '還原寬度 (50%)' : '展開寬度 (80%)'}
              aria-label={documentViewerWidth === 80 ? '還原寬度' : '展開寬度'}
            >
              {documentViewerWidth === 80 ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline font-mono text-[11px]">{documentViewerWidth === 80 ? '50%' : '80%'}</span>
            </button>

            {/* Done Button */}
            <button
              type="button"
              onClick={() => setActiveDiff(null)}
              className="flex items-center space-x-1.5 rounded-lg border border-ag-border bg-ag-panel px-3 py-1 text-xs font-medium text-ag-textSecondary hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800 transition-all cursor-pointer shadow-soft"
              title="關閉審查 (Done)"
            >
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              <span>關閉審查 (Done)</span>
            </button>

            {/* Close Drawer Button */}
            <button
              type="button"
              onClick={() => setDocumentViewerOpen(false)}
              className="rounded-lg border border-ag-border bg-ag-panel p-1.5 text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary transition-all cursor-pointer shadow-soft"
              title="關閉檢視器"
              aria-label="關閉檢視器"
            >
              <X className="h-4 w-4" />
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
    const fileName = activeFile.path.split(/[\\/]/).pop() || activeFile.path;
    const isDirty = currentContent !== activeFile.content;

    return (
      <div className="flex h-full flex-col bg-ag-bg">
        {/* Sleek File Tab */}
        <div className="flex h-10 items-center justify-between border-b border-ag-border bg-ag-sidebar px-3 select-none">
          <div className="flex items-center space-x-1 min-w-0 flex-1 mr-2">
            <div
              className="flex items-center space-x-2 rounded-t-lg border-t-2 border-ag-primary bg-ag-panel px-3.5 py-1.5 text-xs text-ag-textPrimary font-mono shadow-soft min-w-0 max-w-[80%]"
              title={activeFile.path}
            >
              <FileCode className="h-3.5 w-3.5 text-ag-primary shrink-0" />
              <span className="font-medium text-[12px] truncate" title={activeFile.path}>
                {fileName}
              </span>
              {isDirty && (
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="Unsaved changes" />
              )}
              <button
                type="button"
                onClick={closeActiveFile}
                className="ml-1 rounded-sm p-0.5 text-ag-textMuted hover:bg-ag-sidebar hover:text-ag-textPrimary cursor-pointer shrink-0"
                title="關閉檔案"
                aria-label="關閉檔案"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {/* Markdown Mode Toggle (Preview / Code) */}
            {isMarkdown && (
              <div className="flex items-center bg-ag-bg/80 p-0.5 rounded-lg border border-ag-border mr-1 select-none">
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    viewMode === 'preview'
                      ? 'bg-ag-panel text-ag-primary shadow-xs font-semibold'
                      : 'text-ag-textSecondary hover:text-ag-textPrimary'
                  }`}
                  title="切換至檢視模式"
                  aria-label="檢視"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>檢視</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('code')}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    viewMode === 'code'
                      ? 'bg-ag-panel text-ag-primary shadow-xs font-semibold'
                      : 'text-ag-textSecondary hover:text-ag-textPrimary'
                  }`}
                  title="切換至原始碼模式"
                  aria-label="原始碼"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  <span>原始碼</span>
                </button>
              </div>
            )}

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center space-x-1.5 rounded-lg bg-ag-primary px-3 py-1 text-xs font-semibold text-white hover:opacity-90 shadow-soft transition-all cursor-pointer"
              title="儲存檔案 (Ctrl+S)"
            >
              <Save className="h-3.5 w-3.5" />
              <span>儲存</span>
              <span className="font-mono text-[10px] opacity-75 hidden sm:inline">(Ctrl+S)</span>
            </button>

            {/* Width Toggle Button */}
            <button
              type="button"
              onClick={handleToggleWidth}
              className="flex items-center space-x-1 rounded-lg border border-ag-border bg-ag-panel px-2.5 py-1 text-xs font-medium text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary transition-all cursor-pointer shadow-soft"
              title={documentViewerWidth === 80 ? '還原寬度 (50%)' : '展開寬度 (80%)'}
              aria-label={documentViewerWidth === 80 ? '還原寬度' : '展開寬度'}
            >
              {documentViewerWidth === 80 ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline font-mono text-[11px]">{documentViewerWidth === 80 ? '50%' : '80%'}</span>
            </button>

            {/* Close Drawer Button */}
            <button
              type="button"
              onClick={() => setDocumentViewerOpen(false)}
              className="rounded-lg border border-ag-border bg-ag-panel p-1.5 text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary transition-all cursor-pointer shadow-soft"
              title="關閉檢視器"
              aria-label="關閉檢視器"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-ag-panel">
          {viewMode === 'preview' && isMarkdown ? (
            <div
              data-testid="markdown-preview-container"
              className="h-full overflow-y-auto p-6 text-ag-textPrimary select-text leading-relaxed font-sans max-w-4xl mx-auto"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => (/^javascript:/i.test(url.trim()) ? '' : url)}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold text-ag-textPrimary border-b border-ag-border pb-2 mb-4 mt-6 first:mt-0 select-text">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl font-bold text-ag-textPrimary border-b border-ag-border pb-1.5 mb-3 mt-5 select-text">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-lg font-semibold text-ag-textPrimary mb-2 mt-4 select-text">
                      {children}
                    </h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-base font-semibold text-ag-textPrimary mb-2 mt-3 select-text">
                      {children}
                    </h4>
                  ),
                  p: ({ children }) => (
                    <p className="my-2.5 leading-relaxed text-ag-textPrimary text-sm select-text">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc pl-6 my-2.5 space-y-1 text-sm text-ag-textPrimary select-text">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-6 my-2.5 space-y-1 text-sm text-ag-textPrimary select-text">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed select-text">{children}</li>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-ag-primary bg-ag-primaryLight px-4 py-2.5 my-3 rounded-r-xl text-ag-textSecondary italic text-sm select-text">
                      {children}
                    </blockquote>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-4 rounded-xl border border-ag-border shadow-xs select-text">
                      <table className="min-w-full text-xs divide-y divide-ag-border select-text">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-ag-sidebar font-semibold text-ag-textPrimary select-text">
                      {children}
                    </thead>
                  ),
                  th: ({ children }) => (
                    <th className="px-3 py-2 text-left border-r last:border-r-0 border-ag-border select-text font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-2 border-t border-r last:border-r-0 border-ag-border text-ag-textPrimary select-text">
                      {children}
                    </td>
                  ),
                  code: ({ className, children, ...props }: any) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const isInline = !match && !String(children).includes('\n');
                    if (isInline) {
                      return (
                        <code
                          className="rounded-md bg-ag-primaryLight border border-ag-primary/25 px-1.5 py-0.5 text-xs font-mono text-ag-primary font-semibold inline-block my-0.5 align-baseline select-text"
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }
                    return (
                      <div className="my-3 rounded-xl overflow-hidden border border-ag-border bg-ag-void shadow-soft">
                        <div className="flex items-center px-3.5 py-1.5 bg-ag-sidebar border-b border-ag-border text-xs font-mono select-none text-ag-primary">
                          <Code2 className="h-3.5 w-3.5 mr-1.5" />
                          <span className="font-semibold text-[11px] uppercase tracking-wider">
                            {match ? match[1] : 'code'}
                          </span>
                        </div>
                        <pre className="p-4 overflow-x-auto text-xs font-mono text-ag-textPrimary leading-relaxed bg-ag-void/60 m-0 border-none select-text">
                          <code>{children}</code>
                        </pre>
                      </div>
                    );
                  },
                  a: ({ href, children }: any) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ag-primary hover:underline font-medium select-text"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {currentContent}
              </ReactMarkdown>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    );
  }

  // Minimal Empty State
  return (
    <div className="flex h-full flex-col bg-ag-bg select-none">
      <div className="flex h-10 items-center justify-between border-b border-ag-border bg-ag-sidebar px-3 select-none">
        <div className="flex items-center space-x-2 text-xs font-medium text-ag-textPrimary">
          <FileCode className="h-4 w-4 text-ag-primary" />
          <span>文件檢視器</span>
        </div>
        <div className="flex items-center space-x-2">
          {/* Width Toggle */}
          <button
            type="button"
            onClick={handleToggleWidth}
            className="flex items-center space-x-1 rounded-lg border border-ag-border bg-ag-panel px-2.5 py-1 text-xs font-medium text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary transition-all cursor-pointer shadow-soft"
            title={documentViewerWidth === 80 ? '還原寬度 (50%)' : '展開寬度 (80%)'}
            aria-label={documentViewerWidth === 80 ? '還原寬度' : '展開寬度'}
          >
            {documentViewerWidth === 80 ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline font-mono text-[11px]">{documentViewerWidth === 80 ? '50%' : '80%'}</span>
          </button>
          {/* Close Drawer Button */}
          <button
            type="button"
            onClick={() => setDocumentViewerOpen(false)}
            className="rounded-lg border border-ag-border bg-ag-panel p-1.5 text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary transition-all cursor-pointer shadow-soft"
            title="關閉檢視器"
            aria-label="關閉檢視器"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-ag-textMuted">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-ag-border bg-ag-panel text-ag-primary mb-4 shadow-soft">
          <Code2 className="h-8 w-8" />
        </div>
        <h3 className="text-sm font-semibold text-ag-textPrimary mb-1">
          Coding Agent 工作畫布
        </h3>
        <p className="text-xs text-ag-textMuted max-w-sm">
          從左側「專案檔案」目錄選擇檔案進行檢視，或於對話窗向 Agent 發送指令開始撰寫。
        </p>
      </div>
    </div>
  );
};
