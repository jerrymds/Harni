import React, { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckSquare,
  HelpCircle,
  Send,
  ShieldAlert,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import type { ChatSession, WorkspaceFolder } from '@harni/types';

interface ActionQueueSectionProps {
  sessions: ChatSession[];
  folders: WorkspaceFolder[];
  onApprove: (sessionId: string, toolCallId: string, approved: boolean, feedback?: string) => void;
  onAnswer: (
    sessionId: string,
    toolCallId: string,
    answers: string[],
    customInput?: string,
  ) => void;
  onSwitchSession: (sessionId: string) => void;
}

export const ActionQueueSection: React.FC<ActionQueueSectionProps> = ({
  sessions,
  folders,
  onApprove,
  onAnswer,
  onSwitchSession,
}) => {
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});
  const [rejectOpenMap, setRejectOpenMap] = useState<Record<string, boolean>>({});
  const [selectedOptionsMap, setSelectedOptionsMap] = useState<Record<string, string[]>>({});
  const [customInputMap, setCustomInputMap] = useState<Record<string, string>>({});

  const actionSessions = sessions.filter((s) => s.pendingApproval || s.pendingQuestion);

  if (actionSessions.length === 0) {
    return null;
  }

  const getFolderName = (folderId?: string) =>
    folders.find((f) => f.id === folderId)?.name || '未分類工作區';

  const toggleOption = (questionKey: string, option: string, isMulti: boolean) => {
    setSelectedOptionsMap((prev) => {
      const current = prev[questionKey] || [];
      if (isMulti) {
        return {
          ...prev,
          [questionKey]: current.includes(option)
            ? current.filter((item) => item !== option)
            : [...current, option],
        };
      }
      return {
        ...prev,
        [questionKey]: current.includes(option) ? [] : [option],
      };
    });
  };

  const handleApproveAction = (
    sessionId: string,
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => {
    const approvalKey = `${sessionId}:${approvalId}`;
    setRejectOpenMap((prev) => {
      const next = { ...prev };
      delete next[approvalKey];
      return next;
    });
    setFeedbackMap((prev) => {
      const next = { ...prev };
      delete next[approvalKey];
      return next;
    });
    onApprove(sessionId, approvalId, approved, feedback);
  };

  const handleAnswerAction = (
    sessionId: string,
    toolCallId: string,
    answers: string[],
    customInput?: string,
  ) => {
    const questionKey = `${sessionId}:${toolCallId}`;
    setSelectedOptionsMap((prev) => {
      const next = { ...prev };
      delete next[questionKey];
      return next;
    });
    setCustomInputMap((prev) => {
      const next = { ...prev };
      delete next[questionKey];
      return next;
    });
    onAnswer(sessionId, toolCallId, answers, customInput);
  };

  return (
    <section
      aria-label="待處理審批與提問佇列"
      className="rounded-2xl border border-amber-400/40 bg-amber-500/5 p-4 shadow-soft"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-bold text-ag-textPrimary">
            待處理審批與提問佇列 (Action Queue)
          </h2>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-mono font-semibold text-amber-700 dark:text-amber-300">
            {actionSessions.length}
          </span>
        </div>
        <span className="text-[11px] text-ag-textMuted">
          可直接原地審批或回覆，無須離開調度中心
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {actionSessions.map((session) => {
          const folderName = getFolderName(session.folderId);
          const approval = session.pendingApproval;
          const question = session.pendingQuestion;
          const approvalKey = approval ? `${session.id}:${approval.id}` : '';
          const questionKey = question ? `${session.id}:${question.toolCallId}` : '';

          const isCommand =
            approval?.name === 'run_command' || approval?.name === 'execute_command';
          const showRejectInput = approval ? Boolean(rejectOpenMap[approvalKey]) : false;
          const feedback = approval ? feedbackMap[approvalKey] || '' : '';

          const isMulti = Boolean(question?.isMultiSelect);
          const selected = question ? selectedOptionsMap[questionKey] || [] : [];
          const customInput = question ? customInputMap[questionKey] || '' : '';
          const canSubmit = selected.length > 0 || customInput.trim().length > 0;

          return (
            <React.Fragment key={session.id}>
              {approval && (
                <div
                  key={`approval-${approvalKey}`}
                  data-testid={`action-approval-${session.id}`}
                  className="rounded-xl border border-amber-400/50 bg-ag-panel p-3.5 shadow-soft flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 shrink-0">
                          <ShieldAlert className="h-3 w-3" />
                          工具審批
                        </span>
                        <span className="text-xs font-semibold text-ag-textPrimary truncate">
                          {session.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-ag-sidebar text-ag-textMuted border border-ag-border truncate">
                          {folderName}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSwitchSession(session.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-ag-primary hover:underline shrink-0 cursor-pointer"
                      >
                        <span>前往對話</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-ag-textSecondary mb-1.5">
                      <span className="font-mono font-semibold text-ag-textPrimary">
                        {approval.name}
                      </span>
                      {approval.subagentRole && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          Subagent: {approval.subagentRole}
                        </span>
                      )}
                    </div>

                    <div className="rounded-lg border border-ag-border bg-ag-void/70 p-2.5 font-mono text-[11px] text-ag-textPrimary overflow-x-auto max-h-28">
                      {isCommand ? (
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <Terminal className="h-3.5 w-3.5 shrink-0" />
                          <span>{String(approval.arguments?.command || '')}</span>
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-all">
                          {JSON.stringify(approval.arguments, null, 2)}
                        </pre>
                      )}
                    </div>

                    {showRejectInput && (
                      <input
                        type="text"
                        value={feedback}
                        onChange={(e) =>
                          setFeedbackMap((prev) => ({ ...prev, [approvalKey]: e.target.value }))
                        }
                        placeholder="輸入拒絕原因或修改指示..."
                        className="mt-2 w-full rounded-lg border border-ag-border bg-ag-void px-2.5 py-1.5 text-xs text-ag-textPrimary outline-none focus:border-ag-primary"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    {!showRejectInput ? (
                      <button
                        type="button"
                        onClick={() =>
                          setRejectOpenMap((prev) => ({ ...prev, [approvalKey]: true }))
                        }
                        className="rounded-lg border border-ag-border bg-ag-sidebar px-2.5 py-1 text-xs font-medium text-ag-textSecondary hover:text-ag-textPrimary cursor-pointer"
                      >
                        拒絕並反饋
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          handleApproveAction(session.id, approval.id, false, feedback)
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>確認拒絕</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleApproveAction(session.id, approval.id, true)}
                      className="inline-flex items-center gap-1 rounded-lg bg-ag-primary px-3 py-1 text-xs font-semibold text-white hover:opacity-90 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>允許執行</span>
                    </button>
                  </div>
                </div>
              )}

              {question && (
                <div
                  key={`question-${questionKey}`}
                  data-testid={`action-question-${session.id}`}
                  className="rounded-xl border border-ag-primary/40 bg-ag-panel p-3.5 shadow-soft flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center gap-1 rounded-md bg-ag-primaryLight px-2 py-0.5 text-[11px] font-semibold text-ag-primary shrink-0">
                          <HelpCircle className="h-3 w-3" />
                          等待提問回覆
                        </span>
                        <span className="text-xs font-semibold text-ag-textPrimary truncate">
                          {session.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-ag-sidebar text-ag-textMuted border border-ag-border truncate">
                          {folderName}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSwitchSession(session.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-ag-primary hover:underline shrink-0 cursor-pointer"
                      >
                        <span>前往對話</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    </div>

                    <p className="rounded-lg border border-ag-border bg-ag-void/60 p-2.5 text-xs text-ag-textPrimary whitespace-pre-wrap mb-2">
                      {question.question}
                    </p>

                    {question.options && question.options.length > 0 && (
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 mb-2">
                        {question.options.map((opt) => {
                          const isSelected = selected.includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => toggleOption(questionKey, opt, isMulti)}
                              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                                isSelected
                                  ? 'border-ag-primary bg-ag-primaryLight text-ag-primary font-semibold'
                                  : 'border-ag-border bg-ag-void/40 text-ag-textPrimary hover:bg-ag-sidebar'
                              }`}
                            >
                              {isMulti ? (
                                isSelected ? (
                                  <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <Square className="h-3.5 w-3.5 shrink-0 text-ag-textMuted" />
                                )
                              ) : (
                                <span
                                  className={`h-3 w-3 rounded-full border shrink-0 ${
                                    isSelected
                                      ? 'border-ag-primary bg-ag-primary'
                                      : 'border-ag-border'
                                  }`}
                                />
                              )}
                              <span className="truncate">{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {question.allowCustomInput !== false && (
                      <input
                        type="text"
                        value={customInput}
                        onChange={(e) =>
                          setCustomInputMap((prev) => ({
                            ...prev,
                            [questionKey]: e.target.value,
                          }))
                        }
                        placeholder="補充說明或自訂回答..."
                        className="w-full rounded-lg border border-ag-border bg-ag-void px-2.5 py-1.5 text-xs text-ag-textPrimary outline-none focus:border-ag-primary"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      disabled={!canSubmit}
                      onClick={() =>
                        handleAnswerAction(
                          session.id,
                          question.toolCallId,
                          selected,
                          customInput.trim() || undefined,
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-ag-primary px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>送出回答</span>
                    </button>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
};
