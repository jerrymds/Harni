import React, { useState, memo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  RefreshCw,
} from 'lucide-react';
import type { FileNode } from '@harni/types';
import { useAgentStore } from '../../store/useAgentStore.js';

interface TreeNodeProps {
  node: FileNode;
  level: number;
}

const TreeNode: React.FC<TreeNodeProps> = memo(({ node, level }) => {
  const [isOpen, setIsOpen] = useState(node.children && node.children.length > 0 ? true : false);
  const isActive = useAgentStore((s) => s.activeFile?.path === node.path);
  const openFile = useAgentStore((s) => s.openFile);
  const loadDirectory = useAgentStore((s) => s.loadDirectory);

  const isDirectory = node.type === 'directory';

  const getFileIcon = (fileName: string) => {
    if (
      fileName.endsWith('.ts') ||
      fileName.endsWith('.tsx') ||
      fileName.endsWith('.js') ||
      fileName.endsWith('.jsx')
    ) {
      return <FileCode2 className="h-3.5 w-3.5 text-ag-primary shrink-0" />;
    }
    if (fileName.endsWith('.json') || fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
      return <FileJson2 className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    }
    if (fileName.endsWith('.md')) {
      return <FileText className="h-3.5 w-3.5 text-ag-primary shrink-0" />;
    }
    if (fileName.endsWith('.css') || fileName.endsWith('.html')) {
      return <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 shrink-0" />;
    }
    return <FileText className="h-3.5 w-3.5 text-ag-textMuted shrink-0" />;
  };

  const handleClick = () => {
    if (isDirectory) {
      if (!isOpen) {
        if (node.children === undefined) {
          loadDirectory(node.path);
        }
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    } else {
      openFile(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${level * 14 + 10}px` }}
        className={`group relative flex items-center space-x-2 py-1 pr-2 text-xs cursor-pointer select-none transition-all duration-100 ${
          isActive
            ? 'bg-ag-primaryLight text-ag-textPrimary font-semibold'
            : 'text-ag-textSecondary hover:bg-ag-sidebar hover:text-ag-textPrimary'
        }`}
      >
        {/* Active Left Indicator */}
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-ag-primary" />
        )}

        {isDirectory ? (
          <>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-ag-textMuted group-hover:text-ag-textPrimary shrink-0 transition-transform" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-ag-textMuted group-hover:text-ag-textPrimary shrink-0 transition-transform" />
            )}
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            ) : (
              <Folder className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            {getFileIcon(node.name)}
          </>
        )}
        <span className="truncate font-mono text-[11.5px]">{node.name}</span>
      </div>

      {isDirectory && isOpen && node.children && (
        <div>
          {node.children.map((child: FileNode) => (
            <TreeNode key={child.path} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
});

TreeNode.displayName = 'TreeNode';

export const FileTree: React.FC = () => {
  const fileTree = useAgentStore((s) => s.fileTree);
  const ws = useAgentStore((s) => s.ws);

  const handleRefresh = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'workspace:refresh', payload: {} }));
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-ag-sidebar select-none">
      <div className="flex h-8 items-center justify-between border-b border-ag-border px-3 bg-ag-panel text-[11px] font-semibold text-ag-textMuted tracking-wider uppercase shadow-soft">
        <div className="flex items-center space-x-1.5 text-ag-textPrimary">
          <FolderTree className="h-3.5 w-3.5 text-ag-primary" />
          <span>Files</span>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-md p-1 text-ag-textMuted hover:bg-ag-sidebar hover:text-ag-textPrimary transition-colors cursor-pointer"
          title="Refresh Directory Tree"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {fileTree.length === 0 ? (
          <div className="p-4 text-center text-xs text-ag-textMuted">
            No files in workspace
          </div>
        ) : (
          fileTree.map((node) => (
            <TreeNode key={node.path} node={node} level={0} />
          ))
        )}
      </div>
    </div>
  );
};
