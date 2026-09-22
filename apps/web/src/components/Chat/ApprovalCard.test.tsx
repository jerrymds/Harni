import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalCard } from './ApprovalCard.js';
import { useAgentStore } from '../../store/useAgentStore.js';
import type { ToolCallRequest } from '@harni/types';

describe('ApprovalCard Component', () => {
  const mockToolCall: ToolCallRequest = {
    id: 'call_test_123',
    name: 'execute_command',
    arguments: { command: 'pnpm test' },
    requiresApproval: true,
  };

  beforeEach(() => {
    useAgentStore.setState({ autoApprove: false });
  });

  it('renders confirmation request with command name and command content', () => {
    const onApprove = vi.fn();
    render(<ApprovalCard toolCall={mockToolCall} onApprove={onApprove} />);

    expect(screen.getByText(/執行確認請求：execute_command/)).toBeInTheDocument();
    expect(screen.getByText('pnpm test')).toBeInTheDocument();
    expect(screen.getByText('允許本次執行')).toBeInTheDocument();
  });

  it('calls onApprove with true when clicking "允許本次執行"', () => {
    const onApprove = vi.fn();
    render(<ApprovalCard toolCall={mockToolCall} onApprove={onApprove} />);

    const allowBtn = screen.getByText('允許本次執行');
    fireEvent.click(allowBtn);

    expect(onApprove).toHaveBeenCalledWith('call_test_123', true);
  });

  it('shows feedback input and rejects when clicking "拒絕並給予反饋"', () => {
    const onApprove = vi.fn();
    render(<ApprovalCard toolCall={mockToolCall} onApprove={onApprove} />);

    const rejectInitBtn = screen.getByText('拒絕並給予反饋');
    fireEvent.click(rejectInitBtn);

    const input = screen.getByPlaceholderText('拒絕原因或修改指示...');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Command is dangerous' } });

    const confirmRejectBtn = screen.getByText('確認拒絕');
    fireEvent.click(confirmRejectBtn);

    expect(onApprove).toHaveBeenCalledWith('call_test_123', false, 'Command is dangerous');
  });

  it('enables autoApprove and approves when clicking "⚡ 全部允許 (All Approve)"', () => {
    const onApprove = vi.fn();
    render(<ApprovalCard toolCall={mockToolCall} onApprove={onApprove} />);

    const allApproveBtn = screen.getByText(/全部允許/);
    fireEvent.click(allApproveBtn);

    expect(useAgentStore.getState().autoApprove).toBe(true);
    expect(onApprove).toHaveBeenCalledWith('call_test_123', true);
  });
});
