import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BranchDropdown } from './BranchDropdown.js';
import { useAgentStore } from '../../store/useAgentStore.js';

describe('BranchDropdown Component', () => {
  const mockBranches = [
    { name: 'main', current: true, commit: 'a1b2c3d' },
    { name: 'dev', current: false, commit: 'e4f5g6h' },
    { name: 'feature/auth', current: false },
  ];

  let switchBranchMock: any;
  let fetchBranchesMock: any;

  beforeEach(() => {
    switchBranchMock = vi.fn().mockResolvedValue({ success: true, message: 'OK' });
    fetchBranchesMock = vi.fn().mockResolvedValue(undefined);

    useAgentStore.setState({
      currentSessionId: 'test_session',
      branches: mockBranches,
      currentBranch: 'main',
      isLoadingBranches: false,
      isSwitchingBranch: false,
      workspaceInfo: {
        rootPath: '/test/workspace',
        totalFiles: 10,
        isGitRepo: true,
        branch: 'main',
      },
      activeWorktrees: {},
      fetchBranches: fetchBranchesMock,
      switchBranch: switchBranchMock,
    });
  });

  it('renders trigger button with current branch name', () => {
    render(<BranchDropdown />);
    const trigger = screen.getByTestId('branch-dropdown-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('main');
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens menu on click and lists branches, and filters with search input', () => {
    render(<BranchDropdown />);
    const trigger = screen.getByTestId('branch-dropdown-trigger');
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(fetchBranchesMock).toHaveBeenCalled();
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByText('Git 分支 (Branches)')).toBeInTheDocument();
    expect(within(menu).getByText('3 個分支')).toBeInTheDocument();

    // All branches visible in menu
    expect(within(menu).getByText('main')).toBeInTheDocument();
    expect(within(menu).getByText('dev')).toBeInTheDocument();
    expect(within(menu).getByText('feature/auth')).toBeInTheDocument();

    // Filter using search
    const searchInput = within(menu).getByPlaceholderText('搜尋或輸入新分支名稱...');
    fireEvent.change(searchInput, { target: { value: 'auth' } });

    expect(within(menu).getByText('feature/auth')).toBeInTheDocument();
    expect(within(menu).queryByText('dev')).not.toBeInTheDocument();
    expect(within(menu).queryByText('main')).not.toBeInTheDocument();
  });

  it('selecting an existing branch calls switchBranch(name, { create: false }) and closes menu on success', async () => {
    render(<BranchDropdown />);
    fireEvent.click(screen.getByTestId('branch-dropdown-trigger'));

    const menu = screen.getByRole('menu');
    const devBtn = within(menu).getByText('dev');
    fireEvent.click(devBtn);

    expect(switchBranchMock).toHaveBeenCalledWith('dev', { create: false });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('typing a non-existent branch name shows "建立並切換至..." button and calls switchBranch(name, { create: true })', async () => {
    render(<BranchDropdown />);
    fireEvent.click(screen.getByTestId('branch-dropdown-trigger'));

    const menu = screen.getByRole('menu');
    const searchInput = within(menu).getByPlaceholderText('搜尋或輸入新分支名稱...');
    fireEvent.change(searchInput, { target: { value: 'feature/new-one' } });

    const createBtn = within(menu).getByText(/建立並切換至/);
    expect(createBtn).toBeInTheDocument();
    expect(within(menu).getByText('feature/new-one')).toBeInTheDocument();

    fireEvent.click(createBtn);
    expect(switchBranchMock).toHaveBeenCalledWith('feature/new-one', { create: true });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('displays error message when switchBranch returns { success: false, message: ... }', async () => {
    switchBranchMock.mockResolvedValueOnce({
      success: false,
      message: 'Checkout conflict: please commit your changes',
    });

    render(<BranchDropdown />);
    fireEvent.click(screen.getByTestId('branch-dropdown-trigger'));

    const menu = screen.getByRole('menu');
    const devBtn = within(menu).getByText('dev');
    fireEvent.click(devBtn);

    await waitFor(() => {
      expect(within(menu).getByText('Checkout conflict: please commit your changes')).toBeInTheDocument();
    });
    // Menu remains open to show error
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes menu on Escape key and on clicking outside', () => {
    render(
      <div>
        <div data-testid="outside-element">Outside</div>
        <BranchDropdown />
      </div>
    );

    const trigger = screen.getByTestId('branch-dropdown-trigger');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Test Escape key
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    // Reopen and test click outside
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside-element'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders disabled state when workspaceInfo.isGitRepo is false', () => {
    useAgentStore.setState({
      workspaceInfo: {
        rootPath: '/test/non-git',
        totalFiles: 2,
        isGitRepo: false,
      },
    });

    render(<BranchDropdown />);
    const trigger = screen.getByTestId('branch-dropdown-trigger');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('非 Git 儲存庫');

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders worktree branch if active worktree is active for current session', () => {
    useAgentStore.setState({
      currentSessionId: 'sess_wt',
      activeWorktrees: {
        sess_wt: {
          isWorktree: true,
          branch: 'cline/task-wt-branch',
          path: '/test/worktree',
        },
      },
    });

    render(<BranchDropdown />);
    const trigger = screen.getByTestId('branch-dropdown-trigger');
    expect(trigger).toHaveTextContent('cline/task-wt-branch');
  });

  it('disables refresh button when isLoadingBranches is true and focuses search input', () => {
    useAgentStore.setState({ isLoadingBranches: true });
    render(<BranchDropdown />);
    fireEvent.click(screen.getByTestId('branch-dropdown-trigger'));

    const refreshBtn = screen.getByRole('button', { name: '重新整理分支清單' });
    expect(refreshBtn).toBeDisabled();

    const searchInput = screen.getByPlaceholderText('搜尋或輸入新分支名稱...');
    expect(searchInput).toHaveFocus();
  });
});
