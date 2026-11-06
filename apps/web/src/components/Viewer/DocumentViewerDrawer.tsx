import React from 'react';
import { FileCode } from 'lucide-react';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';
import { EditorPanel } from '../Editor/EditorPanel.js';

export const DocumentViewerDrawer: React.FC = () => {
  const {
    isDocumentViewerOpen,
    documentViewerWidth,
    setDocumentViewerOpen,
    activeFile,
  } = useAgentStore(
    useShallow((s) => ({
      isDocumentViewerOpen: s.isDocumentViewerOpen,
      documentViewerWidth: s.documentViewerWidth,
      setDocumentViewerOpen: s.setDocumentViewerOpen,
      activeFile: s.activeFile,
    }))
  );

  const fileName = activeFile?.path.split(/[\\/]/).pop();

  return (
    <>
      {/* Edge Rail / Floating Toggle Button when drawer is closed */}
      {!isDocumentViewerOpen && (
        <button
          type="button"
          data-testid="document-viewer-toggle-btn"
          onClick={() => setDocumentViewerOpen(true)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center space-y-1.5 rounded-l-xl border-l border-y border-ag-border bg-ag-panel/95 py-3 px-2 text-ag-textSecondary shadow-soft backdrop-blur-md hover:border-ag-primary/40 hover:bg-ag-primaryLight hover:text-ag-primary transition-all duration-200 cursor-pointer group select-none active:scale-95"
          title={fileName ? `開啟文件檢視器: ${fileName}` : '開啟文件檢視器'}
          aria-label="開啟文件檢視器"
        >
          <FileCode className="h-4 w-4 text-ag-primary transition-transform duration-200 group-hover:scale-110" />
          <span className="text-[10px] font-mono font-medium [writing-mode:vertical-rl] tracking-wider text-ag-textMuted group-hover:text-ag-primary transition-colors max-h-24 truncate">
            {fileName || '文件檢視器'}
          </span>
        </button>
      )}

      {/* Sliding Drawer Container */}
      <aside
        data-testid="document-viewer-drawer"
        aria-label="文件檢視器抽屜"
        className={`absolute top-0 right-0 bottom-0 z-30 shadow-2xl border-l border-ag-border bg-ag-panel/95 backdrop-blur-md flex flex-col transition-all duration-300 ease-in-out ${
          isDocumentViewerOpen
            ? 'translate-x-0'
            : 'translate-x-full pointer-events-none'
        } ${
          documentViewerWidth === 80
            ? 'w-full md:w-[80%]'
            : 'w-full md:w-[50%]'
        }`}
      >
        <EditorPanel />
      </aside>
    </>
  );
};

export default DocumentViewerDrawer;
