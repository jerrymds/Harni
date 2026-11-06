import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeftSidebar } from './LeftSidebar.js';
import { useAgentStore } from '../../store/useAgentStore.js';

describe('LeftSidebar Component', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ sessions: [], folders: [] }), { status: 200 });
    });

    useAgentStore.setState({
      folders: [
        { id: 'folder_default', name: '預設目錄', path: '/test/path', createdAt: 0, isCollapsed: false },
      ],
      activeFolderId: 'folder_default',
      sessions: [
        {
          id: 'sess_1',
          folderId: 'folder_default',
          title: '對話一',
          status: 'idle',
          messages: [],
          messageCount: 0,
          mode: 'code',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      currentSessionId: 'sess_1',
      fileTree: [
        { name: 'src', path: 'src', type: 'directory', children: [] },
      ],
    });
  });

  it('renders tab buttons for Sessions and Files and defaults to Sessions', () => {
    render(<LeftSidebar />);

    expect(screen.getByRole('button', { name: /對話歷史/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /專案檔案/i })).toBeInTheDocument();

    // Default sessions tab is visible
    expect(screen.getByText('新增專案目錄')).toBeInTheDocument();
    expect(screen.getByText('預設目錄')).toBeInTheDocument();
  });

  it('switches to Files tab and renders FileTree when clicking 專案檔案', () => {
    render(<LeftSidebar />);

    const filesTabBtn = screen.getByRole('button', { name: /專案檔案/i });
    fireEvent.click(filesTabBtn);

    // FileTree should be rendered with src
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();

    // Sessions should not be visible
    expect(screen.queryByText('新增專案目錄')).not.toBeInTheDocument();

    // Switch back to Sessions
    const sessionsTabBtn = screen.getByRole('button', { name: /對話歷史/i });
    fireEvent.click(sessionsTabBtn);

    expect(screen.getByText('新增專案目錄')).toBeInTheDocument();
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });
});
