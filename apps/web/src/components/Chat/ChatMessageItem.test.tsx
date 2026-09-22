import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessageItem } from './ChatMessageItem.js';
import type { ChatMessage } from '@harni/types';

describe('ChatMessageItem Component', () => {
  it('renders user message correctly', () => {
    const userMsg: ChatMessage = {
      id: 'msg_user_1',
      role: 'user',
      content: 'Please refactor this TypeScript code',
      timestamp: Date.now(),
    };

    render(<ChatMessageItem msg={userMsg} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Please refactor this TypeScript code')).toBeInTheDocument();

    // Check for copy button
    expect(screen.getByTitle('複製此回答內容')).toBeInTheDocument();
  });

  it('renders assistant message with markdown content', () => {
    const assistantMsg: ChatMessage = {
      id: 'msg_asst_1',
      role: 'assistant',
      content: 'Here is the **solution** for your code.',
      timestamp: Date.now(),
    };

    render(<ChatMessageItem msg={assistantMsg} />);
    expect(screen.getByText('Coding Agent')).toBeInTheDocument();
    expect(screen.getByText(/Here is the/)).toBeInTheDocument();
    expect(screen.getByText('solution')).toBeInTheDocument();
  });

  it('renders assistant thinking accordion when thinking is present', () => {
    const thinkingMsg: ChatMessage = {
      id: 'msg_asst_think',
      role: 'assistant',
      content: 'Done thinking.',
      thinking: 'Analyzing AST nodes and type definitions...',
      timestamp: Date.now(),
    };

    render(<ChatMessageItem msg={thinkingMsg} />);
    expect(screen.getByText(/AI 推理過程/)).toBeInTheDocument();
  });

  it('renders RateLimitCard when message has rateLimitInfo', () => {
    const rateLimitMsg: ChatMessage = {
      id: 'msg_asst_ratelimit_1',
      role: 'assistant',
      content: '### ⚠️ 觸發 API 頻率限制 (Rate Limit / HTTP 429)\n\n請稍候 25 秒再試。',
      rateLimitInfo: {
        isRateLimit: true,
        limitType: 'TPM',
        model: 'gemini-3.8-pro',
        retryAfter: '25s',
      },
      timestamp: Date.now(),
    };

    render(<ChatMessageItem msg={rateLimitMsg} />);
    expect(screen.getByTestId('rate-limit-card')).toBeInTheDocument();
    expect(screen.getByText('API 頻率配額限制 (Rate Limit)')).toBeInTheDocument();
    expect(screen.getByText('HTTP 429')).toBeInTheDocument();
    expect(screen.getByText('TPM 超標 (Tokens/min)')).toBeInTheDocument();
    expect(screen.getByText('模型：gemini-3.8-pro')).toBeInTheDocument();
    expect(screen.getByText('建議等待: 25s')).toBeInTheDocument();
    expect(screen.getByText(/請稍候 25 秒再試/)).toBeInTheDocument();
  });

  it('renders RateLimitCard automatically when assistant content mentions rate limit 429 and RPM', () => {
    const autoDetectMsg: ChatMessage = {
      id: 'msg_asst_ratelimit_2',
      role: 'assistant',
      content: '觸發 API 頻率限制 (Rate Limit / HTTP 429) RPM 超標，請切換至 gemini-3.8-flash。',
      timestamp: Date.now(),
    };

    render(<ChatMessageItem msg={autoDetectMsg} />);
    expect(screen.getByTestId('rate-limit-card')).toBeInTheDocument();
    expect(screen.getByText('HTTP 429')).toBeInTheDocument();
    expect(screen.getByText('RPM 超標 (Requests/min)')).toBeInTheDocument();
  });
});
