import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentViewerDrawer } from './DocumentViewerDrawer.js';
import { useAgentStore } from '../../store/useAgentStore.js';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: any) => (
    <div data-testid="monaco-editor">
      <textarea
        data-testid="monaco-textarea"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  ),
  DiffEditor: ({ original, modified }: any) => (
    <div data-testid="monaco-diff-editor">
      <div data-testid="diff-original">{original}</div>
      <div data-testid="diff-modified">{modified}</div>
    </div>
  ),
}));

describe('DocumentViewerDrawer Component', () => {
  beforeEach(() => {
    useAgentStore.setState({
      isDocumentViewerOpen: false,
      documentViewerWidth: 50,
      activeFile: null,
      activeDiff: null,
      theme: 'dark',
    });
  });

  it('renders floating edge button when drawer is closed', () => {
    render(<DocumentViewerDrawer />);

    const toggleBtn = screen.getByTestId('document-viewer-toggle-btn');
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-label', '開啟文件檢視器');

    const drawer = screen.getByTestId('document-viewer-drawer');
    expect(drawer.className).toContain('translate-x-full');
    expect(drawer.className).toContain('pointer-events-none');
  });

  it('opens drawer when floating edge button is clicked', () => {
    render(<DocumentViewerDrawer />);

    const toggleBtn = screen.getByTestId('document-viewer-toggle-btn');
    fireEvent.click(toggleBtn);

    expect(useAgentStore.getState().isDocumentViewerOpen).toBe(true);
  });

  it('renders open drawer and hides edge button when isDocumentViewerOpen is true', () => {
    useAgentStore.setState({ isDocumentViewerOpen: true, documentViewerWidth: 50 });
    render(<DocumentViewerDrawer />);

    expect(screen.queryByTestId('document-viewer-toggle-btn')).not.toBeInTheDocument();

    const drawer = screen.getByTestId('document-viewer-drawer');
    expect(drawer.className).toContain('translate-x-0');
    expect(drawer.className).not.toContain('translate-x-full');
    expect(drawer.className).toContain('md:w-[50%]');
  });

  it('applies 80% width class when documentViewerWidth is 80', () => {
    useAgentStore.setState({ isDocumentViewerOpen: true, documentViewerWidth: 80 });
    render(<DocumentViewerDrawer />);

    const drawer = screen.getByTestId('document-viewer-drawer');
    expect(drawer.className).toContain('md:w-[80%]');
  });

  it('toggles width between 50% and 80% when clicking width button', () => {
    useAgentStore.setState({ isDocumentViewerOpen: true, documentViewerWidth: 50 });
    render(<DocumentViewerDrawer />);

    const widthBtn = screen.getByRole('button', { name: /展開寬度/i });
    fireEvent.click(widthBtn);
    expect(useAgentStore.getState().documentViewerWidth).toBe(80);

    const restoreBtn = screen.getByRole('button', { name: /還原寬度/i });
    fireEvent.click(restoreBtn);
    expect(useAgentStore.getState().documentViewerWidth).toBe(50);
  });

  it('closes drawer when clicking close drawer button', () => {
    useAgentStore.setState({ isDocumentViewerOpen: true });
    render(<DocumentViewerDrawer />);

    const closeBtn = screen.getByRole('button', { name: /關閉檢視器/i });
    fireEvent.click(closeBtn);
    expect(useAgentStore.getState().isDocumentViewerOpen).toBe(false);
  });

  it('renders active file with filename, save button, and handles saving', () => {
    const mockSaveActiveFile = vi.fn();
    useAgentStore.setState({
      isDocumentViewerOpen: true,
      activeFile: { path: 'src/components/Test.tsx', content: 'const a = 1;' },
      saveActiveFile: mockSaveActiveFile,
    });

    render(<DocumentViewerDrawer />);

    expect(screen.getByText('Test.tsx')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();

    const saveBtn = screen.getByRole('button', { name: /儲存/i });
    expect(saveBtn).toBeInTheDocument();
    fireEvent.click(saveBtn);
    expect(mockSaveActiveFile).toHaveBeenCalledWith('const a = 1;');
  });

  it('closes active file when clicking file close button', () => {
    const mockCloseActiveFile = vi.fn();
    useAgentStore.setState({
      isDocumentViewerOpen: true,
      activeFile: { path: 'src/index.ts', content: 'code' },
      closeActiveFile: mockCloseActiveFile,
    });

    render(<DocumentViewerDrawer />);

    const closeFileBtn = screen.getByRole('button', { name: /關閉檔案/i });
    fireEvent.click(closeFileBtn);
    expect(mockCloseActiveFile).toHaveBeenCalledTimes(1);
  });

  it('renders active diff view and handles closing diff review', () => {
    const mockSetActiveDiff = vi.fn();
    useAgentStore.setState({
      isDocumentViewerOpen: true,
      activeDiff: {
        path: 'src/App.tsx',
        originalContent: 'old code',
        newContent: 'new code',
        isNewFile: true,
      },
      setActiveDiff: mockSetActiveDiff,
    });

    render(<DocumentViewerDrawer />);

    expect(screen.getByText('src/App.tsx')).toBeInTheDocument();
    expect(screen.getByText(/新增檔案/i)).toBeInTheDocument();
    expect(screen.getByTestId('monaco-diff-editor')).toBeInTheDocument();

    const doneBtn = screen.getByRole('button', { name: /關閉審查/i });
    fireEvent.click(doneBtn);
    expect(mockSetActiveDiff).toHaveBeenCalledWith(null);
  });

  it('renders empty canvas state when no file or diff is open', () => {
    useAgentStore.setState({
      isDocumentViewerOpen: true,
      activeFile: null,
      activeDiff: null,
    });

    render(<DocumentViewerDrawer />);

    expect(screen.getByText('Coding Agent 工作畫布')).toBeInTheDocument();
    expect(screen.getByText(/從左側「專案檔案」目錄選擇檔案進行檢視/i)).toBeInTheDocument();
  });

  it('renders markdown files in preview mode by default and supports toggling between preview and code mode', () => {
    useAgentStore.setState({
      isDocumentViewerOpen: true,
      activeFile: {
        path: 'docs/SPEC.md',
        content: '# System Specification\n\nThis is the markdown **preview** body.',
      },
    });

    render(<DocumentViewerDrawer />);

    // Shows filename in tab
    expect(screen.getByText('SPEC.md')).toBeInTheDocument();

    // Defaults to preview mode
    expect(screen.getByTestId('markdown-preview-container')).toBeInTheDocument();
    expect(screen.getByText('System Specification')).toBeInTheDocument();
    expect(screen.getByText('preview')).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();

    // Both Preview and Code buttons are visible
    const previewBtn = screen.getByRole('button', { name: /^檢視$/ });
    const codeBtn = screen.getByRole('button', { name: /^原始碼$/ });
    expect(previewBtn).toBeInTheDocument();
    expect(codeBtn).toBeInTheDocument();

    // Switch to code mode
    fireEvent.click(codeBtn);
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-preview-container')).not.toBeInTheDocument();

    // Switch back to preview mode
    fireEvent.click(previewBtn);
    expect(screen.getByTestId('markdown-preview-container')).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
  });

  it('renders non-markdown files in code mode without markdown toggle buttons', () => {
    useAgentStore.setState({
      isDocumentViewerOpen: true,
      activeFile: {
        path: 'src/main.ts',
        content: 'console.log("hello");',
      },
    });

    render(<DocumentViewerDrawer />);

    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-preview-container')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^檢視$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^原始碼$/ })).not.toBeInTheDocument();
  });
});
