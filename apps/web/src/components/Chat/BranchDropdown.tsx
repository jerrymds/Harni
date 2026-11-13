import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import {
  GitBranch,
  ChevronDown,
  RefreshCw,
  Search,
  Plus,
  Check,
  X,
} from 'lucide-react';
import { useAgentStore } from '../../store/useAgentStore.js';

export interface BranchDropdownProps {
  disabled?: boolean;
}

export const BranchDropdown: React.FC<BranchDropdownProps> = memo(({
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const branches = useAgentStore((s) => s.branches || []);
  const currentBranch = useAgentStore((s) => s.currentBranch);
  const isLoadingBranches = useAgentStore((s) => s.isLoadingBranches);
  const isSwitchingBranch = useAgentStore((s) => s.isSwitchingBranch);
  const workspaceInfo = useAgentStore((s) => s.workspaceInfo);
  const currentSessionId = useAgentStore((s) => s.currentSessionId);
  const activeWorktrees = useAgentStore((s) => s.activeWorktrees || {});
  const fetchBranches = useAgentStore((s) => s.fetchBranches);
  const switchBranch = useAgentStore((s) => s.switchBranch);

  const currentWorktree = activeWorktrees[currentSessionId];
  const isWorktreeActive = Boolean(currentWorktree?.isWorktree && currentWorktree?.branch);
  const isNonGit = workspaceInfo !== null && workspaceInfo.isGitRepo === false;

  let displayBranch = currentBranch || workspaceInfo?.branch || 'main';
  if (isWorktreeActive) {
    displayBranch = currentWorktree!.branch!;
  } else if (isNonGit) {
    displayBranch = '非 Git 儲存庫';
  }

  // Handle escape key and click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    if (!isOpen) {
      setErrorMsg('');
      setSearchQuery('');
      fetchBranches?.();
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [isOpen, fetchBranches]);

  const handleSwitch = async (name: string, create: boolean) => {
    setErrorMsg('');
    try {
      const res = await switchBranch(name, { create });
      if (res && res.success) {
        setIsOpen(false);
        setSearchQuery('');
      } else {
        setErrorMsg(res?.message || '切換分支失敗');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '切換分支失敗');
    }
  };

  const trimmedQuery = searchQuery.trim();
  const exactMatch = branches.some(
    (b) => b.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );
  const showCreateOption = Boolean(trimmedQuery && !exactMatch);

  const filteredBranches = useMemo(() => {
    if (!trimmedQuery) return branches;
    const lower = trimmedQuery.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(lower));
  }, [branches, trimmedQuery]);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled || isSwitchingBranch || isNonGit}
        onClick={handleToggle}
        data-testid="branch-dropdown-trigger"
        aria-label="切換 Git 分支"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={isNonGit ? '非 Git 儲存庫' : `當前分支: ${displayBranch}`}
        className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed ${
          isOpen
            ? 'border-ag-primary/40 bg-ag-primaryLight text-ag-primary shadow-soft font-semibold'
            : 'border-ag-border bg-ag-sidebar/60 text-ag-textMuted hover:text-ag-textPrimary hover:border-ag-primary/30'
        }`}
      >
        <GitBranch className="h-3.5 w-3.5 text-ag-primary shrink-0" />
        <span className="max-w-[140px] truncate font-mono text-[11px] leading-tight">
          {displayBranch}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-ag-textMuted transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180 text-ag-primary' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-2 w-72 sm:w-80 rounded-2xl border border-ag-border bg-ag-panel shadow-soft p-2 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-ag-border/50 text-xs">
            <div className="flex items-center space-x-1.5 text-ag-textPrimary font-semibold">
              <GitBranch className="h-3.5 w-3.5 text-ag-primary" />
              <span>Git 分支 (Branches)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="font-mono text-[10px] text-ag-primary bg-ag-primaryLight px-1.5 py-0.5 rounded-md">
                {branches.length} 個分支
              </span>
              <button
                type="button"
                aria-label="重新整理分支清單"
                title="重新整理分支清單"
                disabled={isLoadingBranches}
                onClick={() => fetchBranches?.()}
                className="p-1 rounded-md text-ag-textMuted hover:text-ag-primary hover:bg-ag-primaryLight transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`h-3 w-3 ${isLoadingBranches ? 'animate-spin text-ag-primary' : ''}`}
                />
              </button>
            </div>
          </div>

          {/* Search / Input */}
          <div className="relative mt-2 px-1">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-ag-textMuted pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋或輸入新分支名稱..."
                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl border border-ag-border bg-ag-sidebar/50 text-ag-textPrimary placeholder:text-ag-textMuted focus:outline-none focus:border-ag-primary focus:ring-1 focus:ring-ag-primary transition-all font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="清除搜尋"
                  className="absolute right-2 p-0.5 rounded-md text-ag-textMuted hover:text-ag-textPrimary hover:bg-ag-sidebar transition-colors cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Error message */}
          {errorMsg && (
            <div className="mt-2 mx-1 p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] leading-snug">
              {errorMsg}
            </div>
          )}

          {/* Create branch option */}
          {showCreateOption && (
            <div className="mt-2 px-1">
              <button
                type="button"
                onClick={() => handleSwitch(trimmedQuery, true)}
                disabled={isSwitchingBranch}
                className="flex items-center space-x-2 w-full p-2 rounded-xl text-left text-xs text-ag-primary bg-ag-primaryLight hover:bg-ag-primary/20 border border-ag-primary/30 transition-all cursor-pointer font-medium disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  建立並切換至 &quot;<span className="font-mono">{trimmedQuery}</span>&quot;
                </span>
              </button>
            </div>
          )}

          {/* Branch list */}
          <div className="mt-2 max-h-60 overflow-y-auto custom-scrollbar space-y-1 p-1">
            {filteredBranches.length === 0 && !showCreateOption ? (
              <div className="py-6 text-center text-xs text-ag-textMuted">
                查無符合的分支
              </div>
            ) : (
              filteredBranches.map((branch) => {
                const isCurrent = branch.current || branch.name === displayBranch;
                return (
                  <button
                    key={branch.name}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSwitch(branch.name, false)}
                    disabled={isSwitchingBranch}
                    className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-left text-xs transition-all cursor-pointer border ${
                      isCurrent
                        ? 'bg-ag-primaryLight text-ag-primary border-ag-primary/30 font-medium'
                        : 'text-ag-textPrimary hover:bg-ag-sidebar/70 hover:border-ag-border border-transparent'
                    } disabled:opacity-50`}
                  >
                    <div className="flex items-center space-x-2 min-w-0 mr-2">
                      <GitBranch
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isCurrent ? 'text-ag-primary' : 'text-ag-textMuted'
                        }`}
                      />
                      <span className="truncate font-mono">{branch.name}</span>
                      {branch.commit && (
                        <span className="font-mono text-[10px] text-ag-textMuted shrink-0">
                          {branch.commit.slice(0, 7)}
                        </span>
                      )}
                    </div>
                    {isCurrent && (
                      <div className="flex items-center space-x-1 shrink-0">
                        <span className="text-[10px] font-medium bg-ag-primary/20 text-ag-primary px-1.5 py-0.2 rounded-md">
                          目前
                        </span>
                        <Check className="h-3.5 w-3.5 text-ag-primary shrink-0" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
});

BranchDropdown.displayName = 'BranchDropdown';
