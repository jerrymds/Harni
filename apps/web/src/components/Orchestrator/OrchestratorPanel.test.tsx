import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OrchestratorPanel } from './OrchestratorPanel.js';
import { cleanChangedFilePath, useAgentStore } from '../../store/useAgentStore.js';

describe('OrchestratorPanel', () => {
  const sendSpy = vi.fn();

  beforeEach(() => {
    sendSpy.mockReset();
    useAgentStore.setState({
      ws: { readyState: 1, send: sendSpy } as unknown as WebSocket,
      activeWorkspaceView: 'orchestrator',
      currentSessionId: 'sess_1',
      activeFolderId: 'folder_1',
      folders: [
        { id: 'folder_1', name: 'Frontend App', path: '/repo/web', createdAt: 1 },
        { id: 'folder_2', name: 'Backend API', path: '/repo/api', createdAt: 2 },
      ],
      sessions: [
        {
          id: 'sess_1',
          folderId: 'folder_1',
          title: 'Build Login UI',
          createdAt: 100,
          updatedAt: 300,
          messageCount: 4,
          mode: 'code',
          provider: 'antigravity',
          model: 'gemini-3.8-flash',
          status: 'waiting_approval',
          pendingApproval: {
            id: 'tc_1',
            name: 'run_command',
            arguments: { command: 'pnpm test' },
            requiresApproval: true,
          },
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
        {
          id: 'sess_2',
          folderId: 'folder_2',
          title: 'Refactor Auth Service',
          createdAt: 200,
          updatedAt: 400,
          messageCount: 2,
          mode: 'code',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          status: 'thinking',
          pendingQuestion: {
            toolCallId: 'q_2',
            question: 'Choose token strategy?',
            options: ['JWT', 'Opaque Session'],
          },
          tokenUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
        },
        {
          id: 'sess_3',
          folderId: 'folder_1',
          title: 'Docs Update',
          createdAt: 50,
          updatedAt: 150,
          messageCount: 6,
          mode: 'ask',
          status: 'completed',
          tokenUsage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        },
      ],
      subagents: {
        sess_2: [
          {
            id: 'sub_a',
            parentId: 'main',
            sessionId: 'sess_2',
            typeName: 'coder',
            role: 'Auth Coder',
            alias: 'auth-worker',
            model: 'claude-3-7-sonnet-latest',
            prompt: 'Implement JWT middleware',
            status: 'running',
            currentToolSummary: 'edit_file src/auth.ts',
            depth: 1,
            createdAt: 210,
            updatedAt: 220,
          },
          {
            id: 'sub_b',
            parentId: 'main',
            sessionId: 'sess_2',
            typeName: 'researcher',
            role: 'Legacy Explorer',
            prompt: 'Explore repo',
            status: 'completed',
            depth: 1,
            createdAt: 215,
            updatedAt: 225,
          },
        ],
      },
      sessionChangedFiles: {
        sess_2: [
          {
            path: 'src/auth.ts',
            diff: {
              path: 'src/auth.ts',
              originalContent: 'old',
              newContent: 'new',
            },
            updatedAt: 450,
            source: 'subagent',
            subagentId: 'sub_a',
            subagentRole: 'Auth Coder',
          },
        ],
      },
      swarmBoards: {
        sess_2: {
          sessionId: 'sess_2',
          title: 'Auth Refactor Swarm',
          members: [
            {
              name: 'auth-worker',
              subagentId: 'sub_a',
              role: 'Auth Coder',
              typeName: 'coder',
              model: 'claude-3-7-sonnet-latest',
              status: 'running',
              addedBy: 'coordinator',
              createdAt: 210,
              updatedAt: 220,
            },
          ],
          messages: [
            {
              id: 'sw_m1',
              sessionId: 'sess_2',
              sender: 'auth-worker',
              content: '@coordinator JWT middleware updated',
              mentions: ['coordinator'],
              timestamp: 460,
            },
          ],
          updatedAt: 460,
        },
      },
      sessionSchedules: {
        sess_2: [
          {
            id: 'sch_1',
            sessionId: 'sess_2',
            kind: 'cron',
            prompt: 'Verify auth tests',
            cronExpression: '*/5 * * * *',
            createdAt: 250,
            iterations: 1,
            isDaemon: false,
          },
        ],
      },
      wakeupLogs: {
        sess_2: [
          {
            id: 'wk_1',
            sessionId: 'sess_2',
            source: 'subagent',
            sourceId: 'sub_a',
            summary: 'Subagent Auth Coder completed step 1',
            timestamp: 470,
          },
        ],
      },
      activeDiff: null,
      isDocumentViewerOpen: false,
    });
  });

  it('renders KPI summary and cross-session action queue cards', () => {
    render(<OrchestratorPanel />);

    expect(screen.getByText('Orchestrator 調度中心 (Mission Control)')).toBeInTheDocument();
    expect(screen.getByTestId('subagent-model-sub_a')).toHaveTextContent('claude-3-7-sonnet-latest');
    expect(screen.queryByTestId('subagent-model-sub_b')).not.toBeInTheDocument();
    expect(screen.getByText('550')).toBeInTheDocument(); // total tokens: 150 + 300 + 100
    expect(screen.getByTestId('action-approval-sess_1')).toBeInTheDocument();
    expect(screen.getByTestId('action-question-sess_2')).toBeInTheDocument();
    expect(screen.getByText('pnpm test')).toBeInTheDocument();
    expect(screen.getByText('Choose token strategy?')).toBeInTheDocument();
  });

  it('approves tool and answers question directly from action queue', () => {
    render(<OrchestratorPanel />);

    const approvalCard = screen.getByTestId('action-approval-sess_1');
    const approveBtn = within(approvalCard).getByText('允許執行');
    fireEvent.click(approveBtn);

    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'tool:approve',
        payload: { toolCallId: 'tc_1', approved: true, sessionId: 'sess_1' },
      }),
    );

    fireEvent.click(screen.getByText('JWT'));
    fireEvent.click(screen.getByText('送出回答'));

    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'question:answer',
        payload: { toolCallId: 'q_2', answers: ['JWT'], sessionId: 'sess_2' },
      }),
    );
  });

  it('filters sessions, kills subagent, and switches back to chat view', () => {
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByText('已完成 (1)'));
    expect(screen.getByTestId('orchestrator-session-sess_3')).toBeInTheDocument();
    expect(screen.queryByTestId('orchestrator-session-sess_1')).toBeNull();

    fireEvent.click(screen.getByText('全部 (3)'));
    fireEvent.click(screen.getByLabelText('終止子代理人 Auth Coder'));
    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'subagent:kill',
        payload: { subagentId: 'sub_a', sessionId: 'sess_2' },
      }),
    );

    const sessionCard = screen.getByTestId('orchestrator-session-sess_2');
    const enterBtn = Array.from(sessionCard.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('進入對話'),
    )!;
    fireEvent.click(enterBtn);

    expect(useAgentStore.getState().currentSessionId).toBe('sess_2');
    expect(useAgentStore.getState().activeWorkspaceView).toBe('chat');
  });

  it('opens changed file diff and displays swarm and schedule tabs in inspector', () => {
    render(<OrchestratorPanel />);

    fireEvent.click(screen.getByText('src/auth.ts'));
    expect(useAgentStore.getState().isDocumentViewerOpen).toBe(true);
    expect(useAgentStore.getState().activeDiff?.path).toBe('src/auth.ts');

    fireEvent.click(screen.getByRole('button', { name: /Swarm 看板/ }));
    const inspector = screen.getByLabelText('跨 Session 詳情檢視');
    expect(within(inspector).getByText('Auth Refactor Swarm')).toBeInTheDocument();
    expect(within(inspector).getByText('@auth-worker')).toBeInTheDocument();
    expect(within(inspector).getByText(/claude-3-7-sonnet-latest/)).toBeInTheDocument();
    expect(within(inspector).getByText('@coordinator JWT middleware updated')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /排程與喚醒/ }));
    expect(screen.getByText('*/5 * * * *')).toBeInTheDocument();
    expect(screen.getByText('Subagent Auth Coder completed step 1')).toBeInTheDocument();
  });

  it('toggles single session card collapse state without losing subagent summary', () => {
    render(<OrchestratorPanel />);

    const card = screen.getByTestId('orchestrator-session-sess_2');
    const toggleBtn = screen.getByTestId('toggle-session-collapse-sess_2');

    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByTestId('subagent-model-sub_a')).toBeInTheDocument();
    expect(within(card).getByText('2 則訊息')).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByTestId('subagent-model-sub_a')).not.toBeInTheDocument();
    expect(within(card).queryByText('2 則訊息')).not.toBeInTheDocument();
    expect(within(card).getByText('子代理人 (2)')).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByTestId('subagent-model-sub_a')).toBeInTheDocument();
    expect(within(card).getByText('2 則訊息')).toBeInTheDocument();
  });

  it('collapses and expands all filtered session cards at once', () => {
    render(<OrchestratorPanel />);

    const toggleAllBtn = screen.getByTestId('toggle-collapse-all-sessions');
    expect(toggleAllBtn).toHaveTextContent('全部摺疊');

    fireEvent.click(toggleAllBtn);
    expect(toggleAllBtn).toHaveTextContent('全部展開');
    expect(screen.getByTestId('toggle-session-collapse-sess_1')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByTestId('toggle-session-collapse-sess_2')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByTestId('toggle-session-collapse-sess_3')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('subagent-model-sub_a')).not.toBeInTheDocument();

    fireEvent.click(toggleAllBtn);
    expect(toggleAllBtn).toHaveTextContent('全部摺疊');
    expect(screen.getByTestId('toggle-session-collapse-sess_1')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('toggle-session-collapse-sess_2')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('toggle-session-collapse-sess_3')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('subagent-model-sub_a')).toBeInTheDocument();
  });

  it('sanitizes markdown links and no-op labels in changed files tab and opens clean path', () => {
    const winWorkspaceRoot = 'D:\\Work\\Project\\Harni';
    expect(
      cleanChangedFilePath(
        '[activeContext.md](file:\\D:\\Work\\Project\\Harni\\memory-bank\\activeContext.md#L3-L42)：將 ## Current Work Focus 日期更新為 2026-11-23...',
        winWorkspaceRoot,
      ),
    ).toBe('memory-bank/activeContext.md');
    expect(cleanChangedFilePath('無（唯讀覆驗，未修改任何檔案）', winWorkspaceRoot)).toBeNull();
    expect(
      cleanChangedFilePath(
        '**`apps/web/src/App.tsx`** - 更新路由說明',
        winWorkspaceRoot,
      ),
    ).toBe('apps/web/src/App.tsx');

    useAgentStore.setState((state) => ({
      folders: [
        { id: 'folder_1', name: 'Harni', path: winWorkspaceRoot, createdAt: 1 },
        ...state.folders.filter((f) => f.id !== 'folder_1'),
      ],
      subagents: {
        ...state.subagents,
        sess_1: [
          {
            id: 'sub_docs',
            parentId: 'main',
            sessionId: 'sess_1',
            typeName: 'coder',
            role: 'Docs Updater',
            prompt: 'Update memory bank',
            status: 'completed',
            depth: 1,
            createdAt: 300,
            updatedAt: 350,
            completedAt: 350,
            structuredReport: {
              summary: 'Updated activeContext',
              modifiedFiles: [
                '[activeContext.md](file:\\D:\\Work\\Project\\Harni\\memory-bank\\activeContext.md#L3-L42)：將 ## Current Work Focus 日期更新為 2026-11-23...',
                '無（唯讀覆驗，未修改任何檔案）',
              ],
            },
          },
        ],
      },
      sessionChangedFiles: {
        sess_1: [
          {
            path: '[activeContext.md](file:\\D:\\Work\\Project\\Harni\\memory-bank\\activeContext.md#L3-L42)：將 ## Current Work Focus 日期更新為 2026-11-23...',
            updatedAt: 500,
            source: 'subagent',
            subagentId: 'sub_docs',
            subagentRole: 'Docs Updater',
          },
          {
            path: '無（唯讀覆驗，未修改任何檔案）',
            updatedAt: 500,
            source: 'subagent',
            subagentId: 'sub_docs',
            subagentRole: 'Docs Updater',
          },
        ],
      },
    }));

    render(<OrchestratorPanel />);

    const inspector = screen.getByLabelText('跨 Session 詳情檢視');
    expect(within(inspector).getByText('變更檔案 (1)')).toBeInTheDocument();
    expect(within(inspector).getByText('memory-bank/activeContext.md')).toBeInTheDocument();
    expect(within(inspector).queryByText(/無（唯讀覆驗/)).not.toBeInTheDocument();
    expect(within(inspector).queryByText(/\[activeContext\.md\]/)).not.toBeInTheDocument();

    fireEvent.click(within(inspector).getByText('memory-bank/activeContext.md'));

    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'file:open',
        payload: {
          path: 'memory-bank/activeContext.md',
          workspaceRoot: winWorkspaceRoot,
        },
      }),
    );
  });

  it('deduplicates structuredReport modifiedFiles while preserving diff entries and clean path edge cases', () => {
    const winWorkspaceRoot = 'd:\\Work\\Project\\Harni\\';
    expect(
      cleanChangedFilePath(
        '[spaced file.ts](file:///D:/Work/Project/Harni/apps/web/src/spaced%20file.ts#L10-L25)（新增）',
        winWorkspaceRoot,
      ),
    ).toBe('apps/web/src/spaced file.ts');
    expect(cleanChangedFilePath('[src/fallback.ts](https://example.com/blob/a)', winWorkspaceRoot)).toBe(
      'src/fallback.ts',
    );
    expect(cleanChangedFilePath('https://example.com/only-url', winWorkspaceRoot)).toBeNull();
    expect(cleanChangedFilePath('vscode://file/Users/dev/app.ts', winWorkspaceRoot)).toBeNull();
    expect(cleanChangedFilePath('None (no changes)', winWorkspaceRoot)).toBeNull();
    expect(cleanChangedFilePath('没有修改任何文件', winWorkspaceRoot)).toBeNull();
    expect(cleanChangedFilePath('none-config.ts', winWorkspaceRoot)).toBe('none-config.ts');
    expect(cleanChangedFilePath('nil-check.ts', winWorkspaceRoot)).toBe('nil-check.ts');
    expect(cleanChangedFilePath('src/app.ts:42:10', winWorkspaceRoot)).toBe('src/app.ts');
    expect(cleanChangedFilePath('./src/app.ts', winWorkspaceRoot)).toBe('src/app.ts');
    expect(cleanChangedFilePath('../src/app.ts', winWorkspaceRoot)).toBe('../src/app.ts');
    expect(cleanChangedFilePath('file:///Users/dev/app.ts')).toBe('/Users/dev/app.ts');
    expect(cleanChangedFilePath('file:/Users/dev/app.ts')).toBe('/Users/dev/app.ts');
    expect(cleanChangedFilePath('D:/repo//src/a.ts', 'D:/repo')).toBe('src/a.ts');
    expect(cleanChangedFilePath('D:/repo/', 'D:/repo')).toBeNull();
    expect(cleanChangedFilePath('/repo/web/src/main.tsx', '/repo/web/')).toBe('src/main.tsx');

    useAgentStore.setState((state) => ({
      folders: [
        { id: 'folder_1', name: 'Harni', path: 'D:\\Work\\Project\\Harni', createdAt: 1 },
        ...state.folders.filter((f) => f.id !== 'folder_1'),
      ],
      subagents: {
        ...state.subagents,
        sess_1: [
          {
            id: 'sub_merge',
            parentId: 'main',
            sessionId: 'sess_1',
            typeName: 'coder',
            role: 'Merger',
            prompt: 'Edit files',
            status: 'completed',
            depth: 1,
            createdAt: 400,
            updatedAt: 550,
            completedAt: 550,
            structuredReport: {
              summary: 'Done',
              modifiedFiles: [
                '[App.tsx](file:///D:/Work/Project/Harni/apps/web/src/App.tsx#L1-L5)：更新',
                '[notes.md](file:\\D:\\Work\\Project\\Harni\\docs\\notes.md)：補文件',
                '無（唯讀覆驗，未修改任何檔案）',
              ],
            },
          },
        ],
      },
      sessionChangedFiles: {
        sess_1: [
          {
            path: 'apps/web/src/App.tsx',
            diff: {
              path: 'apps/web/src/App.tsx',
              originalContent: 'before',
              newContent: 'after',
            },
            updatedAt: 500,
            source: 'subagent',
            subagentId: 'sub_merge',
            subagentRole: 'Merger',
          },
        ],
      },
    }));

    render(<OrchestratorPanel />);

    const inspector = screen.getByLabelText('跨 Session 詳情檢視');
    expect(within(inspector).getByText('變更檔案 (2)')).toBeInTheDocument();
    expect(within(inspector).getByText('apps/web/src/App.tsx')).toBeInTheDocument();
    expect(within(inspector).getByText('docs/notes.md')).toBeInTheDocument();
    expect(within(inspector).getByText('Diff')).toBeInTheDocument();

    fireEvent.click(within(inspector).getByText('apps/web/src/App.tsx'));
    expect(useAgentStore.getState().isDocumentViewerOpen).toBe(true);
    expect(useAgentStore.getState().activeDiff?.path).toBe('apps/web/src/App.tsx');

    fireEvent.click(within(inspector).getByText('docs/notes.md'));
    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'file:open',
        payload: {
          path: 'docs/notes.md',
          workspaceRoot: 'D:\\Work\\Project\\Harni',
        },
      }),
    );
  });
});
