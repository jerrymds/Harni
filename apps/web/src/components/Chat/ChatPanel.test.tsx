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
      activeWorktrees: {},
      isRevertingCheckpoint: false,
      worktreeIsolationEnabled: false,
      subagentsEnabled: true,
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
});
