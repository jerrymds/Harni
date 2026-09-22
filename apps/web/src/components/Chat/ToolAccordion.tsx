import React, { useState, memo } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  FolderTree,
  HelpCircle,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { ChatMessage, ToolResult } from '@harni/types';

interface ToolAccordionProps {
  msg: ChatMessage;
  defaultOpen?: boolean;
}

export const ToolAccordion: React.FC<ToolAccordionProps> = memo(({
  msg,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isCopied, setIsCopied] = useState(false);

  const toolResult = msg.toolResult;
  const isError = toolResult?.isError;
  const outputStr =
    typeof toolResult?.output === 'string'
      ? toolResult.output
      : JSON.stringify(toolResult?.output ?? '', null, 2);

  const summary =
    toolResult?.summary ||
    (msg.content && msg.content.length > 0
      ? msg.content.slice(0, 45)
      : 'Tool Execution Result');

  // Determine friendly tool name & icon
  const getToolInfo = () => {
    const summaryLower = summary.toLowerCase();
    if (summaryLower.includes('ask_question') || summaryLower.includes('使用者已回答') || summaryLower.includes('提問')) {
      return { label: 'ask_question (提問回覆)', icon: <HelpCircle className="h-3.5 w-3.5 text-ag-primary" /> };
    }
    if (summaryLower.includes('write_to_file') || summaryLower.includes('created') || summaryLower.includes('write')) {
      return { label: 'write_to_file', icon: <FileCode className="h-3.5 w-3.5 text-ag-blue" /> };
    }
    if (summaryLower.includes('replace_file_content') || summaryLower.includes('modified') || summaryLower.includes('replace')) {
      return { label: 'replace_file_content', icon: <FileCode className="h-3.5 w-3.5 text-amber-600" /> };
    }
    if (summaryLower.includes('use_skill') || summaryLower.includes('skill')) {
      return { label: 'use_skill', icon: <Sparkles className="h-3.5 w-3.5 text-ag-purple" /> };
    }
    if (summaryLower.includes('execute_command') || summaryLower.includes('executed') || summaryLower.includes('command')) {
      return { label: 'execute_command', icon: <Terminal className="h-3.5 w-3.5 text-emerald-600" /> };
    }
    if (summaryLower.includes('search_files') || summaryLower.includes('found')) {
      return { label: 'search_files', icon: <Search className="h-3.5 w-3.5 text-ag-purple" /> };
    }
    if (summaryLower.includes('list_files') || summaryLower.includes('list')) {
      return { label: 'list_files', icon: <FolderTree className="h-3.5 w-3.5 text-ag-blue" /> };
    }
    return { label: 'tool_execution', icon: <Wrench className="h-3.5 w-3.5 text-ag-blue" /> };
  };

  const toolInfo = getToolInfo();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(outputStr);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <div className="my-2 rounded-2xl border border-ag-border bg-ag-panel overflow-hidden text-xs font-mono shadow-soft transition-all">
      {/* Clickable Accordion Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left bg-ag-panel hover:bg-ag-sidebar/50 transition-colors select-none cursor-pointer"
      >
        <div className="flex items-center space-x-2.5 min-w-0 pr-2">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ag-sidebar border border-ag-border">
            {toolInfo.icon}
          </div>
          <span className="font-medium text-ag-textPrimary truncate max-w-[280px]">
            {summary}
          </span>
        </div>

        <div className="flex items-center space-x-2.5 shrink-0">
          {isError ? (
            <span className="flex items-center space-x-1 text-rose-700 text-[10.5px] font-medium bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
              <AlertCircle className="h-3 w-3 text-rose-500" />
              <span>Failed</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1 text-emerald-800 text-[10.5px] font-medium bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
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
        <div className="border-t border-ag-border p-3.5 bg-ag-void/80 relative group">
          <div className="absolute right-2.5 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1 rounded-md border border-ag-border bg-ag-panel px-2 py-1 text-[10px] text-ag-textSecondary hover:text-ag-textPrimary hover:bg-ag-sidebar shadow-soft cursor-pointer transition-colors"
              title="複製輸出內容"
            >
              {isCopied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-600 font-medium">已複製</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 text-ag-textMuted" />
                  <span>複製</span>
                </>
              )}
            </button>
          </div>

          <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap text-ag-textPrimary text-[11.5px] leading-relaxed select-text font-mono pr-8 custom-scrollbar">
            {outputStr || '(無輸出內容)'}
          </pre>
        </div>
      )}
    </div>
  );
});

ToolAccordion.displayName = 'ToolAccordion';
