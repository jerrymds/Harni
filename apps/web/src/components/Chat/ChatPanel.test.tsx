import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatPanel } from './ChatPanel.js';
import { useAgentStore } from '../../store/useAgentStore.js';

describe('ChatPanel Component - Image Paste and File Upload', () => {
  beforeEach(() => {
    useAgentStore.setState({
      currentSessionId: 'session_test',
      messages: [],
      status: 'idle',
      selectedMode: 'code',
      selectedProvider: 'cline',
      selectedModel: 'test-model',
      availableModels: { cline: [{ id: 'test-model', name: 'Test Model' }] },
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      autoApprove: false,
      checkpoints: [],
      branches: [],
      currentBranch: 'main',
      isLoadingBranches: false,
      isSwitchingBranch: false,
      workspaceInfo: { rootPath: '/test', totalFiles: 5, isGitRepo: true, branch: 'main' },
      activeWorktrees: {},
      isRevertingCheckpoint: false,
      worktreeIsolationEnabled: false,
      subagentsEnabled: true,
      strictOrchestration: false,
      contextWindow: 128000,
      modelContextWindows: {},
    });
  });

  it('renders "+" upload button below textarea', () => {
    render(<ChatPanel />);
    const uploadBtn = screen.getByRole('button', { name: '上傳檔案' });
    expect(uploadBtn).toBeInTheDocument();
    expect(uploadBtn).toHaveAttribute('title', expect.stringContaining('上傳檔案或圖片'));
  });

  it('triggers hidden file input when "+" upload button is clicked', () => {
    render(<ChatPanel />);
    const fileInput = screen.getByTestId('chat-file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    const uploadBtn = screen.getByRole('button', { name: '上傳檔案' });
    fireEvent.click(uploadBtn);

    expect(clickSpy).toHaveBeenCalled();
  });

  it('adds attached file to preview when user selects a file', async () => {
    render(<ChatPanel />);
    const fileInput = screen.getByTestId('chat-file-input') as HTMLInputElement;

    const file = new File(['hello world content'], 'sample.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('sample.txt')).toBeInTheDocument();
    });

    // Check remove button works
    const removeBtn = screen.getByTitle('移除附件');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);

    expect(screen.queryByText('sample.txt')).not.toBeInTheDocument();
  });

  it('handles pasting image data from clipboard', async () => {
    render(<ChatPanel />);
    const textarea = screen.getByPlaceholderText(/輸入指令、代碼重構要求或問題/);

    const imageFile = new File(['fake-image-bytes'], 'screenshot.png', { type: 'image/png' });
    const clipboardItem = {
      type: 'image/png',
      getAsFile: () => imageFile,
    };

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [clipboardItem],
      },
    });

    await waitFor(() => {
      expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    });
  });

  it('allows sending when there are attachments even if input text is empty', async () => {
    const sendPromptSpy = vi.fn();
    useAgentStore.setState({
      sendPrompt: sendPromptSpy,
    });

    render(<ChatPanel />);
    const fileInput = screen.getByTestId('chat-file-input') as HTMLInputElement;
    const file = new File(['code text'], 'test.ts', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('test.ts')).toBeInTheDocument();
    });

    const sendBtn = screen.getByRole('button', { name: '發送' });
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);

    expect(sendPromptSpy).toHaveBeenCalledWith(
      '',
      undefined,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'test.ts',
        }),
      ])
    );

    // After submit, attachment preview should be cleared
    expect(screen.queryByText('test.ts')).not.toBeInTheDocument();
  });

  it('renders branch dropdown trigger to the left of the send button', () => {
    useAgentStore.setState({
      currentBranch: 'main',
      branches: [{ name: 'main', current: true }],
    });

    render(<ChatPanel />);
    const branchTrigger = screen.getByTestId('branch-dropdown-trigger');
    const sendBtn = screen.getByRole('button', { name: '發送' });

    expect(branchTrigger).toBeInTheDocument();
    expect(sendBtn).toBeInTheDocument();
    expect(Boolean(branchTrigger.compareDocumentPosition(sendBtn) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(branchTrigger).toHaveTextContent('main');
  });

  it('renders and toggles strict orchestration quick button when subagents are enabled', () => {
    const { rerender } = render(<ChatPanel />);
    const toggleBtn = screen.getByRole('button', { name: '彈性調度' });
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(useAgentStore.getState().strictOrchestration).toBe(true);
    expect(screen.getByRole('button', { name: '🎯 強制調度' })).toBeInTheDocument();

    useAgentStore.setState({ subagentsEnabled: false });
    rerender(<ChatPanel />);
    expect(screen.queryByRole('button', { name: '🎯 強制調度' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '彈性調度' })).not.toBeInTheDocument();
  });

  it('toggles between Send and Stop buttons based on agent busy status and calls cancelTask', () => {
    const cancelTaskSpy = vi.fn();
    useAgentStore.setState({
      status: 'idle',
      cancelTask: cancelTaskSpy,
      currentBranch: 'main',
      branches: [{ name: 'main', current: true }],
    });

    const { rerender } = render(<ChatPanel />);

    // Idle state: Send is visible, Stop is not rendered
    expect(screen.getByRole('button', { name: '發送' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();

    // Busy state ('thinking'): Send is hidden, Stop is rendered to the right of BranchDropdown
    useAgentStore.setState({ status: 'thinking' });
    rerender(<ChatPanel />);

    expect(screen.queryByRole('button', { name: '發送' })).not.toBeInTheDocument();
    const stopBtn = screen.getByRole('button', { name: '停止' });
    const branchTrigger = screen.getByTestId('branch-dropdown-trigger');
    expect(stopBtn).toBeInTheDocument();
    expect(Boolean(branchTrigger.compareDocumentPosition(stopBtn) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    fireEvent.click(stopBtn);
    expect(cancelTaskSpy).toHaveBeenCalledTimes(1);

    // Busy state ('streaming'): Stop remains rendered and Send remains hidden
    useAgentStore.setState({ status: 'streaming' });
    rerender(<ChatPanel />);
    expect(screen.queryByRole('button', { name: '發送' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();

    // Completed / idle state: Stop is hidden, Send is visible again
    useAgentStore.setState({ status: 'completed' });
    rerender(<ChatPanel />);
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '發送' })).toBeInTheDocument();

    useAgentStore.setState({ status: 'idle' });
    rerender(<ChatPanel />);
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '發送' })).toBeInTheDocument();
  });
});
