import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Bot,
  Search,
  Code2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Wrench,
  XCircle,
  Sparkles,
  FileText,
  Terminal,
  HelpCircle,
} from 'lucide-react';
import type { SubagentInstanceInfo, SubagentStatus } from '@harni/types';
import { useAgentStore } from '../../store/useAgentStore.js';

const getRoleIcon = (typeName: string) => {
  switch (typeName.toLowerCase()) {
    case 'researcher':
      return <Search className="w-4 h-4 text-sky-400" />;
    case 'coder':
      return <Code2 className="w-4 h-4 text-emerald-400" />;
    case 'reviewer':
      return <CheckCircle2 className="w-4 h-4 text-amber-400" />;
    case 'architect':
      return <Sparkles className="w-4 h-4 text-purple-400" />;
    default:
      return <Bot className="w-4 h-4 text-indigo-400" />;
  }
};

const getStatusBadge = (status: SubagentStatus) => {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock className="w-3 h-3" />
          排隊中
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
          執行中
        </span>
      );
    case 'waiting_for_input':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
          <HelpCircle className="w-3 h-3 text-amber-400" />
          等待回覆
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" />
          已完成
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <AlertCircle className="w-3 h-3" />
          異常
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
          <XCircle className="w-3 h-3" />
          已取消
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
          {status}
        </span>
      );
  }
};

