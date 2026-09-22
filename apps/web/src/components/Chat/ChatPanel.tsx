import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bot,
  Brain,
  CornerDownLeft,
  GitBranch,
  GitMerge,
  Layers,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import type { AgentMode, ChatMessage, LLMProviderType, ModelInfo, TokenUsage, ToolCallRequest } from '@harni/types';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';
import { resolveModelContextWindow, formatTokenCount } from '../../utils/modelContext.js';
import { ApprovalCard } from './ApprovalCard.js';
import { QuestionCard } from './QuestionCard.js';
import { ChatMessageItem } from './ChatMessageItem.js';
import { SkillDropdown } from './SkillDropdown.js';
import { SubagentPanel } from './SubagentPanel.js';
import { ThinkingAccordion } from './ThinkingAccordion.js';
import { CommandExecutionAccordion } from './CommandExecutionAccordion.js';
import { groupMessagesIntoTurns } from '../../utils/chatTurns.js';

// --- Welcome Card Component (Memoized) ---
interface WelcomeCardProps {
  onSelectPrompt: (prompt: string) => void;
}

const WelcomeCard: React.FC<WelcomeCardProps> = memo(({ onSelectPrompt }) => {
  const starterSkills = [
    { title: '🏗️ 專案架構審查 (Skill)', prompt: '請使用 architecture_audit 技能幫我分析專案結構、模組相依與資料流程說明' },
    { title: '🧪 執行測試套件 (Skill)', prompt: '請使用 run_test_suite 技能執行專案測試，並回報詳細結果' },
    { title: '🛡️ 全面代碼審查 (Skill)', prompt: '請使用 code_review 技能審查現有代碼的安全性、型別與最佳實踐' },
    { title: '📦 Git 智慧提交 (Skill)', prompt: '請使用 git_smart_commit 技能檢查當前 Git 異動並生成標準 Commit Message，不要執行測試' },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center select-none animate-in fade-in zoom-in-95 duration-200">
      <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-ag-primaryLight border border-ag-border text-ag-primary mb-4 shadow-soft">
        <Zap className="h-8 w-8 fill-ag-primary text-ag-primary" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-ag-textPrimary">
        Coding Agent Workspace
      </h2>
      <p className="text-sm text-ag-textSecondary mt-2 max-w-md leading-relaxed">
        全自主 Coding Agent。支援多輪代碼生成、檔案讀寫修改、CLI 終端執行與架構推理，為您提供護眼舒適的開發體驗。
      </p>

      {/* Starter Quick Actions with Skills */}
      <div className="mt-8 grid grid-cols-2 gap-3 w-full max-w-lg text-left">
        {starterSkills.map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className="flex flex-col p-3 rounded-2xl border border-ag-border bg-ag-panel hover:border-ag-primary hover:bg-ag-primaryLight text-xs transition-all duration-150 cursor-pointer group shadow-soft"
          >
            <span className="font-semibold text-ag-textPrimary group-hover:text-ag-primary transition-colors">{item.title}</span>
            <span className="text-[11px] text-ag-textMuted mt-1 line-clamp-1">
              {item.prompt}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});

WelcomeCard.displayName = 'WelcomeCard';

// --- Context Usage Badge (Memoized) ---
interface ContextUsageBadgeProps {
  tokenUsage: TokenUsage;
  messages: ChatMessage[];
  selectedProvider: LLMProviderType;
  selectedModel: string;
  availableModels: Record<string, ModelInfo[]>;
}

const ContextUsageBadge: React.FC<ContextUsageBadgeProps> = memo(({
  tokenUsage,
  messages,
  selectedProvider,
  selectedModel,
  availableModels,
}) => {
  const liveModels = availableModels[selectedProvider] || [];
  const currentModelInfo = liveModels.find((m) => m.id === selectedModel);

  const maxContextWindow = useMemo(() => {
    return resolveModelContextWindow(selectedModel, selectedProvider, currentModelInfo);
  }, [currentModelInfo, selectedModel, selectedProvider]);

  const estimatedMessageTokens = useMemo(() => {
    let chars = 0;
    for (const m of messages) {
      chars += (m.content?.length || 0) + (m.thinking?.length || 0);
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
      if (m.toolResult) {
        chars += typeof m.toolResult.output === 'string'
          ? m.toolResult.output.length
          : JSON.stringify(m.toolResult.output || '').length;
      }
    }
    return Math.ceil(chars / 4);
  }, [messages]);

  const totalContextTokens =
    tokenUsage.totalTokens > 0 ? tokenUsage.totalTokens : estimatedMessageTokens;
  const promptTokens =
    tokenUsage.promptTokens > 0 ? tokenUsage.promptTokens : estimatedMessageTokens;
  const completionTokens = tokenUsage.completionTokens || 0;
  const usagePercent = Math.min(100, (totalContextTokens / maxContextWindow) * 100);

  return (
    <div
      className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg border text-[10.5px] font-medium transition-all cursor-default select-none ${
        usagePercent > 85
          ? 'border-rose-300/80 bg-rose-50/80 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
          : usagePercent > 60
            ? 'border-amber-300/80 bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
            : 'border-ag-border bg-ag-sidebar/60 text-ag-textSecondary hover:text-ag-textPrimary'
      }`}
      title={`Context 用量詳細資訊:\n• 當前 Context: ${totalContextTokens.toLocaleString()} tokens\n• 輸入 (Prompt): ${promptTokens.toLocaleString()} tokens\n• 輸出 (Completion): ${completionTokens.toLocaleString()} tokens\n• 模型上限 (Max Window): ${maxContextWindow.toLocaleString()} tokens\n• 使用率: ${usagePercent.toFixed(1)}%`}
    >
      <div
        className={`h-1.5 w-1.5 rounded-full ${
          usagePercent > 85
            ? 'bg-rose-500 animate-pulse'
            : usagePercent > 60
              ? 'bg-amber-500'
              : 'bg-ag-primary'
        }`}
      />
      <span>
        Context: <span className="font-semibold text-ag-textPrimary">{formatTokenCount(totalContextTokens)}</span> / {formatTokenCount(maxContextWindow)} ({usagePercent < 1 && usagePercent > 0 ? usagePercent.toFixed(1) : Math.round(usagePercent)}%)
      </span>
    </div>
  );
});

ContextUsageBadge.displayName = 'ContextUsageBadge';

// --- Chat Header Bar (Memoized) ---
interface ChatHeaderBarProps {
  selectedProvider: LLMProviderType;
  selectedModel: string;
  selectedMode: AgentMode;
  hasMessages: boolean;
  hasCheckpoint?: boolean;
  checkpointId?: string;
  isReverting?: boolean;
  onRollback?: () => void;
  onClear: () => void;
}

const ChatHeaderBar: React.FC<ChatHeaderBarProps> = memo(({
  selectedProvider,
  selectedModel,
  selectedMode,
  hasMessages,
  hasCheckpoint,
  checkpointId,
  isReverting,
  onRollback,
  onClear,
}) => {
  return (
    <div className="flex h-10 items-center justify-between border-b border-ag-border px-6 bg-ag-panel/70 text-xs select-none backdrop-blur-xs">
      <div className="flex items-center space-x-2 text-ag-textSecondary">
        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
        <span className="font-semibold text-ag-textPrimary">
          {selectedProvider.toUpperCase()} / {selectedModel || 'Default Model'}
        </span>
        <span className="text-ag-border">|</span>
        <span className="capitalize font-mono text-[11px] text-ag-primary font-medium">
          {selectedMode} Mode
        </span>
      </div>

      <div className="flex items-center space-x-2.5">
        {hasCheckpoint && onRollback && (
          <button
            type="button"
            onClick={onRollback}
            disabled={isReverting}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-amber-300/80 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[11px] font-medium transition-all cursor-pointer shadow-soft disabled:opacity-50"
            title={`一鍵還原工作區檔案至執行本次任務前狀態 (${checkpointId || ''})`}
          >
            <RotateCcw className={`h-3 w-3 ${isReverting ? 'animate-spin' : ''}`} />
            <span>{isReverting ? '還原中...' : '還原到本次任務前 (Rollback)'}</span>
          </button>
        )}

        {hasMessages && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-ag-textMuted hover:text-rose-600 transition-colors cursor-pointer"
          >
            清空訊息 (Clear)
          </button>
        )}
      </div>
    </div>
  );
});

ChatHeaderBar.displayName = 'ChatHeaderBar';

// --- Main ChatPanel Component ---
export const ChatPanel: React.FC = () => {
  // Fine-grained Zustand selectors with useShallow
  const messages = useAgentStore((s) => s.messages);
  const activeThinking = useAgentStore((s) => s.activeThinking);
  const pendingApproval = useAgentStore((s) => s.pendingApproval);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const status = useAgentStore((s) => s.status);
  const selectedMode = useAgentStore((s) => s.selectedMode);
  const selectedProvider = useAgentStore((s) => s.selectedProvider);
  const selectedModel = useAgentStore((s) => s.selectedModel);
  const availableModels = useAgentStore((s) => s.availableModels);
  const tokenUsage = useAgentStore((s) => s.tokenUsage);
  const autoApprove = useAgentStore((s) => s.autoApprove);
  const currentSessionId = useAgentStore((s) => s.currentSessionId);
  const checkpoints = useAgentStore((s) => s.checkpoints);
  const activeWorktrees = useAgentStore((s) => s.activeWorktrees);
  const isRevertingCheckpoint = useAgentStore((s) => s.isRevertingCheckpoint);
  const worktreeIsolationEnabled = useAgentStore((s) => s.worktreeIsolationEnabled);
  const subagentsEnabled = useAgentStore((s) => s.subagentsEnabled);

  const {
    setAutoApprove,
    sendPrompt,
    cancelTask,
    approveTool,
    answerQuestion,
    clearMessages,
    rollbackCheckpoint,
    mergeWorktree,
    discardWorktree,
    setWorktreeIsolationEnabled,
    setSubagentsEnabled,
  } = useAgentStore(
    useShallow((s) => ({
      setAutoApprove: s.setAutoApprove,
      sendPrompt: s.sendPrompt,
      cancelTask: s.cancelTask,
      approveTool: s.approveTool,
      answerQuestion: s.answerQuestion,
      clearMessages: s.clearMessages,
      rollbackCheckpoint: s.rollbackCheckpoint,
      mergeWorktree: s.mergeWorktree,
      discardWorktree: s.discardWorktree,
      setWorktreeIsolationEnabled: s.setWorktreeIsolationEnabled,
      setSubagentsEnabled: s.setSubagentsEnabled,
    }))
  );

  const currentWorktree = activeWorktrees[currentSessionId];
  const sessionCheckpoints = checkpoints.filter((c) => c.sessionId === currentSessionId);
  const latestCheckpoint = sessionCheckpoints[0];

  const [inputPrompt, setInputPrompt] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isBusy =
    status === 'thinking' ||
    status === 'executing_tool' ||
    status === 'streaming' ||
    status === 'testing';

  const turns = useMemo(() => groupMessagesIntoTurns(messages, isBusy), [messages, isBusy]);

  // Virtualizer for structured dialogue turns
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 180,
    overscan: 4,
    getItemKey: (index) => turns[index]?.id || index,
  });

  const virtualItems = virtualizer.getVirtualItems();

  const lastMsgContent = messages[messages.length - 1]?.content;
  const hasThinking = Boolean(activeThinking);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      if (status === 'streaming' || status === 'thinking') {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
      scrollRafRef.current = null;
    });

    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages.length, lastMsgContent, hasThinking, pendingApproval, status]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputPrompt.trim() || isBusy) return;

    sendPrompt(inputPrompt);
    setInputPrompt('');
  }, [inputPrompt, isBusy, sendPrompt]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSelectPrompt = useCallback((prompt: string) => {
    setInputPrompt(prompt);
    textareaRef.current?.focus();
  }, []);

  return (
    <main className="flex h-full flex-1 flex-col bg-ag-bg relative overflow-hidden">
      {/* Top Banner / Breadcrumb */}
      <ChatHeaderBar
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        selectedMode={selectedMode}
        hasMessages={messages.length > 0}
        hasCheckpoint={!!latestCheckpoint && !isBusy}
        checkpointId={latestCheckpoint?.id}
        isReverting={isRevertingCheckpoint}
        onRollback={() => rollbackCheckpoint(currentSessionId, latestCheckpoint?.id)}
        onClear={clearMessages}
      />

      {/* Main Conversation Stream with Virtual Scrolling */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar"
      >
        <div className="mx-auto w-[90%]">
          {/* Welcome Card if no messages */}
          {messages.length === 0 ? (
            <WelcomeCard onSelectPrompt={handleSelectPrompt} />
          ) : (
            <>
              {/* Virtualized Turn List */}
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualItems.map((virtualRow) => {
                  const turn = turns[virtualRow.index];
                  if (!turn) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="pb-4 space-y-2"
                    >
                      {turn.userMessage && <ChatMessageItem msg={turn.userMessage} />}
                      {turn.intermediateCommands.length > 0 && (
                        <CommandExecutionAccordion
                          intermediateCommands={turn.intermediateCommands}
                          isFinished={turn.isFinished}
                        />
                      )}
                      {turn.finalAssistantMessage && (
                        <ChatMessageItem msg={turn.finalAssistantMessage} />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Live Streaming Reasoning / Thinking Stream */}
              {activeThinking && isBusy && (
                <div className="mt-2">
                  <ThinkingAccordion thinking={activeThinking} isStreaming={true} />
                </div>
              )}

              {/* Initial Live Thinking Beacon if activeThinking text is not yet streamed */}
              {isBusy && status === 'thinking' && !activeThinking && (
                <div className="my-2.5 flex items-center space-x-3 rounded-2xl border border-ag-primary/35 bg-ag-primaryLight p-4 shadow-soft animate-in fade-in duration-200">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ag-panel border border-ag-primary/25 shadow-xs">
                    <Brain className="h-4 w-4 text-ag-primary animate-pulse" />
                  </div>
                  <div className="flex flex-col space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-ag-textPrimary text-xs tracking-wide">
                        AI 思考與推理中 (Reasoning)...
                      </span>
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ag-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-ag-primary" />
                      </span>
                    </div>
                    <span className="text-[11px] text-ag-textSecondary font-mono">
                      Agent 正在分析上下文與構思方案...
                    </span>
                  </div>
                </div>
              )}

              {/* Pending Approval Card */}
              {pendingApproval && (
                <ApprovalCard
                  toolCall={pendingApproval}
                  onApprove={(toolCallId, approved, feedback) =>
                    approveTool(toolCallId, approved, feedback)
                  }
                />
              )}

              {/* Interactive Question Prompt Card */}
              {pendingQuestion && (
                <QuestionCard
                  prompt={pendingQuestion}
                  onSubmit={(toolCallId, answers, customInput) =>
                    answerQuestion(toolCallId, answers, customInput)
                  }
                />
              )}

              {/* Hierarchical Subagent Orchestration Live View */}
              <SubagentPanel />

              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </div>

      {/* Floating Bottom Prompt Composer */}
      <div className="p-4 bg-gradient-to-t from-ag-bg via-ag-bg/95 to-transparent">
        <div className="mx-auto w-[90%]">
          {/* Worktree Isolation Live Notification Banner */}
          {currentWorktree && currentWorktree.isWorktree && (
            <div className="mb-3 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs shadow-soft animate-in fade-in duration-200">
              <div className="flex items-center space-x-2.5">
                <GitBranch className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <div className="flex flex-col">
                  <span className="font-semibold text-ag-textPrimary">
                    Worktree 隔離環境中作業
                  </span>
                  <span className="text-[11px] text-ag-textSecondary font-mono">
                    分支: {currentWorktree.branch || 'agent-worktree'} (不影響主工作區)
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => mergeWorktree(currentSessionId)}
                  disabled={isBusy}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  title="將 Worktree 中的變更合併回主工作目錄"
                >
                  <GitMerge className="h-3 w-3" />
                  <span>合併 (Merge)</span>
                </button>
                <button
                  type="button"
                  onClick={() => discardWorktree(currentSessionId)}
                  disabled={isBusy}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-ag-border bg-ag-panel hover:bg-rose-500/10 hover:border-rose-400 text-ag-textSecondary hover:text-rose-600 font-medium transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  title="放棄 Worktree 分支並移除，不影響主目錄"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>放棄 (Discard)</span>
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="flex flex-col rounded-2xl border border-ag-border bg-ag-panel shadow-soft p-3 focus-within:border-ag-primary focus-within:ring-2 focus-within:ring-ag-primaryLight transition-all duration-150"
          >
            <textarea
              ref={textareaRef}
              rows={3}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isBusy
                  ? 'Agent 正在推理或執行工具中...'
                  : '輸入指令、代碼重構要求或問題 (Enter 發送，Shift+Enter 換行)...'
              }
              disabled={isBusy}
              className="w-full resize-none bg-transparent p-2 text-sm text-ag-textPrimary placeholder-slate-400 outline-none disabled:opacity-40 font-sans leading-relaxed"
            />

            <div className="flex items-center justify-between pt-2 border-t border-ag-border/60 gap-3">
              <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1.5 text-[11px] text-ag-textMuted font-mono min-w-0">
                {/* Skill Dropdown Menu */}
                <div className="shrink-0">
                  <SkillDropdown
                    onSelectPrompt={handleSelectPrompt}
                    disabled={isBusy}
                  />
                </div>

                <span className="text-ag-border shrink-0">•</span>

                <button
                  type="button"
                  onClick={() => setAutoApprove(!autoApprove)}
                  className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg border text-[10.5px] font-medium transition-all cursor-pointer shrink-0 ${
                    autoApprove
                      ? 'border-ag-primary/40 bg-ag-primaryLight text-ag-primary shadow-soft font-semibold'
                      : 'border-ag-border bg-ag-sidebar/60 text-ag-textMuted hover:text-ag-textPrimary'
                  }`}
                  title="切換是否自動審批所有操作 (包含終端指令)"
                >
                  <Zap className={`h-3 w-3 ${autoApprove ? 'text-ag-primary fill-ag-primary/25' : 'text-ag-textMuted'}`} />
                  <span>{autoApprove ? '⚡ 全自動審批 (All Approve)' : '手動審批 (Ask on Action)'}</span>
                </button>

                <span className="text-ag-border shrink-0">•</span>

                <button
                  type="button"
                  onClick={() => setWorktreeIsolationEnabled(!worktreeIsolationEnabled)}
                  className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg border text-[10.5px] font-medium transition-all cursor-pointer shrink-0 ${
                    worktreeIsolationEnabled
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 shadow-soft font-semibold'
                      : 'border-ag-border bg-ag-sidebar/60 text-ag-textMuted hover:text-ag-textPrimary'
                  }`}
                  title="切換是否在獨立的 Git Worktree 隔離目錄中作業，完成後再合併回主工作目錄"
                >
                  <GitBranch className={`h-3 w-3 ${worktreeIsolationEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-ag-textMuted'}`} />
                  <span>{worktreeIsolationEnabled ? '🌿 Worktree 隔離' : '主目錄直作'}</span>
                </button>

                <span className="text-ag-border shrink-0">•</span>

                <button
                  type="button"
                  onClick={() => setSubagentsEnabled(!subagentsEnabled)}
                  className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg border text-[10.5px] font-medium transition-all cursor-pointer shrink-0 ${
                    subagentsEnabled
                      ? 'border-purple-500/50 bg-purple-500/15 text-purple-800 dark:text-purple-300 shadow-soft font-semibold'
                      : 'border-ag-border bg-ag-sidebar/60 text-ag-textMuted hover:text-ag-textPrimary'
                  }`}
                  title="切換是否啟用多子代理人 (Subagents) 並行調度與任務拆解"
                >
                  <Bot className={`h-3 w-3 ${subagentsEnabled ? 'text-purple-600 dark:text-purple-400' : 'text-ag-textMuted'}`} />
                  <span>{subagentsEnabled ? '🤖 Subagents 開啟' : '單一 Agent'}</span>
                </button>

                <span className="text-ag-border shrink-0">•</span>

                {/* Context 用量 (Context Usage) */}
                <div className="shrink-0">
                  <ContextUsageBadge
                    tokenUsage={tokenUsage}
                    messages={messages}
                    selectedProvider={selectedProvider}
                    selectedModel={selectedModel}
                    availableModels={availableModels}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2.5 shrink-0 ml-auto">
                {isBusy && (
                  <button
                    type="button"
                    onClick={cancelTask}
                    className="flex items-center space-x-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-all shadow-soft cursor-pointer"
                  >
                    <Square className="h-3 w-3 fill-rose-500 text-rose-500" />
                    <span>停止 (Stop)</span>
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isBusy || !inputPrompt.trim()}
                  className="flex items-center space-x-2 rounded-xl bg-ag-primary px-5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-soft transition-all duration-150 active:scale-98 cursor-pointer"
                >
                  <span>發送</span>
                  <CornerDownLeft className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
};
