import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OrchestratorPanel } from './OrchestratorPanel.js';
import { useAgentStore } from '../../store/useAgentStore.js';

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
            prompt: 'Implement JWT middleware',
            status: 'running',
            currentToolSummary: 'edit_file src/auth.ts',
            depth: 1,
            createdAt: 210,
            updatedAt: 220,
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
    expect(screen.getByText('Auth Refactor Swarm')).toBeInTheDocument();
    expect(screen.getByText('@auth-worker')).toBeInTheDocument();
    expect(screen.getByText('@coordinator JWT middleware updated')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /排程與喚醒/ }));
    expect(screen.getByText('*/5 * * * *')).toBeInTheDocument();
    expect(screen.getByText('Subagent Auth Coder completed step 1')).toBeInTheDocument();
  });
});
