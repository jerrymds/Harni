import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AntigravityQuotaPool } from './AntigravityQuotaPool.js';
import { useAgentStore } from '../../../store/useAgentStore.js';
import type { ModelQuotaResponse } from '@harni/types';

describe('AntigravityQuotaPool Component', () => {
  const mockQuotaData: ModelQuotaResponse = {
    provider: 'antigravity',
    updatedAt: Date.now(),
    pools: [
      {
        id: 'gemini-models',
        name: 'Gemini 官方共享額度池 (Gemini Models)',
        description: 'Gemini 3.8 / 3.7 / 2.5 系列模型共享此運算配額，依任務複雜度折算',
        isShared: true,
        items: [
          {
            name: '5 小時滾動限制 (Five-Hour Limit)',
            limitType: 'five_hour',
            remainingPercent: 95,
            resetTimeFormatted: '10/23 14:29 (約 2 小時 40 分後)',
          },
          {
            name: '每週累計上限 (Weekly Limit)',
            limitType: 'weekly',
            remainingPercent: 71,
            resetTimeFormatted: '10/24 09:15 (約 1 天後)',
          },
        ],
      },
      {
        id: 'claude-gpt-models',
        name: 'Claude & GPT 第三方模型額度池',
        description: 'Anthropic Claude 與 OpenAI 模型外部配額',
        isShared: false,
        items: [
          {
            name: '5 小時滾動限制 (Five-Hour Limit)',
            limitType: 'five_hour',
            remainingPercent: 100,
            resetTimeFormatted: '正常動態滑動重置',
          },
        ],
      },
      {
        id: 'gemini-4-argon',
        name: 'Gemini 4 Argon 專屬配額',
        description: '次世代旗艦推理模型獨立配額',
        isShared: false,
        items: [
          {
            name: '每週限制',
            limitType: 'weekly',
            remainingPercent: 46,
            resetTimeFormatted: '10/24 09:37 (約 1 天後)',
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    useAgentStore.setState({
      quotaInfo: mockQuotaData,
      isLoadingQuota: false,
    });
  });

  it('renders model quota pool header and badges', () => {
    render(<AntigravityQuotaPool />);

    expect(screen.getByText('模型額度池 (Model Quota Pool)')).toBeInTheDocument();
    expect(screen.getByText('Antigravity 官方同步')).toBeInTheDocument();
    expect(screen.getByText(/額度充足/)).toBeInTheDocument();
  });

  it('displays primary Gemini shared pool items with percentages and reset times', () => {
    render(<AntigravityQuotaPool />);

    expect(screen.getByText('Gemini 官方共享額度池 (Gemini Models)')).toBeInTheDocument();
    expect(screen.getByText('⚡ Flash & Pro 共享運算')).toBeInTheDocument();
    expect(screen.getByText('95% 剩餘')).toBeInTheDocument();
    expect(screen.getByText('71% 剩餘')).toBeInTheDocument();
    expect(screen.getByText(/重置時間：10\/23 14:29/)).toBeInTheDocument();
  });

  it('renders secondary pools for Claude & GPT and Gemini 4 Argon', () => {
    render(<AntigravityQuotaPool />);

    expect(screen.getByText('Claude & GPT 第三方模型額度池')).toBeInTheDocument();
    expect(screen.getByText('Gemini 4 Argon 專屬配額')).toBeInTheDocument();
    expect(screen.getByText('46% 剩餘')).toBeInTheDocument();
  });

  it('triggers refresh when clicking refresh button', () => {
    const fetchQuotaSpy = vi.fn().mockResolvedValue(mockQuotaData);
    useAgentStore.setState({
      fetchModelQuota: fetchQuotaSpy,
    });

    render(<AntigravityQuotaPool />);

    const refreshBtn = screen.getByText('重新整理');
    fireEvent.click(refreshBtn);

    expect(fetchQuotaSpy).toHaveBeenCalledWith('antigravity', true);
  });

  it('renders warning notice when error exists in quota response', () => {
    useAgentStore.setState({
      quotaInfo: {
        ...mockQuotaData,
        error: '無法連線至 CLI 服務，顯示快取數據',
      },
    });

    render(<AntigravityQuotaPool />);

    expect(screen.getByText('無法連線至 CLI 服務，顯示快取數據')).toBeInTheDocument();
  });
});