export const SubagentPanel: React.FC = () => {
  const currentSessionId = useAgentStore((s) => s.currentSessionId);
  const subagentsMap = useAgentStore((s) => s.subagents);
  const killSubagent = useAgentStore((s) => s.killSubagent);

  const subagents: SubagentInstanceInfo[] = subagentsMap[currentSessionId] || [];
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [expandedSubagents, setExpandedSubagents] = useState<Record<string, boolean>>({});

  if (subagents.length === 0) {
    return null;
  }

  const toggleSubagent = (id: string) => {
    setExpandedSubagents((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const activeCount = subagents.filter(
    (s) => s.status === 'running' || s.status === 'pending' || s.status === 'waiting_for_input',
  ).length;

  return (
    <div className="mx-4 my-3 bg-zinc-900/80 backdrop-blur-md rounded-xl border border-zinc-800 shadow-lg overflow-hidden transition-all duration-200">
      {/* Header Bar */}
      <button
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/40 hover:bg-zinc-800/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <Bot className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-zinc-200">
            階層式子代理人編排 (Subagents)
          </span>
          <span className="px-2 py-0.5 text-xs rounded-full bg-zinc-700/60 text-zinc-300 font-mono">
            {subagents.length}
          </span>
          {activeCount > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-sky-500/20 text-sky-400 font-mono animate-pulse">
              {activeCount} 活躍中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-zinc-400 text-xs">
          {isPanelOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* Subagents List */}
      {isPanelOpen && (
        <div className="p-3 space-y-2.5 bg-zinc-950/40">
          {subagents.map((sub) => {
            const isExpanded =
              expandedSubagents[sub.id] ??
              (sub.status === 'running' || sub.status === 'waiting_for_input');

            return (
              <div
                key={sub.id}
                className="bg-zinc-900/90 border border-zinc-800/80 rounded-lg p-3 transition-all hover:border-zinc-700/80 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => toggleSubagent(sub.id)}
                    className="flex-1 flex items-center gap-2.5 text-left overflow-hidden"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    )}
                    <div className="p-1 rounded bg-zinc-800/80 shrink-0">
                      {getRoleIcon(sub.typeName)}
                    </div>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200 truncate">
                          {sub.role}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                          {sub.typeName}
                        </span>
                      </div>
                      {sub.status === 'running' && sub.currentToolSummary && (
                        <div className="flex items-center gap-1.5 text-[11px] text-sky-400 font-mono truncate mt-0.5">
                          <Wrench className="w-3 h-3 shrink-0 animate-spin" />
                          <span className="truncate">{sub.currentToolSummary}</span>
                        </div>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    {getStatusBadge(sub.status)}
                    {(sub.status === 'running' ||
                      sub.status === 'pending' ||
                      sub.status === 'waiting_for_input') && (
                      <button
                        onClick={() => killSubagent(sub.id)}
                        className="p-1 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                        title="終止此子代理人"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-zinc-800/60 space-y-2.5 text-xs">
                    {/* Meta info */}
                    <div className="flex flex-wrap items-center gap-3 text-zinc-400 font-mono">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-500" />
                        ID: <span className="text-zinc-300">{sub.id}</span>
                      </span>
                      {sub.model && (
                        <span>
                          模型: <span className="text-zinc-300 font-semibold">{sub.model}</span>
                        </span>
                      )}
                      {sub.tokenUsage && sub.tokenUsage.totalTokens > 0 && (
                        <span>
                          Tokens: <span className="text-zinc-300">{sub.tokenUsage.totalTokens.toLocaleString()}</span>
                        </span>
                      )}
                      {sub.toolCallCount !== undefined && (
                        <span className="flex items-center gap-1">
                          <Wrench className="w-3 h-3 text-zinc-500" />
                          工具調用: <span className="text-zinc-300">{sub.toolCallCount}</span>
                        </span>
                      )}
                      <span>
                        層級深度: <span className="text-zinc-300">Level {sub.depth}</span>
                      </span>
                      {sub.worktreeBranch && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          分支: <span className="text-zinc-300 font-semibold">{sub.worktreeBranch}</span>
                        </span>
                      )}
                    </div>

                    {/* Objective / Prompt */}
                    <div>
                      <div className="text-zinc-400 font-medium mb-1">任務目標 (Objective):</div>
                      <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800 text-zinc-300 whitespace-pre-wrap line-clamp-4">
                        {sub.prompt}
                      </div>
                    </div>

                    {/* Live Stream Output */}
                    {sub.status === 'running' && (sub.streamingThinking || sub.streamingText) && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-zinc-400 font-medium">
                          <Terminal className="w-3.5 h-3.5 text-sky-400" />
                          <span>即時輸出 (Live Stream):</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse ml-1" />
                        </div>
                        {sub.streamingThinking && (
                          <div className="p-2 rounded bg-indigo-950/20 border border-indigo-900/30 text-indigo-300 font-mono text-[11px] max-h-32 overflow-y-auto whitespace-pre-wrap">
                            <div className="font-semibold text-indigo-400 mb-0.5">思考過程:</div>
                            {sub.streamingThinking}
                          </div>
                        )}
                        {sub.streamingText && (
                          <div className="p-2 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-200 font-mono text-[11px] max-h-40 overflow-y-auto whitespace-pre-wrap">
                            {sub.streamingText}
                            <span className="inline-block w-1.5 h-3.5 bg-sky-400 ml-1 animate-pulse align-middle" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Structured Report Chips & Details */}
                    {sub.structuredReport && (
                      <div className="space-y-2 p-2.5 rounded bg-zinc-950/50 border border-zinc-800">
                        {/* Modified Files Chips */}
                        {sub.structuredReport.modifiedFiles && sub.structuredReport.modifiedFiles.length > 0 && (
                          <div>
                            <div className="text-zinc-400 font-medium mb-1 flex items-center gap-1">
                              <FileText className="w-3.5 h-3.5 text-emerald-400" />
                              <span>修改檔案 ({sub.structuredReport.modifiedFiles.length}):</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {sub.structuredReport.modifiedFiles.map((file, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono"
                                >
                                  <Code2 className="w-3 h-3" />
                                  {file}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Verification Section */}
                        {sub.structuredReport.verification && (
                          <div>
                            <div className="text-zinc-400 font-medium mb-1 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>驗證結果 (Verification):</span>
                            </div>
                            <div className="p-2 rounded bg-emerald-950/20 border border-emerald-800/30 text-emerald-300 font-mono text-[11px] whitespace-pre-wrap">
                              {sub.structuredReport.verification}
                            </div>
                          </div>
                        )}

                        {/* Findings */}
                        {sub.structuredReport.findings && sub.structuredReport.findings.length > 0 && (
                          <div>
                            <div className="text-zinc-400 font-medium mb-1 flex items-center gap-1">
                              <Search className="w-3.5 h-3.5 text-sky-400" />
                              <span>關鍵發現 (Findings):</span>
                            </div>
                            <ul className="list-disc list-inside space-y-0.5 text-zinc-300 pl-1">
                              {sub.structuredReport.findings.map((item, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Open Questions */}
                        {sub.structuredReport.openQuestions && sub.structuredReport.openQuestions.length > 0 && (
                          <div>
                            <div className="text-zinc-400 font-medium mb-1 flex items-center gap-1">
                              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                              <span>待決問題 (Open Questions):</span>
                            </div>
                            <ul className="list-disc list-inside space-y-0.5 text-amber-300/90 pl-1">
                              {sub.structuredReport.openQuestions.map((item, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Result / Output */}
                    {sub.result && (
                      <div>
                        <div className="text-zinc-400 font-medium mb-1">執行總結與產出 (Report):</div>
                        <div className="p-2.5 rounded bg-zinc-950/80 border border-emerald-950/40 text-zinc-200 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed font-sans">
                          {sub.result}
                        </div>
                      </div>
                    )}

                    {/* Error message if any */}
                    {sub.error && (
                      <div>
                        <div className="text-rose-400 font-medium mb-1">錯誤訊息 (Error):</div>
                        <div className="p-2 rounded bg-rose-950/20 border border-rose-900/40 text-rose-300 whitespace-pre-wrap">
                          {sub.error}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
