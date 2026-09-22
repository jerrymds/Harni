import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubagentPanel } from './SubagentPanel.js';
import { useAgentStore } from '../../store/useAgentStore.js';
import type { SubagentInstanceInfo } from '@harni/types';

describe('SubagentPanel Component', () => {
  beforeEach(() => {
    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {},
    });
  });

  it('renders nothing when there are no subagents for current session', () => {
    const { container } = render(<SubagentPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders subagent cards with role, type, and status', () => {
    const mockSubagents: SubagentInstanceInfo[] = [
      {
        id: 'sub_1',
        parentId: 'task_1',
        sessionId: 'session_123',
        typeName: 'researcher',
        role: 'Codebase Researcher',
        prompt: 'Search for authentication handlers in server',
        status: 'running',
        depth: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        toolCallCount: 3,
      },
      {
        id: 'sub_2',
        parentId: 'task_1',
        sessionId: 'session_123',
        typeName: 'coder',
        role: 'Code Implementer',
        prompt: 'Implement subagent panel UI',
        status: 'completed',
        depth: 1,
        result: 'Successfully implemented SubagentPanel component.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: Date.now(),
        toolCallCount: 2,
      },
    ];

    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {
        session_123: mockSubagents,
      },
    });

    render(<SubagentPanel />);

    expect(screen.getByText(/階層式子代理人編排/)).toBeInTheDocument();
    expect(screen.getByText('Codebase Researcher')).toBeInTheDocument();
    expect(screen.getByText('Code Implementer')).toBeInTheDocument();
    expect(screen.getByText('執行中')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('expands subagent card on click and displays report and objective', () => {
    const mockSubagent: SubagentInstanceInfo = {
      id: 'sub_completed_1',
      parentId: 'task_1',
      sessionId: 'session_123',
      typeName: 'reviewer',
      role: 'Test Reviewer',
      prompt: 'Execute Vitest suite and analyze test failures',
      status: 'completed',
      depth: 1,
      result: 'All 29 tests passed successfully with 100% coverage.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      toolCallCount: 1,
    };

    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {
        session_123: [mockSubagent],
      },
    });

    render(<SubagentPanel />);

    // Click to expand
    const subagentHeaderBtn = screen.getByText('Test Reviewer');
    fireEvent.click(subagentHeaderBtn);

    expect(screen.getByText(/任務目標/)).toBeInTheDocument();
    expect(screen.getByText('Execute Vitest suite and analyze test failures')).toBeInTheDocument();
    expect(screen.getByText(/執行總結與產出/)).toBeInTheDocument();
    expect(screen.getByText('All 29 tests passed successfully with 100% coverage.')).toBeInTheDocument();
  });

  it('allows killing an active subagent', () => {
    const mockSubagent: SubagentInstanceInfo = {
      id: 'sub_to_kill',
      parentId: 'task_1',
      sessionId: 'session_123',
      typeName: 'coder',
      role: 'Active Worker',
      prompt: 'Heavy refactoring',
      status: 'running',
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {
        session_123: [mockSubagent],
      },
    });

    render(<SubagentPanel />);

    const killBtn = screen.getByTitle('終止此子代理人');
    expect(killBtn).toBeInTheDocument();
    fireEvent.click(killBtn);

    const updated = useAgentStore.getState().subagents['session_123'];
    expect(updated[0].status).toBe('cancelled');
  });
});
