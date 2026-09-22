import React, { useState } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit2,
  Edit3,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import type { ChatSession, WorkspaceFolder } from '../../store/useAgentStore.js';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';
import { pickDirectoryFromExplorer } from '../../utils/filePicker.js';

export const LeftSidebar: React.FC = () => {
  const {
    folders,
    activeFolderId,
    sessions,
    currentSessionId,
    createFolder,
    renameFolder,
    deleteFolder,
    updateFolderPath,
    setActiveFolder,
    toggleFolderCollapse,
    newSession,
    switchSession,
    deleteSession,
  } = useAgentStore(
    useShallow((s) => ({
      folders: s.folders,
      activeFolderId: s.activeFolderId,
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      createFolder: s.createFolder,
      renameFolder: s.renameFolder,
      deleteFolder: s.deleteFolder,
      updateFolderPath: s.updateFolderPath,
      setActiveFolder: s.setActiveFolder,
      toggleFolderCollapse: s.toggleFolderCollapse,
      newSession: s.newSession,
      switchSession: s.switchSession,
      deleteSession: s.deleteSession,
    }))
  );

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isPickingDirectory, setIsPickingDirectory] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderPath, setNewFolderPath] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [editingPathFolderId, setEditingPathFolderId] = useState<string | null>(null);
  const [editFolderPath, setEditFolderPath] = useState('');

  const handlePickDirectory = async () => {
    setIsPickingDirectory(true);
    try {
      const result = await pickDirectoryFromExplorer();
      if (result && result.name) {
        createFolder(result.name, result.path);
      }
    } catch (err) {
      console.warn('[LeftSidebar] Error picking directory:', err);
    } finally {
      setIsPickingDirectory(false);
    }
  };

  const handleStartCreateFolder = () => {
    setIsCreatingFolder(true);
    setNewFolderName(`專案目錄 #${folders.length + 1}`);
    setNewFolderPath('');
  };

  const handleConfirmCreateFolder = () => {
    const trimmedName = newFolderName.trim();
    const trimmedPath = newFolderPath.trim();
    if (!trimmedName && !trimmedPath) return;

    if (trimmedPath) {
      const finalName = trimmedName || trimmedPath.split(/[\\/]/).filter(Boolean).pop() || trimmedPath;
      createFolder(finalName, trimmedPath);
    } else {
      const isPath = trimmedName.includes('\\') || trimmedName.includes('/') || trimmedName.includes(':');
      if (isPath) {
        const parts = trimmedName.split(/[\\/]/).filter(Boolean);
        const name = parts[parts.length - 1] || trimmedName;
        createFolder(name, trimmedName);
      } else {
        createFolder(trimmedName);
      }
    }

    setIsCreatingFolder(false);
    setNewFolderName('');
    setNewFolderPath('');
  };

  const handleStartRename = (folder: WorkspaceFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFolderId(folder.id);
    setEditFolderName(folder.name);
  };

  const handleConfirmRename = (folderId: string) => {
    if (editFolderName.trim()) {
      renameFolder(folderId, editFolderName.trim());
    }
    setEditingFolderId(null);
    setEditFolderName('');
  };

  const handleStartEditPath = (folder: WorkspaceFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPathFolderId(folder.id);
    setEditFolderPath(folder.path || '');
  };

  const handleConfirmEditPath = (folderId: string) => {
    updateFolderPath(folderId, editFolderPath.trim());
    setEditingPathFolderId(null);
    setEditFolderPath('');
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-ag-border bg-ag-sidebar select-none shrink-0 z-10">
      {/* Top: New Project Folder Button */}
      <div className="p-3 border-b border-ag-border bg-ag-panel/70 space-y-2">
        <div>
          {/* + New Project Folder (Pop up OS File Explorer) */}
          <button
            type="button"
            onClick={handlePickDirectory}
            disabled={isPickingDirectory}
            className="flex w-full items-center justify-center space-x-2 rounded-xl bg-ag-primary py-2.5 px-3 text-xs font-semibold text-white shadow-soft hover:opacity-90 transition-all duration-150 active:scale-98 cursor-pointer disabled:opacity-50"
            title="開啟檔案總管選擇專案目錄"
          >
            <FolderPlus className={`h-4 w-4 ${isPickingDirectory ? 'animate-pulse' : ''}`} />
            <span>{isPickingDirectory ? '開啟中...' : '新增專案目錄'}</span>
          </button>
        </div>

        {/* Manual Add Directory Toggle */}
        {!isCreatingFolder && (
          <div className="flex justify-end pr-1">
            <button
              type="button"
              onClick={handleStartCreateFolder}
              className="text-[10px] text-ag-textMuted hover:text-ag-primary transition-colors cursor-pointer flex items-center space-x-1"
            >
              <Edit3 className="h-2.5 w-2.5" />
              <span>手動命名目錄</span>
            </button>
          </div>
        )}

        {/* Inline Create Folder Form */}
        {isCreatingFolder && (
          <div className="rounded-xl border border-ag-primary/40 bg-ag-primaryLight p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150 shadow-soft">
            <div className="flex items-center space-x-1.5 text-[11px] font-medium text-ag-textPrimary">
              <FolderPlus className="h-3.5 w-3.5 text-ag-primary" />
              <span>新增專案工作目錄</span>
            </div>
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCreateFolder();
                if (e.key === 'Escape') setIsCreatingFolder(false);
              }}
              placeholder="專案目錄名稱 (例如: my-project)..."
              className="w-full rounded-lg border border-ag-border bg-ag-panel px-2.5 py-1.5 font-sans text-xs text-ag-textPrimary placeholder-slate-400 outline-none focus:border-ag-primary shadow-soft"
            />
            <input
              type="text"
              value={newFolderPath}
              onChange={(e) => setNewFolderPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCreateFolder();
                if (e.key === 'Escape') setIsCreatingFolder(false);
              }}
              placeholder="本機目錄絕對路徑 (例如: /path/to/my-project)..."
              className="w-full rounded-lg border border-ag-border bg-ag-panel px-2.5 py-1.5 font-mono text-[11px] text-ag-textPrimary placeholder-slate-400 outline-none focus:border-ag-primary shadow-soft"
            />
            <div className="flex items-center justify-end space-x-1.5 pt-1">
              <button
                onClick={() => setIsCreatingFolder(false)}
                className="rounded-md px-2 py-1 text-[11px] text-ag-textMuted hover:text-ag-textPrimary hover:bg-ag-sidebar transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmCreateFolder}
                className="rounded-md bg-ag-primary px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90 transition-colors cursor-pointer"
              >
                建立
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-ag-border bg-ag-panel/40">
        <div className="flex items-center space-x-1.5 text-ag-textSecondary font-medium text-xs">
          <History className="h-3.5 w-3.5 text-ag-primary" />
          <span>專案工作目錄與對話</span>
        </div>
        <span className="rounded-full bg-ag-panel border border-ag-border px-2 py-0.5 text-[10px] font-mono text-ag-textMuted font-medium shadow-soft">
          {folders.length} 個目錄 · {sessions.length} 則對話
        </span>
      </div>

      {/* Workspace Folders & Sessions Hierarchical List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {folders.map((folder: WorkspaceFolder) => {
          const allFolderIds = new Set(folders.map((f) => f.id));
          const isPrimary = folder.id === 'folder_default' || folder.id === folders[0]?.id;
          const folderSessions = sessions.filter(
            (s) =>
              s.folderId === folder.id ||
              (isPrimary && (!s.folderId || !allFolderIds.has(s.folderId))),
          );
          const isCollapsed = folder.isCollapsed;
          const isEditing = editingFolderId === folder.id;
          const isEditingPath = editingPathFolderId === folder.id;
          const isFolderActive = folder.id === activeFolderId;

          return (
            <div
              key={folder.id}
              className={`rounded-2xl border bg-ag-panel overflow-hidden transition-all shadow-soft ${
                isFolderActive ? 'border-ag-primary/40 ring-1 ring-ag-primary/20' : 'border-ag-border'
              }`}
            >
              {/* Folder Header Row */}
              <div
                onClick={() => {
                  if (isCollapsed) {
                    toggleFolderCollapse(folder.id);
                  }
                  setActiveFolder(folder.id);
                }}
                className={`group flex items-center justify-between px-3 py-2 cursor-pointer transition-colors select-none ${
                  isFolderActive ? 'bg-ag-primaryLight/40' : 'bg-ag-panel hover:bg-ag-sidebar/60'
                }`}
              >
                {/* Left: Collapse Icon + Folder Icon + Title */}
                <div className="flex items-center space-x-2 min-w-0 pr-1 flex-1">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFolderCollapse(folder.id);
                    }}
                    className="text-ag-textMuted hover:text-ag-textPrimary"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </span>

                  {isCollapsed ? (
                    <Folder className="h-3.5 w-3.5 text-ag-primary shrink-0" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 text-ag-primary shrink-0" />
                  )}

                  {isEditing ? (
                    <div
                      className="flex items-center space-x-1 flex-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        autoFocus
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleConfirmRename(folder.id);
                          if (e.key === 'Escape') setEditingFolderId(null);
                        }}
                        className="w-full rounded border border-ag-primary bg-ag-panel px-1.5 py-0.5 text-xs text-ag-textPrimary outline-none"
                      />
                      <button
                        onClick={() => handleConfirmRename(folder.id)}
                        className="p-1 text-emerald-600 hover:text-emerald-500 cursor-pointer"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : isEditingPath ? (
                    <div
                      className="flex items-center space-x-1 flex-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        autoFocus
                        value={editFolderPath}
                        onChange={(e) => setEditFolderPath(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleConfirmEditPath(folder.id);
                          if (e.key === 'Escape') setEditingPathFolderId(null);
                        }}
                        placeholder="輸入目錄路徑..."
                        className="w-full rounded border border-ag-primary bg-ag-panel px-1.5 py-0.5 font-mono text-[11px] text-ag-textPrimary outline-none"
                      />
                      <button
                        onClick={() => handleConfirmEditPath(folder.id)}
                        className="p-1 text-emerald-600 hover:text-emerald-500 cursor-pointer"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className="font-medium text-xs text-ag-textPrimary truncate"
                        title={folder.name}
                      >
                        {folder.name}
                      </span>
                      {folder.path && (
                        <span
                          className="font-mono text-[9.5px] text-ag-textMuted truncate"
                          title={`工作目錄路徑: ${folder.path}`}
                        >
                          {folder.path}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Badge & Hover Action Buttons */}
                {!isEditing && !isEditingPath && (
                  <div className="flex items-center space-x-1 shrink-0">
                    <span className="rounded bg-ag-sidebar border border-ag-border px-1.5 py-0.2 font-mono text-[9.5px] text-ag-textMuted group-hover:hidden">
                      {folderSessions.length}
                    </span>

                    {/* Quick + in this folder */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        newSession(folder.id);
                      }}
                      className="hidden group-hover:flex p-1 rounded text-ag-textMuted hover:text-ag-primary hover:bg-ag-primaryLight transition-colors cursor-pointer"
                      title="在此目錄下建立新對話"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>

                    {/* Edit Path */}
                    <button
                      onClick={(e) => handleStartEditPath(folder, e)}
                      className="hidden group-hover:flex p-1 rounded text-ag-textMuted hover:text-ag-primary hover:bg-ag-sidebar transition-colors cursor-pointer"
                      title="設定/修改本機目錄路徑"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>

                    {/* Rename Folder */}
                    <button
                      onClick={(e) => handleStartRename(folder, e)}
                      className="hidden group-hover:flex p-1 rounded text-ag-textMuted hover:text-ag-textPrimary hover:bg-ag-sidebar transition-colors cursor-pointer"
                      title="重新命名目錄"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>

                    {/* Delete Folder */}
                    {folders.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFolder(folder.id);
                        }}
                        className="hidden group-hover:flex p-1 rounded text-ag-textMuted hover:text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="刪除此目錄 (底下的對話將移至預設目錄)"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Sessions List under this Folder */}
              {!isCollapsed && (
                <div className="p-1.5 space-y-1.5 bg-ag-sidebar/40 border-t border-ag-border/50">
                  {folderSessions.length === 0 ? (
                    <button
                      onClick={() => newSession(folder.id)}
                      className="flex w-full items-center justify-center space-x-1.5 rounded-xl border border-dashed border-ag-border p-2.5 text-[11px] text-ag-textMuted hover:border-ag-primary hover:text-ag-primary hover:bg-ag-panel transition-all cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      <span>此目錄尚無對話，點擊新增</span>
                    </button>
                  ) : (
                    folderSessions.map((session: ChatSession) => {
                      const isActive = session.id === currentSessionId;
                      return (
                        <div
                          key={session.id}
                          onClick={() => switchSession(session.id)}
                          className={`group/item relative flex flex-col rounded-xl border p-2 text-xs cursor-pointer transition-all ${
                            isActive
                              ? 'border-ag-primary bg-ag-primaryLight text-ag-textPrimary shadow-soft font-medium'
                              : 'border-ag-border/70 bg-ag-panel text-ag-textSecondary hover:border-ag-borderHover hover:bg-ag-panel hover:text-ag-textPrimary'
                          }`}
                        >
                          {isActive && (
                            <div className="absolute left-0 top-2 bottom-2 w-1 bg-ag-primary rounded-r-full" />
                          )}

                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className="font-medium truncate max-w-[155px] text-ag-textPrimary"
                              title={session.title}
                            >
                              {session.title}
                            </span>

                            <div className="flex items-center space-x-1 shrink-0">
                              {session.status === 'thinking' && (
                                <span
                                  className="flex items-center space-x-1 rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 font-mono text-[9px] text-amber-600 dark:text-amber-400 animate-pulse font-medium"
                                  title="此對話正在背景推理中"
                                >
                                  <Brain className="h-2.5 w-2.5 text-amber-500 animate-pulse" />
                                  <span>推理中</span>
                                </span>
                              )}
                              {session.status === 'planning' && (
                                <span
                                  className="flex items-center space-x-1 rounded bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 font-mono text-[9px] text-sky-600 dark:text-sky-400 animate-pulse font-medium"
                                  title="此對話正在規劃實作藍圖"
                                >
                                  <span>📋 規劃中</span>
                                </span>
                              )}
                              {session.status === 'streaming' && (
                                <span
                                  className="flex items-center space-x-1 rounded bg-blue-500/10 border border-blue-500/30 px-1.5 py-0.5 font-mono text-[9px] text-blue-600 dark:text-blue-400 animate-pulse font-medium"
                                  title="此對話正在背景生成中"
                                >
                                  <span>⚡ 生成中</span>
                                </span>
                              )}
                              {session.status === 'executing_tool' && (
                                <span
                                  className="flex items-center space-x-1 rounded bg-indigo-500/10 border border-indigo-500/30 px-1.5 py-0.5 font-mono text-[9px] text-indigo-600 dark:text-indigo-400 animate-pulse font-medium"
                                  title="此對話正在執行工具"
                                >
                                  <span>🛠️ 執行中</span>
                                </span>
                              )}
                              {session.status === 'waiting_approval' && (
                                <span
                                  className="flex items-center space-x-1 rounded bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5 font-mono text-[9px] text-rose-600 dark:text-rose-400 font-semibold"
                                  title="此對話正在等待使用者審批"
                                >
                                  <span>⚠️ 待審批</span>
                                </span>
                              )}
                              <span className="rounded bg-ag-sidebar px-1.5 py-0.5 font-mono text-[9px] uppercase text-ag-primary border border-ag-border">
                                {session.mode}
                              </span>
                              {sessions.length > 1 && (
                                <button
                                   onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSession(session.id);
                                  }}
                                  className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded text-ag-textMuted hover:text-rose-500 hover:bg-rose-50 transition-all ml-0.5 cursor-pointer"
                                  title="刪除此對話"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {session.model && (
                            <div className="flex items-center space-x-1 mt-1 font-mono text-[9.5px] text-amber-700/90 truncate">
                              <Sparkles className="h-2.5 w-2.5 text-amber-500 shrink-0" />
                              <span
                                className="truncate"
                                title={`${session.provider ? `${session.provider}: ` : ''}${session.model}`}
                              >
                                {session.model.replace(/^(cline-pass|deepseek)\//, '')}
                              </span>
                            </div>
                          )}

                          <div className="flex items-center justify-between text-[10px] text-ag-textMuted mt-1.5">

                            <div className="flex items-center space-x-1">
                              <Clock className="h-3 w-3" />
                              <span>
                                {(() => {
                                  const d = new Date(session.createdAt || Date.now());
                                  return !isNaN(d.getTime())
                                    ? `${d.toLocaleDateString([], {
                                        month: 'numeric',
                                        day: 'numeric',
                                      })} ${d.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}`
                                    : '剛剛';
                                })()}
                              </span>
                            </div>

                            <span>
                              {session.messages ? session.messages.length : session.messageCount} 則訊息
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
