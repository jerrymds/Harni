import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileTree } from './FileTree.js';
import { useAgentStore } from '../../store/useAgentStore.js';
import type { FileNode } from '@harni/types';

describe('FileTree Component', () => {
  beforeEach(() => {
    useAgentStore.setState({
      fileTree: [],
      activeFile: null,
    });
  });

  it('renders empty workspace placeholder when fileTree is empty', () => {
    render(<FileTree />);
    expect(screen.getByText('No files in workspace')).toBeInTheDocument();
  });

  it('renders directory hierarchy and handles file click', () => {
    const mockOpenFile = vi.fn();
    useAgentStore.setState({ openFile: mockOpenFile });

    const mockTree: FileNode[] = [
      {
        name: 'src',
        path: 'src',
        type: 'directory',
        children: [
          {
            name: 'App.tsx',
            path: 'src/App.tsx',
            type: 'file',
          },
          {
            name: 'utils.ts',
            path: 'src/utils.ts',
            type: 'file',
          },
        ],
      },
      {
        name: 'package.json',
        path: 'package.json',
        type: 'file',
      },
    ];

    useAgentStore.setState({ fileTree: mockTree });

    render(<FileTree />);
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();

    const appFile = screen.getByText('App.tsx');
    fireEvent.click(appFile);

    expect(mockOpenFile).toHaveBeenCalledWith('src/App.tsx');
  });

  it('toggles directory collapse when clicked', () => {
    const mockTree: FileNode[] = [
      {
        name: 'components',
        path: 'components',
        type: 'directory',
        children: [
          {
            name: 'Header.tsx',
            path: 'components/Header.tsx',
            type: 'file',
          },
        ],
      },
    ];

    useAgentStore.setState({ fileTree: mockTree });
    render(<FileTree />);

    expect(screen.getByText('Header.tsx')).toBeInTheDocument();

    // Click directory to collapse
    const dirNode = screen.getByText('components');
    fireEvent.click(dirNode);

    // After collapsing, child should no longer be visible
    expect(screen.queryByText('Header.tsx')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(dirNode);
    expect(screen.getByText('Header.tsx')).toBeInTheDocument();
  });

  it('triggers loadDirectory when expanding a lazy-loaded directory (children === undefined)', () => {
    const mockLoadDirectory = vi.fn();
    useAgentStore.setState({ loadDirectory: mockLoadDirectory });

    const mockTree: FileNode[] = [
      {
        name: 'lazy_folder',
        path: 'lazy_folder',
        type: 'directory',
        // children undefined
      },
    ];

    useAgentStore.setState({ fileTree: mockTree });
    render(<FileTree />);

    const dirNode = screen.getByText('lazy_folder');
    fireEvent.click(dirNode);

    expect(mockLoadDirectory).toHaveBeenCalledWith('lazy_folder');
  });
});
