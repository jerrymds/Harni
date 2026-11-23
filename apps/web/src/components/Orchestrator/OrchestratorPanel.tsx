import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Cpu,
  FileCode,
  Flame,
  FolderGit2,
  LayoutDashboard,
  Plus,
  ShieldAlert,
  Square,
  XCircle,
} from 'lucide-react';
import type { AgentStatus, ChatSession, SubagentStatus } from '@harni/types';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';
import { ActionQueueSection } from './ActionQueueSection.js';
import { OrchestratorInspector } from './OrchestratorInspector.js';

type SessionFilter = 'all' | 'running' | 'pending' | 'completed';

const ACTIVE_SESSION_STATUSES = new Set<AgentStatus>([
  'planning',
  'thinking',
  'streaming',
  'tool_request',
  'waiting_approval',
  'waiting_user_input',
  'executing_tool',
  'testing',
]);

const PENDING_SESSION_STATUSES = new Set<AgentStatus>([
  'waiting_approval',
  'waiting_user_input',
]);

const RUNNING_SUBAGENT_STATUSES = new Set<SubagentStatus>([
  'pending',
  'running',
  'waiting_for_input',
]);

const SESSION_STATUS_META: Record<AgentStatus, { label: string; badgeClass: string }> = {
  idle: {
    label: '閒置',
    badgeClass: 'bg-ag-sidebar text-ag-textMuted border-ag-border',
  },
  planning: {
    label: '規劃中',
    badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
  },
  thinking: {
    label: '思考中',
    badgeClass: 'bg-ag-primaryLight text-ag-primary border-ag-primary/30',
  },
  streaming: {
    label: '輸出中',
    badgeClass: 'bg-ag-primaryLight text-ag-primary border-ag-primary/30',
  },
  tool_request: {
    label: '請求工具',
    badgeClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30',
  },
  waiting_approval: {
    label: '等待審批',
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  },
  waiting_user_input: {
    label: '等待回覆',
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  },
  executing_tool: {
    label: '執行工具中',
    badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
  },
  testing: {
    label: '測試中',
    badgeClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30',
  },
  completed: {
    label: '已完成',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  error: {
    label: '發生錯誤',
    badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
  cancelled: {
    label: '已取消',
    badgeClass: 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400 border-zinc-500/30',
  },
};

const SUBAGENT_STATUS_META: Record<SubagentStatus, { label: string; badgeClass: string }> = {
  pending: {
    label: '排隊中',
    badgeClass: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  },
  running: {
    label: '執行中',
    badgeClass: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  },
  idle: {
    label: '待機',
    badgeClass: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  },
  waiting_for_input: {
    label: '等待輸入',
    badgeClass: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  },
  completed: {
    label: '已完成',
    badgeClass: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  },
  error: {
    label: '異常',
    badgeClass: 'bg-rose-500/15 text-rose-500 border-rose-500/20',
  },
  cancelled: {
    label: '已取消',
    badgeClass: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  },
};

export const OrchestratorPanel: React.FC = () => {
  const {
    sessions,
    currentSessionId,
    folders,
    subagents,
    sessionChangedFiles,
    swarmBoards,
    sessionSchedules,
    wakeupLogs,
    setActiveWorkspaceView,
    newSession,
    switchSession,
    approveToolForSession,
    answerQuestionForSession,
    cancelTaskForSession,
    killSubagentForSession,
    openChangedFile,
  } = useAgentStore(
    useShallow((s) => ({
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      folders: s.folders,
      subagents: s.subagents,
      sessionChangedFiles: s.sessionChangedFiles,
      swarmBoards: s.swarmBoards,
      sessionSchedules: s.sessionSchedules,
      wakeupLogs: s.wakeupLogs,
      setActiveWorkspaceView: s.setActiveWorkspaceView,
      newSession: s.newSession,
      switchSession: s.switchSession,
      approveToolForSession: s.approveToolForSession,
      answerQuestionForSession: s.answerQuestionForSession,
      cancelTaskForSession: s.cancelTaskForSession,
      killSubagentForSession: s.killSubagentForSession,
      openChangedFile: s.openChangedFile,
    })),
  );

  const [filter, setFilter] = useState<SessionFilter>('all');
  const [inspectedSessionId, setInspectedSessionId] = useState<string | null>(null);
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({});

  const safeSessions = sessions || [];
  const safeSubagents = subagents || {};
  const safeChangedFiles = sessionChangedFiles || {};

  const toggleSessionCollapse = (sessionId: string) => {
    setCollapsedSessions((prev) => ({
      ...prev,
      [sessionId]: !prev[sessionId],
    }));
  };

  const isSessionActive = (session: ChatSession): boolean => {
    const status = session.status || 'idle';
    if (ACTIVE_SESSION_STATUSES.has(status)) return true;
    return (safeSubagents[session.id] || []).some((sub) =>
      RUNNING_SUBAGENT_STATUSES.has(sub.status),
    );
  };

  const isSessionPending = (session: ChatSession): boolean =>
    Boolean(
      session.pendingApproval ||
        session.pendingQuestion ||
        PENDING_SESSION_STATUSES.has(session.status || 'idle'),
    );

  const isSessionCompleted = (session: ChatSession): boolean =>
    session.status === 'completed' ||
    session.status === 'error' ||
    session.status === 'cancelled';

  const metrics = useMemo(() => {
    let activeSessionCount = 0;
    let activeSubagentCount = 0;
    let pendingActionCount = 0;
    let totalTokens = 0;

    for (const s of safeSessions) {
      if (isSessionActive(s)) activeSessionCount += 1;
      if (s.pendingApproval || s.pendingQuestion) pendingActionCount += 1;
      totalTokens += s.tokenUsage?.totalTokens || 0;
    }

    for (const list of Object.values(safeSubagents)) {
      for (const sub of list) {
        if (RUNNING_SUBAGENT_STATUSES.has(sub.status)) {
          activeSubagentCount += 1;
        }
      }
    }

    let changedFileCount = 0;
    for (const files of Object.values(safeChangedFiles)) {
      changedFileCount += files.length;
    }

    return {
      activeSessionCount,
      activeSubagentCount,
      pendingActionCount,
      changedFileCount,
      totalTokens,
    };
  }, [safeSessions, safeSubagents, safeChangedFiles]);

  const filteredSessions = useMemo(() => {
    const sorted = [...safeSessions].sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
    );
    switch (filter) {
      case 'running':
        return sorted.filter(isSessionActive);
      case 'pending':
        return sorted.filter(isSessionPending);
      case 'completed':
        return sorted.filter(isSessionCompleted);
      default:
        return sorted;
    }
  }, [safeSessions, safeSubagents, filter]);

  const allFilteredCollapsed =
    filteredSessions.length > 0 &&
    filteredSessions.every((s) => Boolean(collapsedSessions[s.id]));

  const toggleCollapseAll = () => {
    setCollapsedSessions((prev) => {
      const next = { ...prev };
      const targetState = !allFilteredCollapsed;
      for (const s of filteredSessions) {
        next[s.id] = targetState;
      }
      return next;
    });
  };

  const getFolderName = (folderId?: string) =>
    (folders || []).find((f) => f.id === folderId)?.name || '預設工作區';

  const filterTabs: Array<{ id: SessionFilter; label: string; count: number }> = [
    { id: 'all', label: '全部', count: safeSessions.length },
    { id: 'running', label: '執行中', count: safeSessions.filter(isSessionActive).length },
    { id: 'pending', label: '待處理', count: safeSessions.filter(isSessionPending).length },
    { id: 'completed', label: '已完成', count: safeSessions.filter(isSessionCompleted).length },
  ];

  return (
    <main
      data-testid="orchestrator-panel"
      className="flex-1 overflow-y-auto bg-ag-void p-5 space-y-5"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ag-primaryLight border border-ag-primary/30 text-ag-primary shadow-soft">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-ag-textPrimary">
              Orchestrator 調度中心 (Mission Control)
            </h1>
            <p className="text-xs text-ag-textMuted">
              跨 Session 監控並行任務、Subagent 編排、待審批操作、檔案變更與 Swarm 看板
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => newSession()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ag-primary px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 shadow-soft cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新增並行任務</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveWorkspaceView('chat')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-ag-border bg-ag-panel px-3.5 py-2 text-xs font-medium text-ag-textSecondary hover:text-ag-textPrimary hover:bg-ag-sidebar shadow-soft cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>返回對話</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-ag-border bg-ag-panel p-3.5 shadow-soft">
          <div className="flex items-center justify-between text-xs text-ag-textMuted">
            <span>運行中任務</span>
            <Activity className="h-4 w-4 text-sky-500" />
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-ag-textPrimary">
            {metrics.activeSessionCount}
          </div>
        </div>

        <div className="rounded-2xl border border-ag-border bg-ag-panel p-3.5 shadow-soft">
          <div className="flex items-center justify-between text-xs text-ag-textMuted">
            <span>活躍 Subagents</span>
            <Bot className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-ag-textPrimary">
            {metrics.activeSubagentCount}
          </div>
        </div>

        <div className="rounded-2xl border border-ag-border bg-ag-panel p-3.5 shadow-soft">
          <div className="flex items-center justify-between text-xs text-ag-textMuted">
            <span>待審批 / 提問</span>
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-ag-textPrimary">
            {metrics.pendingActionCount}
          </div>
        </div>

        <div className="rounded-2xl border border-ag-border bg-ag-panel p-3.5 shadow-soft">
          <div className="flex items-center justify-between text-xs text-ag-textMuted">
            <span>變更檔案</span>
            <FileCode className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-ag-textPrimary">
            {metrics.changedFileCount}
          </div>
        </div>

        <div className="rounded-2xl border border-ag-border bg-ag-panel p-3.5 shadow-soft col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-xs text-ag-textMuted">
            <span>累計 Tokens</span>
            <Flame className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-ag-textPrimary">
            {metrics.totalTokens.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Cross-Session Action Queue */}
      <ActionQueueSection
        sessions={safeSessions}
        folders={folders || []}
        onApprove={approveToolForSession}
        onAnswer={answerQuestionForSession}
        onSwitchSession={switchSession}
      />

      {/* Main Grid: Sessions & Subagents Matrix + Inspector */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left: Multi-Session & Subagent Execution Matrix */}
        <section
          aria-label="多 Session 與子代理人執行矩陣"
          className="xl:col-span-7 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-ag-textPrimary">
              多任務與子代理人執行矩陣
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {filteredSessions.length > 0 && (
                <button
                  type="button"
                  data-testid="toggle-collapse-all-sessions"
                  onClick={toggleCollapseAll}
                  className="inline-flex items-center gap-1 rounded-xl border border-ag-border bg-ag-panel px-2.5 py-1.5 text-xs font-medium text-ag-textSecondary hover:text-ag-textPrimary hover:bg-ag-sidebar shadow-soft cursor-pointer"
                >
                  {allFilteredCollapsed ? (
                    <>
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                      <span>全部展開</span>
                    </>
                  ) : (
                    <>
                      <ChevronsDownUp className="h-3.5 w-3.5" />
                      <span>全部摺疊</span>
                    </>
                  )}
                </button>
              )}
              <div className="flex items-center gap-1 rounded-xl border border-ag-border bg-ag-panel p-1 shadow-soft">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      filter === tab.id
                        ? 'bg-ag-primary text-white font-semibold'
                        : 'text-ag-textMuted hover:text-ag-textPrimary'
                    }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {filteredSessions.length === 0 ? (
              <div className="rounded-2xl border border-ag-border bg-ag-panel p-8 text-center text-xs text-ag-textMuted">
                目前篩選條件下沒有任務 Session
              </div>
            ) : (
              filteredSessions.map((session) => {
                const status = session.status || 'idle';
                const statusMeta = SESSION_STATUS_META[status] || SESSION_STATUS_META.idle;
                const sessionSubs = safeSubagents[session.id] || [];
                const sessionFiles = safeChangedFiles[session.id] || [];
                const isSelected = inspectedSessionId === session.id;
                const isCurrent = currentSessionId === session.id;
                const busy = isSessionActive(session);
                const isCollapsed = Boolean(collapsedSessions[session.id]);

                return (
                  <div
                    key={session.id}
                    data-testid={`orchestrator-session-${session.id}`}
                    onClick={() =>
                      setInspectedSessionId((prev) =>
                        prev === session.id ? null : session.id,
                      )
                    }
                    className={`rounded-2xl border shadow-soft transition-all cursor-pointer ${
                      isCollapsed ? 'p-3.5' : 'p-4'
                    } ${
                      isSelected
                        ? 'border-ag-primary bg-ag-primaryLight/20'
                        : 'border-ag-border bg-ag-panel hover:border-ag-primary/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          data-testid={`toggle-session-collapse-${session.id}`}
                          aria-expanded={!isCollapsed}
                          aria-label={`${isCollapsed ? '展開' : '摺疊'}對話卡片 ${session.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSessionCollapse(session.id);
                          }}
                          className="mt-0.5 rounded-lg p-1 text-ag-textMuted hover:bg-ag-sidebar hover:text-ag-textPrimary transition-colors cursor-pointer shrink-0"
                          title={isCollapsed ? '展開對話詳情' : '摺疊對話詳情'}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-ag-textPrimary truncate">
                              {session.title}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusMeta.badgeClass}`}
                            >
                              {statusMeta.label}
                            </span>
                            {isCurrent && (
                              <span className="rounded-full bg-ag-primary/15 px-2 py-0.5 text-[10px] font-semibold text-ag-primary">
                                當前聚焦
                              </span>
                            )}
                            {isCollapsed && sessionSubs.length > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-300">
                                <Bot className="h-3 w-3" />
                                <span>子代理人 ({sessionSubs.length})</span>
                              </span>
                            )}
                          </div>

                          {!isCollapsed && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[11px] text-ag-textMuted">
                              <span className="inline-flex items-center gap-1">
                                <FolderGit2 className="h-3 w-3 text-ag-primary" />
                                {getFolderName(session.folderId)}
                              </span>
                              <span className="font-mono">
                                {session.provider || 'default'} / {session.model || 'auto'}
                              </span>
                              <span className="uppercase font-mono">{session.mode}</span>
                              <span>{session.messageCount} 則訊息</span>
                              {sessionFiles.length > 0 && (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                  {sessionFiles.length} 檔案異動
                                </span>
                              )}
                              {(session.tokenUsage?.totalTokens || 0) > 0 && (
                                <span className="font-mono">
                                  {session.tokenUsage?.totalTokens.toLocaleString()} tokens
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-1.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {busy && (
                          <button
                            type="button"
                            onClick={() => cancelTaskForSession(session.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-300/60 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                            title="停止此 Session 執行中的任務"
                          >
                            <Square className="h-3 w-3" />
                            <span>停止</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => switchSession(session.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-ag-border bg-ag-sidebar px-2.5 py-1 text-[11px] font-medium text-ag-textPrimary hover:border-ag-primary hover:text-ag-primary cursor-pointer"
                        >
                          <span>進入對話</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Nested Subagents */}
                    {!isCollapsed && sessionSubs.length > 0 && (
                      <div
                        className="mt-3 pt-3 border-t border-ag-border/70 space-y-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="text-[11px] font-semibold text-ag-textSecondary flex items-center gap-1.5">
                          <Bot className="h-3.5 w-3.5 text-indigo-400" />
                          <span>子代理人 ({sessionSubs.length})</span>
                        </div>
                        {sessionSubs.map((sub) => {
                          const subMeta =
                            SUBAGENT_STATUS_META[sub.status] || SUBAGENT_STATUS_META.idle;
                          const canKill = RUNNING_SUBAGENT_STATUSES.has(sub.status);
                          return (
                            <div
                              key={sub.id}
                              className="flex items-center justify-between gap-2 rounded-xl border border-ag-border/80 bg-ag-void/40 px-2.5 py-1.5 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-ag-textPrimary truncate">
                                    {sub.alias ? `@${sub.alias} · ${sub.role}` : sub.role}
                                  </span>
                                  <span className="rounded bg-ag-sidebar px-1.5 py-0.5 font-mono text-[10px] text-ag-textMuted border border-ag-border">
                                    {sub.typeName}
                                  </span>
                                  {sub.model && (
                                    <span
                                      data-testid={`subagent-model-${sub.id}`}
                                      className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-600 dark:text-indigo-300 border border-indigo-500/25 max-w-[200px]"
                                      title={`執行模型: ${sub.model}`}
                                    >
                                      <Cpu className="h-2.5 w-2.5 shrink-0" />
                                      <span className="truncate">{sub.model}</span>
                                    </span>
                                  )}
                                  {sub.worktreeBranch && (
                                    <span className="text-[10px] font-mono text-emerald-500 truncate">
                                      {sub.worktreeBranch}
                                    </span>
                                  )}
                                </div>
                                {sub.currentToolSummary && (
                                  <div className="text-[10px] font-mono text-sky-500 truncate mt-0.5">
                                    {sub.currentToolSummary}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${subMeta.badgeClass}`}
                                >
                                  {subMeta.label}
                                </span>
                                {canKill && (
                                  <button
                                    type="button"
                                    onClick={() => killSubagentForSession(session.id, sub.id)}
                                    className="p-1 text-ag-textMuted hover:text-rose-500 rounded cursor-pointer"
                                    title={`終止子代理人 ${sub.role}`}
                                    aria-label={`終止子代理人 ${sub.role}`}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right: Inspector (Changed Files, Swarm Board, Schedules & Wakeups) */}
        <div className="xl:col-span-5">
          <OrchestratorInspector
            sessions={safeSessions}
            selectedSessionId={inspectedSessionId}
            onClearFilter={() => setInspectedSessionId(null)}
            sessionChangedFiles={safeChangedFiles}
            swarmBoards={swarmBoards || {}}
            sessionSchedules={sessionSchedules || {}}
            wakeupLogs={wakeupLogs || {}}
            onOpenChangedFile={openChangedFile}
          />
        </div>
      </div>
    </main>
  );
};

export default OrchestratorPanel;
