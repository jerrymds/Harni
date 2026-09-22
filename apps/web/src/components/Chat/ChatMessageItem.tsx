import React, { useState, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Bot,
  Check,
  Clock,
  Code2,
  Copy,
  User,
} from 'lucide-react';
import type { ChatMessage } from '@harni/types';
import { ThinkingAccordion } from './ThinkingAccordion.js';
import { ToolAccordion } from './ToolAccordion.js';

export const MarkdownCode: React.FC<any> = memo(({ className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const [copied, setCopied] = useState(false);
  const codeContent =
    typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
        : String(children ?? '');

  const isBlock = Boolean(match || codeContent.includes('\n'));

  if (isBlock) {
    const lang = match ? match[1] : 'code';
    return (
      <div className="my-3 rounded-2xl overflow-hidden border border-ag-border bg-ag-void shadow-soft">
        <div className="flex items-center justify-between px-3.5 py-2 bg-ag-sidebar border-b border-ag-border text-xs font-mono select-none">
          <div className="flex items-center space-x-2 text-ag-primary">
            <Code2 className="h-3.5 w-3.5 text-ag-primary" />
            <span className="font-semibold text-[11px] uppercase tracking-wider">{lang}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(codeContent.replace(/\n$/, ''));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-[10.5px] font-sans text-ag-textSecondary hover:text-ag-textPrimary hover:bg-ag-panel transition-all cursor-pointer border border-transparent hover:border-ag-border shadow-xs"
            title="複製程式碼"
          >
            {copied ? (
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
        <pre className="p-4 overflow-x-auto text-[12.5px] font-mono text-ag-textPrimary leading-relaxed bg-ag-void/60 m-0 border-none">
          <code>{children}</code>
        </pre>
      </div>
    );
  }

  return (
    <code
      className="rounded-md bg-ag-primaryLight border border-ag-primary/25 px-1.5 py-0.5 text-[11.5px] font-mono text-ag-primary font-semibold inline-block my-0.5 align-baseline select-text"
      {...props}
    >
      {children}
    </code>
  );
});

export const CopyMessageButton: React.FC<{ content: string }> = memo(({ content }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center space-x-1 text-[10.5px] text-ag-textMuted hover:text-ag-textPrimary transition-colors cursor-pointer px-1.5 py-0.5 rounded-md hover:bg-ag-sidebar/60 border border-transparent hover:border-ag-border"
      title="複製此回答內容"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-600" />
          <span className="text-emerald-600 font-medium">已複製</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>複製</span>
        </>
      )}
    </button>
  );
});

const markdownComponents = {
  pre: ({ children }: any) => <>{children}</>,
  code: MarkdownCode,
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-3 rounded-xl border border-ag-border shadow-xs select-text">
      <table className="min-w-full text-xs divide-y divide-ag-border select-text">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => (
    <thead className="bg-ag-sidebar font-semibold text-ag-textPrimary select-text">{children}</thead>
  ),
  th: ({ children }: any) => (
    <th className="px-3 py-2 text-left border-r last:border-r-0 border-ag-border select-text">{children}</th>
  ),
  td: ({ children }: any) => (
    <td className="px-3 py-2 border-t border-r last:border-r-0 border-ag-border text-ag-textPrimary select-text">{children}</td>
  ),
  a: ({ href, children }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ag-primary hover:underline font-medium select-text"
    >
      {children}
    </a>
  ),
  ul: ({ children }: any) => (
    <ul className="list-disc pl-5 my-2 space-y-1 text-ag-textPrimary select-text">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal pl-5 my-2 space-y-1 text-ag-textPrimary select-text">{children}</ol>
  ),
  li: ({ children }: any) => <li className="leading-relaxed select-text">{children}</li>,
  p: ({ children }: any) => (
    <p className="my-2 leading-relaxed text-ag-textPrimary select-text">{children}</p>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 border-ag-primary bg-ag-primaryLight px-4 py-2.5 my-3 rounded-r-xl text-ag-textSecondary italic select-text">
      {children}
    </blockquote>
  ),
};

export interface ChatMessageItemProps {
  msg: ChatMessage;
}

