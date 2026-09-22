import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from './QuestionCard.js';
import type { QuestionPrompt } from '@harni/types';

describe('QuestionCard Component', () => {
  const singleSelectPrompt: QuestionPrompt = {
    toolCallId: 'call_q_1',
    question: '請問您希望使用哪種狀態管理方案？',
    options: ['Zustand', 'Redux Toolkit', 'React Context'],
    isMultiSelect: false,
    allowCustomInput: true,
  };

  const multiSelectPrompt: QuestionPrompt = {
    toolCallId: 'call_q_2',
    question: '請選擇需要啟用的附加套件：',
    options: ['Tailwind CSS', 'ESLint + Prettier', 'Vitest'],
    isMultiSelect: true,
    allowCustomInput: true,
  };

  it('renders question and option pills correctly', () => {
    const onSubmit = vi.fn();
    render(<QuestionCard prompt={singleSelectPrompt} onSubmit={onSubmit} />);

    expect(screen.getByText(/Agent 提問與釐清/)).toBeInTheDocument();
    expect(screen.getByText('請問您希望使用哪種狀態管理方案？')).toBeInTheDocument();
    expect(screen.getByText('Zustand')).toBeInTheDocument();
    expect(screen.getByText('Redux Toolkit')).toBeInTheDocument();
    expect(screen.getByText('React Context')).toBeInTheDocument();
  });

  it('handles single option selection and submission', () => {
    const onSubmit = vi.fn();
    render(<QuestionCard prompt={singleSelectPrompt} onSubmit={onSubmit} />);

    const zustandBtn = screen.getByText('Zustand');
    fireEvent.click(zustandBtn);

    const submitBtn = screen.getByText('送出回答');
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledWith('call_q_1', ['Zustand'], undefined);
  });

  it('handles multi-option selection correctly', () => {
    const onSubmit = vi.fn();
    render(<QuestionCard prompt={multiSelectPrompt} onSubmit={onSubmit} />);

    expect(screen.getByText('可複選')).toBeInTheDocument();

    const tailwindBtn = screen.getByText('Tailwind CSS');
    const vitestBtn = screen.getByText('Vitest');

    fireEvent.click(tailwindBtn);
    fireEvent.click(vitestBtn);

    const submitBtn = screen.getByText('送出回答');
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledWith(
      'call_q_2',
      ['Tailwind CSS', 'Vitest'],
      undefined,
    );
  });

  it('supports custom text input with or without selected options', () => {
    const onSubmit = vi.fn();
    render(<QuestionCard prompt={singleSelectPrompt} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(/請輸入其他補充或特定要求/);
    fireEvent.change(input, { target: { value: '請優先考慮包大小' } });

    const submitBtn = screen.getByText('送出回答');
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledWith(
      'call_q_1',
      [],
      '請優先考慮包大小',
    );
  });

  it('submits on Enter key in custom input', () => {
    const onSubmit = vi.fn();
    render(<QuestionCard prompt={singleSelectPrompt} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(/請輸入其他補充或特定要求/);
    fireEvent.change(input, { target: { value: 'MobX' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('call_q_1', [], 'MobX');
  });
});
