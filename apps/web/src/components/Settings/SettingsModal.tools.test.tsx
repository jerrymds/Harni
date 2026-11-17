import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { WorkflowPluginMetadata } from '@harni/types';
import { SettingsModal } from './SettingsModal.js';
import { useAgentStore } from '../../store/useAgentStore.js';

const createMockPlugins = (overrides?: Partial<Record<string, boolean>>): WorkflowPluginMetadata[] => [
  {
    id: 'harni.git-workspace',
    name: 'Git Workspace & Safe Rollback',
    description: '管理 Worktree 隔離開發與自動建立 Git Checkpoint 快照',
    priority: 10,
    enabled: overrides?.['harni.git-workspace'] ?? true,
    category: 'environment',
    applyToSubagents: false,
  },
  {
    id: 'harni.auto-test-repair',
    name: 'Auto Test-Driven Repair',
    description: '修改代碼後自動執行測試並於失敗時進行自癒修復',
    priority: 60,
    enabled: overrides?.['harni.auto-test-repair'] ?? true,
    category: 'verification',
    applyToSubagents: true,
  },
];

// Save original store actions so store-slice tests always exercise real implementations
const originalActions = {
  fetchWorkflowPlugins: useAgentStore.getState().fetchWorkflowPlugins,
  toggleWorkflowPlugin: useAgentStore.getState().toggleWorkflowPlugin,
  setGitCheckpointEnabled: useAgentStore.getState().setGitCheckpointEnabled,
  setWorktreeIsolationEnabled: useAgentStore.getState().setWorktreeIsolationEnabled,
  setAutoTestEnabled: useAgentStore.getState().setAutoTestEnabled,
  setAutoTestCommand: useAgentStore.getState().setAutoTestCommand,
  fetchCredentials: useAgentStore.getState().fetchCredentials,
  fetchAnthropicAuthStatus: useAgentStore.getState().fetchAnthropicAuthStatus,
  fetchOpenAIAuthStatus: useAgentStore.getState().fetchOpenAIAuthStatus,
  fetchModels: useAgentStore.getState().fetchModels,
  fetchSkills: useAgentStore.getState().fetchSkills,
  sendPrompt: useAgentStore.getState().sendPrompt,
};