export const RateLimitCard: React.FC<{ msg: ChatMessage }> = memo(({ msg }) => {
  const info = msg.rateLimitInfo;
  const content = msg.content || '';
  const limitType =
    info?.limitType ||
    (content.includes('TPM')
      ? 'TPM'
      : content.includes('RPM')
        ? 'RPM'
        : content.includes('RPD')
          ? 'RPD'
          : content.includes('5 小時') || content.includes('5 hours')
            ? 'QUOTA'
            : 'RATE_LIMIT');

  const retryAfter = info?.retryAfter || (content.match(/重試.*?([0-9a-zA-Z一-龥]+)/)?.[1]);

  const limitBadgeLabel =
    limitType === 'TPM'
      ? 'TPM 超標 (Tokens/min)'
      : limitType === 'RPM'
        ? 'RPM 超標 (Requests/min)'
        : limitType === 'RPD'
          ? 'RPD 每日上限用罄'
          : limitType === 'QUOTA'
            ? '配額已耗盡'
            : '頻率配額限制';

  return (
    <div
      data-testid="rate-limit-card"
      className="w-full rounded-2xl rounded-tl-xs border border-amber-500/40 bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent p-5 text-ag-textPrimary shadow-soft leading-relaxed font-sans text-sm select-text"
    >
      {/* Rate Limit Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 mb-3.5 border-b border-amber-500/20">
        <div className="flex items-center space-x-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold text-xs text-amber-800 dark:text-amber-300">
              API 頻率配額限制 (Rate Limit)
            </div>
            <div className="text-[11px] text-ag-textMuted">
              {info?.model ? `模型：${info.model}` : 'Google Gemini 模型服務'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-mono font-medium bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/25">
            HTTP 429
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/25">
            {limitBadgeLabel}
          </span>
          {retryAfter && (
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10.5px] font-mono font-medium bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/25">
              <Clock className="h-3 w-3" />
              <span>建議等待: {retryAfter}</span>
            </span>
          )}
        </div>
      </div>

      {/* Markdown Body */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {msg.content}
      </ReactMarkdown>
    </div>
  );
});

RateLimitCard.displayName = 'RateLimitCard';

export const ChatMessageItem: React.FC<ChatMessageItemProps> = memo(({ msg }) => {
  const isRateLimit = Boolean(
    msg.rateLimitInfo?.isRateLimit ||
      msg.content?.includes('觸發 API 頻率限制') ||
      msg.content?.includes('Rate Limit / HTTP 429') ||
      (msg.content?.includes('429') &&
        (msg.content?.includes('TPM') ||
          msg.content?.includes('RPM') ||
          msg.content?.includes('quota') ||
          msg.content?.includes('Quota') ||
          msg.content?.includes('RESOURCE_EXHAUSTED'))),
  );

  return (
    <div className="space-y-2">
      {/* User Prompt */}
      {msg.role === 'user' && msg.content && (
        <div className="flex flex-col items-end group">
          <div className="flex items-center space-x-2 text-[11px] text-ag-textMuted mb-1 font-mono select-none">
            <div className="flex items-center space-x-1.5">
              <User className="h-3 w-3 text-ag-primary" />
              <span>You</span>
            </div>
            <CopyMessageButton content={msg.content} />
          </div>
          <div className="rounded-2xl rounded-tr-xs bg-ag-primary px-5 py-3 text-sm text-white shadow-soft max-w-[85%] whitespace-pre-wrap leading-relaxed select-text">
            {msg.content}
          </div>
        </div>
      )}

      {/* Assistant Response & Thoughts */}
      {msg.role === 'assistant' && (
        <div className="flex flex-col items-start w-full group">
          <div className="flex items-center justify-between w-full mb-1 select-none">
            <div className="flex items-center space-x-1.5 text-[11px] text-ag-primary font-mono font-semibold">
              <Bot className="h-3.5 w-3.5 text-ag-primary" />
              <span>Coding Agent</span>
            </div>
            {Boolean(msg.content && msg.content.trim().length > 0) && (
              <CopyMessageButton content={msg.content} />
            )}
          </div>

          {msg.thinking && (
            <div className="w-full mb-2">
              <ThinkingAccordion thinking={msg.thinking} />
            </div>
          )}

          {Boolean(msg.content && msg.content.trim().length > 0) &&
            (isRateLimit ? (
              <RateLimitCard msg={msg} />
            ) : (
              <div className="w-full rounded-2xl rounded-tl-xs bg-ag-panel p-5 text-ag-textPrimary border border-ag-border shadow-soft leading-relaxed font-sans text-sm select-text">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            ))}
        </div>
      )}

      {/* Tool Execution Result */}
      {msg.role === 'tool' && <ToolAccordion msg={msg} defaultOpen={false} />}
    </div>
  );
});

ChatMessageItem.displayName = 'ChatMessageItem';
