import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Header } from './Header.js';
import { useAgentStore } from '../../store/useAgentStore.js';

describe('Header Component', () => {
  beforeEach(() => {
    useAgentStore.setState({
      connected: true,
      status: 'idle',
      selectedMode: 'code',
      selectedProvider: 'antigravity',
      selectedModel: 'gemini-3.7-flash',
      thinkingDepth: 'medium',
      availableModels: {
        antigravity: [
          { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
          { id: 'gemini-3.7-pro', name: 'Gemini 3.7 Pro' },
        ],
      },
      isLoadingModels: false,
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      workspaceInfo: { rootPath: '/test/workspace', totalFiles: 5, isGitRepo: true },
      folders: [{ id: 'f1', name: 'Main Workspace', path: '/test/workspace', createdAt: 0 }],
      activeFolderId: 'f1',
      isSettingsOpen: false,
    });
  });

  it('renders brand name, live status, and mode tabs', () => {
    render(<Header />);
    expect(screen.getByText('harni')).toBeInTheDocument();
    expect(screen.getByLabelText('harni logo')).toBeInTheDocument();
    expect(screen.queryByText('Coding Agent')).toBeNull();
    expect(screen.getByText('Live WS')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
  });

  it('switches agent mode when clicking a mode pill', () => {
    render(<Header />);
    const architectBtn = screen.getByText('architect');
    fireEvent.click(architectBtn);
    expect(useAgentStore.getState().selectedMode).toBe('architect');
  });

  it('displays status beacon when status changes', () => {
    act(() => { useAgentStore.setState({ status: 'thinking' }); });
    const { rerender } = render(<Header />);
    expect(screen.getByText('AI 思考與推理中...')).toBeInTheDocument();

    act(() => { useAgentStore.setState({ status: 'executing_tool' }); });
    rerender(<Header />);
    expect(screen.getByText('執行工具操作中')).toBeInTheDocument();

    act(() => { useAgentStore.setState({ status: 'testing' }); });
    rerender(<Header />);
    expect(screen.getByText('背景測試驗證中...')).toBeInTheDocument();
  });

  it('opens settings modal when clicking the settings button', () => {
    render(<Header />);
    const settingsBtn = screen.getByText('設定');
    fireEvent.click(settingsBtn);
    expect(useAgentStore.getState().isSettingsOpen).toBe(true);
  });

  it('filters out thinking depth suffixes and cleans model display names for antigravity provider', () => {
    act(() => {
      useAgentStore.setState({
        selectedProvider: 'antigravity',
        selectedModel: 'gemini-3.8-flash',
        availableModels: {
          antigravity: [
            { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
            { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
            { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
            { id: 'claude-sonnet-5-5:acp', name: 'Claude 3.5 Sonnet (ACP)' },
            { id: 'gpt-oss-120b-medium:acp', name: 'GPT-OSS 120B (ACP Mode)' },
          ],
        },
      });
    });

    render(<Header />);

    // gemini-3.8-flash-high and gemini-3.8-flash-low should be filtered out
    expect(screen.queryByRole('option', { name: 'Gemini 3.8 Flash (High)' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Gemini 3.8 Flash (Low)' })).toBeNull();

    // Cleaned display names
    expect(screen.getByRole('option', { name: 'Gemini 3.8 Flash' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude 3.5 Sonnet (ACP)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'GPT-OSS 120B (ACP)' })).toBeInTheDocument();
  });

  it('auto-corrects legacy selectedModel containing -(low|medium|high) to clean base model', () => {
    act(() => {
      useAgentStore.setState({
        selectedProvider: 'antigravity',
        selectedModel: 'gemini-3.8-flash-medium',
        availableModels: {
          antigravity: [
            { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
            { id: 'gemini-3.8-pro', name: 'Gemini 3.8 Pro' },
          ],
        },
      });
    });

    render(<Header />);

    expect(useAgentStore.getState().selectedModel).toBe('gemini-3.8-flash');
  });
});
