import React, { useState, useEffect, useRef, memo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Terminal,
} from 'lucide-react';
import type { ChatMessage } from '@harni/types';
import { ToolAccordion } from './ToolAccordion.js';
import { ThinkingAccordion } from './ThinkingAccordion.js';
import { ChatMessageItem } from './ChatMessageItem.js';

export interface CommandExecutionAccordionProps {
  intermediateCommands: ChatMessage[];
  isFinished: boolean;
}

export const CommandExecutionAccordion: React.FC<CommandExecutionAccordionProps> = memo(({
  intermediateCommands,
  isFinished,
}) => {
  // When finished, default to collapsed (false); when running, default to expanded (true)
  const [isOpen, setIsOpen] = useState(!isFinished);
  const prevFinishedRef = useRef(isFinished);

  useEffect(() => {
    // When generation completes, automatically collapse the intermediate commands accordion
    if (!prevFinishedRef.current && isFinished) {
      setIsOpen(false);
    }
    prevFinishedRef.current = isFinished;
  }, [isFinished]);

  if (!intermediateCommands || intermediateCommands.length === 0) {
    return null;
  }

  const toolMessages = intermediateCommands.filter(
    (m) => m.role === 'tool' || Boolean(m.toolResult),
  );
  const commandCount = toolMessages.length > 0 ? toolMessages.length : intermediateCommands.length;
  const hasError = intermediateCommands.some(
    (m) => m.toolResult?.isError || (m.role === 'tool' && m.content?.toLowerCase().includes('fail')),
  );

  return (
    <div
      data-testid="command-execution-accordion"
      className="my-2.5 rounded-2xl border border-ag-border bg-ag-panel overflow-hidden text-xs font-mono shadow-soft transition-all"
    >
      {/* Clickable Header Bar */}
      <button
        type="button"
        data-testid="command-accordion-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left bg-ag-panel hover:bg-ag-sidebar/50 transition-colors select-none cursor-pointer"
        aria-expanded={isOpen}
      >
        <div className="flex items-center space-x-2.5 min-w-0 pr-2">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ag-sidebar border border-ag-border text-emerald-600 dark:text-emerald-400">
            <Terminal className="h-3.5 w-3.5" />
          </div>
          <span className="font-medium text-ag-textPrimary truncate">
            指令與思考流程 (已執行 {commandCount} 個指令)
          </span>
        </div>

        <div className="flex items-center space-x-2.5 shrink-0">
          {!isFinished ? (
            <span
              data-testid="badge-running"
              className="flex items-center space-x-1 text-ag-primary text-[10.5px] font-medium bg-ag-primaryLight border border-ag-primary/25 rounded-full px-2 py-0.5 animate-pulse"
            >
              <Loader2 className="h-3 w-3 animate-spin text-ag-primary" />
              <span>執行中...</span>
            </span>
          ) : hasError ? (
            <span
              data-testid="badge-failed"
              className="flex items-center space-x-1 text-rose-700 dark:text-rose-400 text-[10.5px] font-medium bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-full px-2 py-0.5"
            >
              <AlertCircle className="h-3 w-3 text-rose-500" />
              <span>Failed</span>
            </span>
          ) : (
            <span
              data-testid="badge-executed"
              className="flex items-center space-x-1 text-emerald-800 dark:text-emerald-300 text-[10.5px] font-medium bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-full px-2 py-0.5"
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              <span>Executed</span>
            </span>
          )}

          <div className="flex items-center space-x-1 text-ag-textMuted hover:text-ag-textPrimary">
            <span className="text-[10px] hidden sm:inline">
              {isOpen ? '收合' : '展開'}
            </span>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-ag-textMuted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-ag-textMuted" />
            )}
          </div>
        </div>
      </button>

      {/* Collapsible Content Area */}
      {isOpen && (
        <div
          data-testid="command-accordion-content"
          className="border-t border-ag-border p-3 space-y-2 bg-ag-void/40"
        >
          {intermediateCommands.map((msg) => {
            if (msg.role === 'tool') {
              return <ToolAccordion key={msg.id} msg={msg} defaultOpen={false} />;
            }
            if (msg.role === 'assistant') {
              return (
                <div key={msg.id} className="space-y-1.5">
                  {msg.thinking && (
                    <ThinkingAccordion thinking={msg.thinking} />
                  )}
                  {Boolean(msg.content && msg.content.trim().length > 0) && (
                    <ChatMessageItem msg={msg} />
                  )}
                </div>
              );
            }
            return <ChatMessageItem key={msg.id} msg={msg} />;
          })}
        </div>
      )}
    </div>
  );
});

CommandExecutionAccordion.displayName = 'CommandExecutionAccordion';
