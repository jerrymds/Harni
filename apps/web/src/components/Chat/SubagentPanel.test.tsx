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

  it('renders currentToolSummary and model info correctly', () => {
    const mockSubagent: SubagentInstanceInfo = {
      id: 'sub_active_1',
      parentId: 'task_1',
      sessionId: 'session_123',
      typeName: 'coder',
      role: 'Code Implementer',
      prompt: 'Execute refactoring',
      status: 'running',
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: 'gemini-2.5-flash',
      currentToolSummary: 'Subagent calling replace_file_content',
    };

    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {
        session_123: [mockSubagent],
      },
    });

    render(<SubagentPanel />);

    expect(screen.getByText('Code Implementer')).toBeInTheDocument();
    expect(screen.getByText('Subagent calling replace_file_content')).toBeInTheDocument();
    expect(screen.getByText('模型:')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-flash')).toBeInTheDocument();
  });

  it('renders tokenUsage correctly when available', () => {
    const mockSubagent: SubagentInstanceInfo = {
      id: 'sub_tokens_1',
      parentId: 'task_1',
      sessionId: 'session_123',
      typeName: 'researcher',
      role: 'Token Reporter',
      prompt: 'Check token usage',
      status: 'completed',
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tokenUsage: {
        promptTokens: 1200,
        completionTokens: 350,
        totalTokens: 1550,
      },
    };

    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {
        session_123: [mockSubagent],
      },
    });

    render(<SubagentPanel />);

    // Click to expand
    fireEvent.click(screen.getByText('Token Reporter'));
    expect(screen.getByText('Tokens:')).toBeInTheDocument();
    expect(screen.getByText('1,550')).toBeInTheDocument();
  });

  it('renders live streaming text and thinking when subagent is running', () => {
    const mockSubagent: SubagentInstanceInfo = {
      id: 'sub_stream_1',
      parentId: 'task_1',
      sessionId: 'session_123',
      typeName: 'coder',
      role: 'Streaming Worker',
      prompt: 'Work on streaming',
      status: 'running',
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      streamingThinking: 'Analyzing project structure...',
      streamingText: 'Writing code for SubagentPanel component...',
    };

    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {
        session_123: [mockSubagent],
      },
    });

    render(<SubagentPanel />);

    expect(screen.getByText(/即時輸出 \(Live Stream\):/)).toBeInTheDocument();
    expect(screen.getByText('思考過程:')).toBeInTheDocument();
    expect(screen.getByText('Analyzing project structure...')).toBeInTheDocument();
    expect(screen.getByText(/Writing code for SubagentPanel component\.\.\./)).toBeInTheDocument();
  });

  it('renders structured report chips, verification, findings, and open questions', () => {
    const mockSubagent: SubagentInstanceInfo = {
      id: 'sub_report_1',
      parentId: 'task_1',
      sessionId: 'session_123',
      typeName: 'coder',
      role: 'Report Worker',
      prompt: 'Execute refactor',
      status: 'completed',
      depth: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: 'Finished refactoring task.',
      structuredReport: {
        summary: 'Refactored successfully.',
        modifiedFiles: ['src/subagentManager.ts', 'src/subagentInstance.ts'],
        verification: 'All vitest assertions passed 100%.',
        findings: ['Concurrency semaphore eliminates resource contention.'],
        openQuestions: ['Should we add persistent queue state?'],
      },
    };

    useAgentStore.setState({
      currentSessionId: 'session_123',
      subagents: {
        session_123: [mockSubagent],
      },
    });

    render(<SubagentPanel />);

    // Click to expand
    fireEvent.click(screen.getByText('Report Worker'));

    // Check modified files
    expect(screen.getByText(/修改檔案 \(2\):/)).toBeInTheDocument();
    expect(screen.getByText('src/subagentManager.ts')).toBeInTheDocument();
    expect(screen.getByText('src/subagentInstance.ts')).toBeInTheDocument();

    // Check verification
    expect(screen.getByText(/驗證結果 \(Verification\):/)).toBeInTheDocument();
    expect(screen.getByText('All vitest assertions passed 100%.')).toBeInTheDocument();

    // Check findings & open questions
    expect(screen.getByText(/關鍵發現 \(Findings\):/)).toBeInTheDocument();
    expect(screen.getByText('Concurrency semaphore eliminates resource contention.')).toBeInTheDocument();
    expect(screen.getByText(/待決問題 \(Open Questions\):/)).toBeInTheDocument();
    expect(screen.getByText('Should we add persistent queue state?')).toBeInTheDocument();
  });

  it('renders pending queued status badge and allows cancelling queued subagent', () => {
    const mockSubagent: SubagentInstanceInfo = {
      id: 'sub_queued_1',
      parentId: 'task_1',
      sessionId: 'session_123',
      typeName: 'architect',
      role: 'Queued Architect',
      prompt: 'Design architecture',
      status: 'pending',
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

    expect(screen.getByText('排隊中')).toBeInTheDocument();
    const killBtn = screen.getByTitle('終止此子代理人');
    expect(killBtn).toBeInTheDocument();
    fireEvent.click(killBtn);

    const updated = useAgentStore.getState().subagents['session_123'];
    expect(updated[0].status).toBe('cancelled');
  });
});