describe('SettingsModal Tools Tab & Workflow Plugin Convergence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    useAgentStore.setState({
      ...originalActions,
      isSettingsOpen: true,
      selectedProvider: 'cline',
      selectedModel: 'test-model',
      autoApprove: false,
      subagentsEnabled: true,
      autoTestEnabled: true,
      autoTestCommand: '',
      gitCheckpointEnabled: true,
      worktreeIsolationEnabled: false,
      checkpoints: [],
      workflowPlugins: createMockPlugins(),
      isLoadingPlugins: false,
      credentials: {},
      providerBaseUrls: {},
      modelContextWindows: {},
      contextWindow: null,
      availableModels: {},
      customProviders: [],
      skills: [],
    });
  });

  afterEach(() => {
    useAgentStore.setState({
      ...originalActions,
      isSettingsOpen: false,
    });
    vi.restoreAllMocks();
  });

  const setupModalMocks = () => {
    const setGitCheckpointEnabledSpy = vi.fn();
    const setWorktreeIsolationEnabledSpy = vi.fn();
    const setAutoTestCommandSpy = vi.fn();

    useAgentStore.setState({
      fetchWorkflowPlugins: vi.fn().mockResolvedValue(undefined),
      fetchCredentials: vi.fn().mockResolvedValue(undefined),
      fetchAnthropicAuthStatus: vi.fn().mockResolvedValue(undefined),
      fetchOpenAIAuthStatus: vi.fn().mockResolvedValue(undefined),
      fetchModels: vi.fn().mockResolvedValue(undefined),
      fetchSkills: vi.fn().mockResolvedValue(undefined),
      setGitCheckpointEnabled: setGitCheckpointEnabledSpy,
      setWorktreeIsolationEnabled: setWorktreeIsolationEnabledSpy,
      setAutoTestCommand: setAutoTestCommandSpy,
    });

    return {
      setGitCheckpointEnabledSpy,
      setWorktreeIsolationEnabledSpy,
      setAutoTestCommandSpy,
    };
  };

  it('keeps only Auto Approval and Hierarchical Subagents banners at top of Tools tab without legacy standalone banners', () => {
    setupModalMocks();
    render(<SettingsModal />);

    fireEvent.click(screen.getByText('工具 (Tools)'));

    expect(screen.getByText('全自動審批模式 (All Approve / Yolo Mode)')).toBeInTheDocument();
    expect(screen.getByText('多子代理人協同 (Hierarchical Subagents)')).toBeInTheDocument();

    // Legacy standalone banner titles must not exist
    expect(screen.queryByText('自動測試驅動修復 (Auto Test-Driven Repair)')).not.toBeInTheDocument();
    expect(screen.queryByText('自動 Git Checkpoint 快照與一鍵復原 (Safe Rollback)')).not.toBeInTheDocument();
    // Worktree isolation title now only appears inside the plugin card sub-settings
    expect(screen.getAllByText('Git Worktree 隔離開發 (Worktree Isolation)')).toHaveLength(1);
  });

  it('renders Checkpoint and Worktree sub-toggles inside harni.git-workspace when enabled, saves changes, and hides when disabled', () => {
    const { setGitCheckpointEnabledSpy, setWorktreeIsolationEnabledSpy } = setupModalMocks();

    const { rerender } = render(<SettingsModal />);
    fireEvent.click(screen.getByText('工具 (Tools)'));

    const checkpointToggle = screen.getByRole('button', { name: '切換 自動 Git Checkpoint 快照' });
    const worktreeToggle = screen.getByRole('button', { name: '切換 Git Worktree 隔離開發' });
    expect(checkpointToggle).toBeInTheDocument();
    expect(worktreeToggle).toBeInTheDocument();

    // Toggle both sub-switches and click Save
    fireEvent.click(checkpointToggle); // true -> false
    fireEvent.click(worktreeToggle); // false -> true
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

    expect(setGitCheckpointEnabledSpy).toHaveBeenCalledWith(false);
    expect(setWorktreeIsolationEnabledSpy).toHaveBeenCalledWith(true);

    // Disable harni.git-workspace plugin and verify sub-toggles are hidden
    act(() => {
      useAgentStore.setState({
        workflowPlugins: createMockPlugins({ 'harni.git-workspace': false }),
      });
    });
    rerender(<SettingsModal />);

    expect(screen.queryByRole('button', { name: '切換 自動 Git Checkpoint 快照' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '切換 Git Worktree 隔離開發' })).not.toBeInTheDocument();
  });

  it('renders custom test command input inside harni.auto-test-repair when enabled, saves input, and hides when disabled', () => {
    const { setAutoTestCommandSpy } = setupModalMocks();

    const { rerender } = render(<SettingsModal />);
    fireEvent.click(screen.getByText('工具 (Tools)'));

    const cmdInput = screen.getByPlaceholderText('例如: pnpm test 或 vitest run --project core') as HTMLInputElement;
    expect(cmdInput).toBeInTheDocument();

    fireEvent.change(cmdInput, { target: { value: 'pnpm --filter @harni/web test' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

    expect(setAutoTestCommandSpy).toHaveBeenCalledWith('pnpm --filter @harni/web test');

    // Disable harni.auto-test-repair plugin and verify input is hidden
    act(() => {
      useAgentStore.setState({
        workflowPlugins: createMockPlugins({ 'harni.auto-test-repair': false }),
      });
    });
    rerender(<SettingsModal />);

    expect(screen.queryByPlaceholderText('例如: pnpm test 或 vitest run --project core')).not.toBeInTheDocument();
  });

  it('synchronizes plugin state between createSettingsSlice and createChatSlice sendPrompt', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/plugins/toggle')) {
        return new Response(
          JSON.stringify({
            plugins: createMockPlugins({
              'harni.auto-test-repair': false,
              'harni.git-workspace': true,
            }),
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/plugins')) {
        return new Response(
          JSON.stringify({
            plugins: createMockPlugins({
              'harni.auto-test-repair': false,
              'harni.git-workspace': false,
            }),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // 1. fetchWorkflowPlugins syncs autoTestEnabled with harni.auto-test-repair
    await useAgentStore.getState().fetchWorkflowPlugins();
    expect(useAgentStore.getState().autoTestEnabled).toBe(false);
    expect(localStorage.getItem('harni_web_auto_test_enabled')).toBe('false');

    // 2. toggleWorkflowPlugin('harni.auto-test-repair', false) syncs autoTestEnabled
    useAgentStore.setState({
      autoTestEnabled: true,
      workflowPlugins: createMockPlugins({ 'harni.auto-test-repair': true, 'harni.git-workspace': false }),
    });
    await useAgentStore.getState().toggleWorkflowPlugin('harni.auto-test-repair', false);
    expect(useAgentStore.getState().autoTestEnabled).toBe(false);
    expect(localStorage.getItem('harni_web_auto_test_enabled')).toBe('false');

    // 3. toggleWorkflowPlugin('harni.git-workspace', true) enables gitCheckpointEnabled if both sub-switches were false
    useAgentStore.setState({
      gitCheckpointEnabled: false,
      worktreeIsolationEnabled: false,
      workflowPlugins: createMockPlugins({ 'harni.git-workspace': false }),
    });
    await useAgentStore.getState().toggleWorkflowPlugin('harni.git-workspace', true);
    expect(useAgentStore.getState().gitCheckpointEnabled).toBe(true);

    // 4. setWorktreeIsolationEnabled(true) when harni.git-workspace is disabled triggers toggleWorkflowPlugin('harni.git-workspace', true)
    fetchSpy.mockClear();
    useAgentStore.setState({
      worktreeIsolationEnabled: false,
      workflowPlugins: createMockPlugins({ 'harni.git-workspace': false }),
    });
    useAgentStore.getState().setWorktreeIsolationEnabled(true);
    expect(useAgentStore.getState().worktreeIsolationEnabled).toBe(true);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/toggle'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: 'harni.git-workspace', enabled: true }),
        }),
      );
    });

    // 5. sendPrompt derives autoTest, enableWorktree, enableCheckpoint from workflowPlugins + sub-flags
    const wsSendSpy = vi.fn();
    useAgentStore.setState({
      ws: { readyState: 1, send: wsSendSpy } as unknown as WebSocket,
      currentSessionId: 'session_sync_test',
      sessions: [
        {
          id: 'session_sync_test',
          title: 'Sync Test',
          messageCount: 0,
          mode: 'code',
          provider: 'cline',
          model: 'test-model',
          status: 'idle',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        },
      ],
      messages: [],
      folders: [],
      activeFolderId: 'folder_default',
      selectedMode: 'code',
      selectedProvider: 'cline',
      selectedModel: 'test-model',
      autoTestEnabled: true, // stale flag should be overridden by plugin.enabled=false
      gitCheckpointEnabled: true,
      worktreeIsolationEnabled: true,
      workflowPlugins: createMockPlugins({
        'harni.auto-test-repair': false,
        'harni.git-workspace': false,
      }),
    });

    useAgentStore.getState().sendPrompt('check plugin flags');

    const promptCall = wsSendSpy.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((m) => m.type === 'user:prompt');

    expect(promptCall).toBeDefined();
    expect(promptCall.payload.autoTest).toBe(false);
    expect(promptCall.payload.enableWorktree).toBe(false);
    expect(promptCall.payload.enableCheckpoint).toBe(false);

    // Now enable both plugins and keep gitCheckpointEnabled=true, worktreeIsolationEnabled=false
    wsSendSpy.mockClear();
    useAgentStore.setState({
      gitCheckpointEnabled: true,
      worktreeIsolationEnabled: false,
      workflowPlugins: createMockPlugins({
        'harni.auto-test-repair': true,
        'harni.git-workspace': true,
      }),
    });

    useAgentStore.getState().sendPrompt('check enabled plugin flags');

    const promptCall2 = wsSendSpy.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((m) => m.type === 'user:prompt');

    expect(promptCall2).toBeDefined();
    expect(promptCall2.payload.autoTest).toBe(true);
    expect(promptCall2.payload.enableWorktree).toBe(false);
    expect(promptCall2.payload.enableCheckpoint).toBe(true);
  });
});
