import React, { useState, memo } from 'react';
import { Check, ShieldAlert, Terminal, X, Zap } from 'lucide-react';
import type { ToolCallRequest } from '@harni/types';
import { useAgentStore } from '../../store/useAgentStore.js';

interface ApprovalCardProps {
  toolCall: ToolCallRequest;
  onApprove: (toolCallId: string, approved: boolean, feedback?: string) => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = memo(({
  toolCall,
  onApprove,
}) => {
  const [feedback, setFeedback] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const setAutoApprove = useAgentStore((s) => s.setAutoApprove);

  const isCommand = toolCall.name === 'execute_command';

  const handleAllApprove = () => {
    setAutoApprove(true);
    onApprove(toolCall.id, true);
  };

  return (
    <div className="my-3.5 rounded-2xl border border-amber-300 bg-amber-50/60 p-4 shadow-soft animate-in fade-in duration-200">
      <div className="flex items-center space-x-2 text-xs font-semibold text-amber-900 mb-2">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <span>執行確認請求：{toolCall.name}</span>
      </div>

      <div className="rounded-xl bg-white p-3 font-mono text-xs text-slate-800 border border-ag-border my-2.5 overflow-x-auto shadow-soft">
        {isCommand ? (
          <div className="flex items-center space-x-2 text-emerald-700">
            <Terminal className="h-3.5 w-3.5 shrink-0 text-ag-blue" />
            <span className="font-semibold">{(toolCall.arguments as any).command}</span>
          </div>
        ) : (
          <pre className="text-[11px] whitespace-pre-wrap text-slate-700">
            {JSON.stringify(toolCall.arguments, null, 2)}
          </pre>
        )}
      </div>

      {showFeedbackInput && (
        <div className="my-2.5">
          <input
            type="text"
            placeholder="拒絕原因或修改指示..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="w-full rounded-xl border border-ag-border bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-ag-blue font-mono placeholder-slate-400 shadow-soft"
          />
        </div>
      )}

      <div className="flex items-center justify-end space-x-2.5 mt-3.5">
        {!showFeedbackInput ? (
          <button
            onClick={() => setShowFeedbackInput(true)}
            className="rounded-xl border border-ag-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-ag-sidebar hover:text-slate-900 transition-all shadow-soft cursor-pointer"
          >
            拒絕並給予反饋
          </button>
        ) : (
          <button
            onClick={() => onApprove(toolCall.id, false, feedback)}
            className="flex items-center space-x-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 transition-all shadow-soft cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            <span>確認拒絕</span>
          </button>
        )}

        <button
          onClick={handleAllApprove}
          className="flex items-center space-x-1.5 rounded-xl border border-amber-300 bg-amber-100/80 px-3.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200 transition-all shadow-soft cursor-pointer"
          title="開啟自動審批模式，此後所有操作不再暫停等待"
        >
          <Zap className="h-3.5 w-3.5 text-amber-600" />
          <span>⚡ 全部允許 (All Approve)</span>
        </button>

        <button
          onClick={() => onApprove(toolCall.id, true)}
          className="flex items-center space-x-1.5 rounded-xl bg-ag-blue px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-400 shadow-soft transition-all cursor-pointer"
        >
          <Check className="h-3.5 w-3.5" />
          <span>允許本次執行</span>
        </button>
      </div>
    </div>
  );
});

ApprovalCard.displayName = 'ApprovalCard';
