import React, { useEffect, useRef, useState, memo } from 'react';
import { Brain, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';

interface ThinkingAccordionProps {
  thinking: string;
  isStreaming?: boolean;
}

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = memo(({
  thinking,
  isStreaming = false,
}) => {
  const [isOpen, setIsOpen] = useState(isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Auto-scroll to bottom as new thinking text arrives during streaming (rAF throttled to avoid layout thrashing)
  useEffect(() => {
    if (isStreaming && isOpen && scrollRef.current) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
        rafRef.current = null;
      });
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [thinking, isStreaming, isOpen]);

  if (!thinking) return null;

  return (
    <div className="my-2.5 rounded-2xl border border-ag-primary/35 bg-ag-primaryLight overflow-hidden text-xs shadow-soft transition-all">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-ag-textPrimary hover:bg-ag-primary/10 transition-colors cursor-pointer"
      >
        <div className="flex items-center space-x-2.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-ag-panel border border-ag-primary/25 shadow-xs">
            <Brain
              className={`h-3.5 w-3.5 text-ag-primary ${
                isStreaming ? 'animate-pulse' : ''
              }`}
            />
          </div>
          <span className="font-semibold text-ag-textPrimary text-[12px] tracking-wide">
            {isStreaming ? 'AI 思考與推理中 (Reasoning)...' : 'AI 推理過程 (Reasoning Process)'}
          </span>
          {isStreaming && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ag-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-ag-primary" />
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-ag-primary" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-ag-primary" />
        )}
      </button>

      {isOpen && (
        <div
          ref={scrollRef}
          style={{ contain: 'content', willChange: 'scroll-position' }}
          className="max-h-[33.33vh] overflow-y-auto overflow-x-hidden border-t border-ag-primary/20 px-4 py-3 text-ag-textSecondary font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap bg-ag-panel select-text"
        >
          {thinking}
        </div>
      )}
    </div>
  );
});

ThinkingAccordion.displayName = 'ThinkingAccordion';
