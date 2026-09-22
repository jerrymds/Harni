import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandExecutionAccordion } from './CommandExecutionAccordion.js';
import type { ChatMessage } from '@harni/types';

describe('CommandExecutionAccordion Component', () => {
  const sampleCommands: ChatMessage[] = [
    {
      id: 'msg_tool_1',
      role: 'tool',
      name: 'execute_command',
      content: 'Passed: 10 tests',
      toolResult: { isError: false, output: 'Passed: 10 tests', summary: 'execute_command (pnpm test)' },
      timestamp: 1000,
    },
    {
      id: 'msg_tool_2',
      role: 'tool',
      name: 'write_to_file',
      content: 'Wrote file successfully',
      toolResult: { isError: false, output: 'File created', summary: 'write_to_file src/app.ts' },
      timestamp: 1001,
    },
  ];

  it('renders nothing when intermediateCommands is empty', () => {
    const { container } = render(
      <CommandExecutionAccordion intermediateCommands={[]} isFinished={true} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('defaults to collapsed when isFinished is true', () => {
    render(
      <CommandExecutionAccordion
        intermediateCommands={sampleCommands}
        isFinished={true}
      />,
    );

    expect(screen.getByTestId('command-execution-accordion')).toBeInTheDocument();
    expect(screen.getByText(/指令與思考流程 \(已執行 2 個指令\)/)).toBeInTheDocument();
    expect(screen.getByTestId('badge-executed')).toBeInTheDocument();
    expect(screen.getByText('展開')).toBeInTheDocument();

    // Content should be collapsed by default
    expect(screen.queryByTestId('command-accordion-content')).not.toBeInTheDocument();
  });

  it('defaults to expanded when isFinished is false (executing)', () => {
    render(
      <CommandExecutionAccordion
        intermediateCommands={sampleCommands}
        isFinished={false}
      />,
    );

    expect(screen.getByTestId('badge-running')).toBeInTheDocument();
    expect(screen.getByText('收合')).toBeInTheDocument();
    expect(screen.getByTestId('command-accordion-content')).toBeInTheDocument();
  });

  it('toggles open/close state on click', () => {
    render(
      <CommandExecutionAccordion
        intermediateCommands={sampleCommands}
        isFinished={true}
      />,
    );

    const toggleBtn = screen.getByTestId('command-accordion-toggle');

    // Initially collapsed
    expect(screen.queryByTestId('command-accordion-content')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId('command-accordion-content')).toBeInTheDocument();
    expect(screen.getByText('收合')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId('command-accordion-content')).not.toBeInTheDocument();
    expect(screen.getByText('展開')).toBeInTheDocument();
  });

  it('automatically collapses when isFinished transitions from false to true', () => {
    const { rerender } = render(
      <CommandExecutionAccordion
        intermediateCommands={sampleCommands}
        isFinished={false}
      />,
    );

    // Initially expanded when running
    expect(screen.getByTestId('command-accordion-content')).toBeInTheDocument();
    expect(screen.getByTestId('badge-running')).toBeInTheDocument();

    // Agent finishes generation -> rerender with isFinished = true
    rerender(
      <CommandExecutionAccordion
        intermediateCommands={sampleCommands}
        isFinished={true}
      />,
    );

    // Automatically collapsed!
    expect(screen.queryByTestId('command-accordion-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('badge-executed')).toBeInTheDocument();
    expect(screen.getByText('展開')).toBeInTheDocument();
  });

  it('shows Failed badge if any tool execution resulted in an error', () => {
    const errorCommands: ChatMessage[] = [
      {
        id: 'msg_tool_fail',
        role: 'tool',
        name: 'execute_command',
        content: 'Error: command not found',
        toolResult: { isError: true, output: 'Error: command not found', summary: 'execute_command' },
        timestamp: 1000,
      },
    ];

    render(
      <CommandExecutionAccordion
        intermediateCommands={errorCommands}
        isFinished={true}
      />,
    );

    expect(screen.getByTestId('badge-failed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
