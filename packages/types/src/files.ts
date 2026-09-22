/**
 * File tree item types
 */
export type FileNodeType = 'file' | 'directory';

/**
 * File tree node representation for File Explorer
 */
export interface FileNode {
  name: string;
  path: string;
  type: FileNodeType;
  size?: number;
  lastModified?: number;
  children?: FileNode[];
}

/**
 * Single diff hunk structure
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * File Diff payload for Monaco Diff Editor
 */
export interface FileDiff {
  path: string;
  originalContent: string;
  newContent: string;
  isNewFile?: boolean;
  isDeleted?: boolean;
  hunks?: DiffHunk[];
}

/**
 * Workspace metadata
 */
export interface WorkspaceInfo {
  rootPath: string;
  totalFiles: number;
  isGitRepo: boolean;
  branch?: string;
}

/**
 * Single file syntax or linter diagnostic issue
 */
export interface FileDiagnostic {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  source: 'syntax' | 'tsc' | 'eslint' | 'json';
  code?: string | number;
}

/**
 * File diagnostics result bundle
 */
export interface FileDiagnosticsResult {
  path: string;
  hasErrors: boolean;
  diagnostics: FileDiagnostic[];
  formattedOutput?: string;
}

/**
 * Git Checkpoint / Snapshot metadata
 */
export interface CheckpointInfo {
  id: string;
  sessionId: string;
  taskId?: string;
  createdAt: number;
  description: string;
  commitHash: string;
  isWorktree: boolean;
  worktreeBranch?: string;
  worktreePath?: string;
  filesCount?: number;
  filesModified?: string[];
  stashRef?: string;
}

/**
 * Git Worktree status information
 */
export interface WorktreeStatusInfo {
  sessionId: string;
  isWorktree: boolean;
  worktreePath?: string;
  branch?: string;
  merged?: boolean;
  discarded?: boolean;
  baseCommit?: string;
}
