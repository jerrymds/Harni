import React, { useState, memo } from 'react';
import { Check, CheckSquare, HelpCircle, MessageSquare, Send, Square } from 'lucide-react';
import type { QuestionPrompt } from '@harni/types';

interface QuestionCardProps {
  prompt: QuestionPrompt;
  onSubmit: (toolCallId: string, answers: string[], customInput?: string) => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = memo(({
  prompt,
  onSubmit,
}) => {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const isMulti = Boolean(prompt.isMultiSelect);
  const allowCustom = prompt.allowCustomInput !== false;

  const toggleOption = (option: string) => {
    if (isMulti) {
      setSelectedOptions((prev) =>
        prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
      );
    } else {
      setSelectedOptions((prev) => (prev.includes(option) ? [] : [option]));
    }
  };

  const handleSubmit = () => {
    onSubmit(
      prompt.toolCallId,
      selectedOptions,
      customInput.trim() ? customInput.trim() : undefined,
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasContent = selectedOptions.length > 0 || customInput.trim().length > 0;

  return (
    <div className="my-3.5 rounded-2xl border border-ag-primary/30 bg-ag-panel p-4 shadow-soft animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center space-x-2 text-xs font-semibold text-ag-primary mb-2">
        <HelpCircle className="h-4 w-4 text-ag-primary" />
        <span>Agent 提問與釐清：需要您的確認</span>
        {isMulti && (
          <span className="ml-2 rounded-full bg-ag-primary/10 px-2 py-0.5 text-[10.5px] font-normal text-ag-primary">
            可複選
          </span>
        )}
      </div>

      {/* Question Text */}
      <div className="rounded-xl bg-ag-void/60 p-3.5 text-xs text-ag-textPrimary border border-ag-border my-2 leading-relaxed font-sans shadow-xs whitespace-pre-wrap">
        {prompt.question}
      </div>

      {/* Options List */}
      {prompt.options && prompt.options.length > 0 && (
        <div className="my-3 space-y-1.5">
          <div className="text-[11px] font-medium text-ag-textSecondary mb-1">
            請選擇選項：
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {prompt.options.map((option, idx) => {
              const isSelected = selectedOptions.includes(option);
              return (
                <button
                  key={`${option}-${idx}`}
                  type="button"
                  onClick={() => toggleOption(option)}
                  className={`flex items-center space-x-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-all cursor-pointer ${
                    isSelected
                      ? 'border-ag-primary bg-ag-primaryLight text-ag-primary font-semibold shadow-xs'
                      : 'border-ag-border bg-ag-void/30 text-ag-textPrimary hover:bg-ag-sidebar hover:border-ag-border/80'
                  }`}
                >
                  {isMulti ? (
                    isSelected ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-ag-primary" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0 text-ag-textMuted" />
                    )
                  ) : (
                    <div
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'border-ag-primary bg-ag-primary'
                          : 'border-ag-border bg-transparent'
                      }`}
                    >
                      {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                  )}
                  <span className="flex-1 break-words">{option}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom Input */}
      {allowCustom && (
        <div className="my-2.5">
          <div className="flex items-center space-x-1.5 text-[11px] font-medium text-ag-textSecondary mb-1">
            <MessageSquare className="h-3 w-3 text-ag-textMuted" />
            <span>補充說明或自訂回答（選填）：</span>
          </div>
          <input
            type="text"
            placeholder="請輸入其他補充或特定要求 (按 Enter 送出)..."
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded-xl border border-ag-border bg-ag-void/60 px-3 py-2 text-xs text-ag-textPrimary outline-none focus:border-ag-primary placeholder-ag-textMuted shadow-xs transition-colors"
          />
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-end space-x-2.5 mt-3.5">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasContent}
          className={`flex items-center space-x-1.5 rounded-xl px-4 py-2 text-xs font-semibold shadow-soft transition-all cursor-pointer ${
            hasContent
              ? 'bg-ag-primary text-white hover:bg-ag-primary/90'
              : 'bg-ag-border/50 text-ag-textMuted cursor-not-allowed'
          }`}
        >
          {hasContent ? (
            <>
              <Send className="h-3.5 w-3.5" />
              <span>送出回答</span>
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>請選擇或填寫後送出</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});

QuestionCard.displayName = 'QuestionCard';
