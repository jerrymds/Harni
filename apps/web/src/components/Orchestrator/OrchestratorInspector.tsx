import React, { useState } from 'react';
import {
  Bell,
  Clock,
  FileCode,
  GitCompare,
  MessageSquare,
  Repeat,
  Users,
  X,
} from 'lucide-react';
import type {
  ChatSession,
  ScheduleInfo,
  SessionChangedFile,
  SwarmBoardState,
  WakeupEventInfo,
} from '@harni/types';

type InspectorTab = 'files' | 'swarm' | 'schedules';

interface OrchestratorInspectorProps {
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onClearFilter: () => void;
  sessionChangedFiles: Record<string, SessionChangedFile[]>;
  swarmBoards: Record<string, SwarmBoardState>;
  sessionSchedules: Record<string, ScheduleInfo[]>;
  wakeupLogs: Record<string, WakeupEventInfo[]>;
  onOpenChangedFile: (sessionId: string, filePath: string) => void;
}

export const OrchestratorInspector: React.FC<OrchestratorInspectorProps> = ({
  sessions,
  selectedSessionId,
  onClearFilter,
  sessionChangedFiles,
  swarmBoards,
  sessionSchedules,
  wakeupLogs,
  onOpenChangedFile,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('files');

  const targetSessionIds = selectedSessionId
    ? [selectedSessionId]
    : Array.from(
        new Set([
          ...sessions.map((s) => s.id),
          ...Object.keys(sessionChangedFiles),
          ...Object.keys(swarmBoards),
          ...Object.keys(sessionSchedules),
          ...Object.keys(wakeupLogs),
        ]),
      );

  const getSessionTitle = (sid: string) =>
    sessions.find((s) => s.id === sid)?.title || sid;

  const aggregatedFiles = targetSessionIds.flatMap((sid) =>
    (sessionChangedFiles[sid] || []).map((file) => ({
      sessionId: sid,
      sessionTitle: getSessionTitle(sid),
      file,
    })),
  );
  aggregatedFiles.sort((a, b) => b.file.updatedAt - a.file.updatedAt);

  const activeBoards = targetSessionIds
    .map((sid) => swarmBoards[sid])
    .filter((b): b is SwarmBoardState => Boolean(b));

  const aggregatedSchedules = targetSessionIds.flatMap((sid) =>
    (sessionSchedules[sid] || []).map((schedule) => ({
      sessionId: sid,
      sessionTitle: getSessionTitle(sid),
      schedule,
    })),
  );

  const aggregatedWakeups = targetSessionIds
    .flatMap((sid) =>
      (wakeupLogs[sid] || []).map((log) => ({
        sessionId: sid,
        sessionTitle: getSessionTitle(sid),
        log,
      })),
    )
    .sort((a, b) => b.log.timestamp - a.log.timestamp);

  return (
    <aside
      aria-label="跨 Session 詳情檢視"
      className="rounded-2xl border border-ag-border bg-ag-panel p-4 shadow-soft flex flex-col min-h-[420px]"
    >
      {/* Inspector Header & Filter Indicator */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-ag-border">
        <div className="flex items-center gap-1 rounded-xl border border-ag-border bg-ag-sidebar p-1">
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'files'
                ? 'bg-ag-primary text-white shadow-soft'
                : 'text-ag-textMuted hover:text-ag-textPrimary'
            }`}
          >
            <FileCode className="h-3.5 w-3.5" />
            <span>變更檔案 ({aggregatedFiles.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('swarm')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'swarm'
                ? 'bg-ag-primary text-white shadow-soft'
                : 'text-ag-textMuted hover:text-ag-textPrimary'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Swarm 看板 ({activeBoards.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedules')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'schedules'
                ? 'bg-ag-primary text-white shadow-soft'
                : 'text-ag-textMuted hover:text-ag-textPrimary'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>
              排程與喚醒 ({aggregatedSchedules.length + aggregatedWakeups.length})
            </span>
          </button>
        </div>

        {selectedSessionId && (
          <button
            type="button"
            onClick={onClearFilter}
            className="inline-flex items-center gap-1 rounded-lg border border-ag-border bg-ag-sidebar px-2 py-1 text-[11px] text-ag-textSecondary hover:text-ag-textPrimary cursor-pointer"
            title="切換回檢視全部 Sessions"
          >
            <span className="max-w-[110px] truncate">{getSessionTitle(selectedSessionId)}</span>
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Tab Body */}
      <div className="mt-3 flex-1 overflow-y-auto space-y-2.5">
        {activeTab === 'files' && (
          <>
            {aggregatedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-ag-textMuted">
                <FileCode className="h-8 w-8 mb-2 opacity-40" />
                <p>目前尚無記錄到檔案變更</p>
                <p className="text-[11px] mt-1">
                  當各 Session 或 Subagent 修改檔案時，將會自動彙整於此
                </p>
              </div>
            ) : (
              aggregatedFiles.map(({ sessionId, sessionTitle, file }) => (
                <button
                  key={`${sessionId}:${file.path}`}
                  type="button"
                  onClick={() => onOpenChangedFile(sessionId, file.path)}
                  className="w-full text-left rounded-xl border border-ag-border bg-ag-void/40 hover:border-ag-primary/50 hover:bg-ag-primaryLight/30 p-3 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {file.diff ? (
                        <GitCompare className="h-3.5 w-3.5 text-ag-primary shrink-0" />
                      ) : (
                        <FileCode className="h-3.5 w-3.5 text-ag-textSecondary shrink-0" />
                      )}
                      <span className="font-mono text-xs font-medium text-ag-textPrimary group-hover:text-ag-primary truncate">
                        {file.path}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        file.diff
                          ? 'bg-ag-primaryLight text-ag-primary'
                          : 'bg-ag-sidebar text-ag-textMuted border border-ag-border'
                      }`}
                    >
                      {file.diff ? 'Diff' : '檔案'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-ag-textMuted">
                    <span className="truncate">{sessionTitle}</span>
                    <span className="shrink-0">
                      {file.source === 'subagent'
                        ? `Subagent${file.subagentRole ? `: ${file.subagentRole}` : ''}`
                        : '主 Agent'}
                    </span>
                  </div>
                </button>
              ))
            )}
          </>
        )}

        {activeTab === 'swarm' && (
          <>
            {activeBoards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-ag-textMuted">
                <Users className="h-8 w-8 mb-2 opacity-40" />
                <p>尚無活躍中的 Swarm 協作看板</p>
                <p className="text-[11px] mt-1">
                  當任務啟用 swarm 工具進行多代理人協作時，會顯示成員與討論串
                </p>
              </div>
            ) : (
              activeBoards.map((board) => (
                <div
                  key={board.sessionId}
                  className="rounded-xl border border-ag-border bg-ag-void/40 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-ag-textPrimary truncate">
                        {board.title || `Swarm (${getSessionTitle(board.sessionId)})`}
                      </div>
                      <div className="text-[11px] text-ag-textMuted truncate">
                        {getSessionTitle(board.sessionId)}
                      </div>
                    </div>
                    <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-mono text-indigo-500 dark:text-indigo-300 shrink-0">
                      {board.members.length} 成員
                    </span>
                  </div>

                  {board.members.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {board.members.map((m) => (
                        <span
                          key={m.subagentId}
                          className="inline-flex items-center gap-1 rounded-lg border border-ag-border bg-ag-panel px-2 py-0.5 text-[11px] text-ag-textSecondary"
                          title={`${m.role}${m.forkedFrom ? ` (forked from ${m.forkedFrom})` : ''}`}
                        >
                          <span className="font-mono font-semibold text-ag-primary">@{m.name}</span>
                          <span className="text-ag-textMuted">({m.status})</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {board.messages.length > 0 && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pt-1 border-t border-ag-border/60">
                      {board.messages.slice(-8).map((m) => (
                        <div
                          key={m.id}
                          className="rounded-lg bg-ag-panel/80 px-2.5 py-1.5 text-[11px] border border-ag-border/60"
                        >
                          <div className="flex items-center justify-between text-ag-textMuted mb-0.5">
                            <span className="font-mono font-semibold text-ag-textPrimary flex items-center gap-1">
                              <MessageSquare className="h-3 w-3 text-ag-primary" />
                              {m.sender}
                            </span>
                            <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-ag-textSecondary whitespace-pre-wrap break-words">
                            {m.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === 'schedules' && (
          <div className="space-y-3">
            {aggregatedSchedules.length === 0 && aggregatedWakeups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-ag-textMuted">
                <Clock className="h-8 w-8 mb-2 opacity-40" />
                <p>目前無排程任務或喚醒紀錄</p>
                <p className="text-[11px] mt-1">
                  Timer、Cron 排程與背景子代理人喚醒事件會即時記錄於此
                </p>
              </div>
            ) : (
              <>
                {aggregatedSchedules.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-ag-textSecondary">
                      作用中排程 ({aggregatedSchedules.length})
                    </div>
                    {aggregatedSchedules.map(({ sessionId, sessionTitle, schedule }) => (
                      <div
                        key={schedule.id}
                        className="rounded-xl border border-ag-border bg-ag-void/40 p-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                            {schedule.kind === 'cron' ? (
                              <Repeat className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            {schedule.kind === 'cron'
                              ? schedule.cronExpression
                              : `${schedule.durationSeconds}s Timer`}
                          </span>
                          <span className="text-[10px] text-ag-textMuted">
                            已觸發 {schedule.iterations} 次{schedule.isDaemon ? ' · Daemon' : ''}
                          </span>
                        </div>
                        <p className="text-[11px] text-ag-textPrimary line-clamp-2">
                          {schedule.prompt}
                        </p>
                        <div className="text-[10px] text-ag-textMuted truncate">
                          Session: {sessionTitle} ({sessionId})
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {aggregatedWakeups.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-ag-textSecondary">
                      最近喚醒紀錄 ({aggregatedWakeups.length})
                    </div>
                    {aggregatedWakeups.slice(0, 15).map(({ sessionTitle, log }, idx) => (
                      <div
                        key={log.id || `${log.sessionId}-${log.timestamp}-${idx}`}
                        className="rounded-xl border border-ag-border bg-ag-void/40 p-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                            <Bell className="h-3 w-3" />
                            {log.source}
                          </span>
                          <span className="text-[10px] text-ag-textMuted">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-[11px] text-ag-textPrimary">{log.summary}</p>
                        <div className="text-[10px] text-ag-textMuted truncate">
                          {sessionTitle}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
