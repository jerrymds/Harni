import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CheckpointInfo, WorktreeStatusInfo } from '@harni/types';

const execFileAsync = promisify(execFile);

export interface CheckpointRecord extends CheckpointInfo {
  workspaceRoot: string;
  dirtyFilesBefore?: string[];
  untrackedFilesBefore?: string[];
}

export interface ActiveWorktreeRecord {
  sessionId: string;
  workspaceRoot: string;
  worktreePath: string;
  branch: string;
  createdAt: number;
}

export class GitCheckpointService {
  private checkpoints = new Map<string, CheckpointRecord>();
  private activeWorktrees = new Map<string, ActiveWorktreeRecord>();
  private excludedRoots = new Set<string>();
  public maxRetainedCheckpoints: number = 5;

  /**
   * Low-level Git command execution, isolated for testability and custom environment overrides
   */
  public async executeGit(
    args: string[],
    options: {
      cwd: string;
      timeout: number;
      windowsHide: boolean;
      maxBuffer: number;
    },
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, options);
  }

  /**
   * Run a Git command in the specified directory
   */
  public async runGit(
    args: string[],
    cwd: string,
    timeoutMs: number = 60000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await this.executeGit(args, {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: unknown) {
      const error = err as {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        message?: string;
        killed?: boolean;
        signal?: string;
      };
      const isTimeout =
        error.killed ||
        error.code === 'ETIMEDOUT' ||
        error.signal === 'SIGTERM' ||
        Boolean(error.message && error.message.includes('TIMEDOUT'));
      let stderrMsg = (error.stderr || error.message || '').trim();
      if (isTimeout) {
        const timeoutNotice = `(Git 命令執行逾時已強制終止: 超過 ${Math.round(timeoutMs / 1000)} 秒)`;
        stderrMsg = stderrMsg ? `${stderrMsg} ${timeoutNotice}` : timeoutNotice;
      }
      return {
        stdout: (error.stdout || '').trim(),
        stderr: stderrMsg,
        exitCode: typeof error.code === 'number' ? error.code : 1,
      };
    }
  }

  /**
   * Check if a directory is inside a Git repository
   */
  public async isGitRepo(workspaceRoot: string): Promise<boolean> {
    try {
      await fs.stat(path.join(workspaceRoot, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current HEAD commit hash
   */
  public async getHeadCommit(workspaceRoot: string): Promise<string> {
    const { stdout, exitCode } = await this.runGit(['rev-parse', 'HEAD'], workspaceRoot);
    if (exitCode === 0 && stdout) {
      return stdout;
    }
    return '';
  }

  /**
   * Get the current branch name (or HEAD if detached)
   */
  public async getCurrentBranch(workspaceRoot: string): Promise<string> {
    const { stdout, exitCode } = await this.runGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      workspaceRoot,
    );
    if (exitCode === 0 && stdout) {
      return stdout;
    }
    return 'HEAD';
  }

  /**
   * Get uncommitted and untracked file statuses
   */
  public async getStatus(
    workspaceRoot: string,
  ): Promise<{ isDirty: boolean; files: string[]; untracked: string[] }> {
    const { stdout, exitCode } = await this.runGit(
      ['status', '--porcelain=v1', '.'],
      workspaceRoot,
      10000,
    );
    if (exitCode !== 0 || !stdout) {
      return { isDirty: false, files: [], untracked: [] };
    }

    const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
    const files: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const status = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      if (status.includes('?')) {
        untracked.push(filePath);
      } else {
        files.push(filePath);
      }
    }

    return {
      isDirty: files.length > 0 || untracked.length > 0,
      files,
      untracked,
    };
  }

  /**
   * Ensure .cline-worktrees is ignored locally via .git/info/exclude
   */
  public async ensureGitExclude(workspaceRoot: string): Promise<void> {
    if (this.excludedRoots.has(workspaceRoot)) return;
    this.excludedRoots.add(workspaceRoot);
    try {
      const gitDirRes = await this.runGit(['rev-parse', '--git-dir'], workspaceRoot);
      if (gitDirRes.exitCode !== 0) return;
      const gitDir = path.resolve(workspaceRoot, gitDirRes.stdout);
      const excludeFile = path.join(gitDir, 'info', 'exclude');
      let content = '';
      try {
        content = await fs.readFile(excludeFile, 'utf-8');
      } catch {
        // file doesn't exist yet, create info dir
        await fs.mkdir(path.join(gitDir, 'info'), { recursive: true });
      }

      if (!content.includes('.cline-worktrees')) {
        content += '\n# Cline Web Worktrees\n.cline-worktrees\n.cline-worktrees/**\n.cline/snapshots\n';
        await fs.writeFile(excludeFile, content, 'utf-8');
      }
    } catch {
      // safe to ignore
    }
  }

  /**
   * Create a Checkpoint snapshot before an Agent task executes
   */
  public async createCheckpoint(
    workspaceRoot: string,
    options: {
      sessionId: string;
      taskId?: string;
      description?: string;
      isWorktree?: boolean;
      worktreeBranch?: string;
      worktreePath?: string;
    },
  ): Promise<CheckpointInfo> {
    const id = `ckpt_${options.sessionId}_${Date.now()}`;
    const isGit = await this.isGitRepo(workspaceRoot);
    let commitHash = '';
    let stashRef: string | undefined;
    let dirtyFilesBefore: string[] = [];
    let untrackedFilesBefore: string[] = [];

    if (isGit) {
      await this.ensureGitExclude(workspaceRoot);
      commitHash = await this.getHeadCommit(workspaceRoot);
      const status = await this.getStatus(workspaceRoot);
      dirtyFilesBefore = status.files;
      untrackedFilesBefore = status.untracked;

      if (status.isDirty) {
        // Create a dangling stash commit without clearing the working directory
        const stashRes = await this.runGit(
          ['stash', 'create', `cline-checkpoint-${id}`],
          workspaceRoot,
        );
        if (stashRes.exitCode === 0 && stashRes.stdout) {
          stashRef = stashRes.stdout;
          // Store a dedicated lightweight reference in refs/cline/checkpoints/
          await this.runGit(
            ['update-ref', `refs/cline/checkpoints/${id}`, stashRef],
            workspaceRoot,
          );
        }
      }

      // If no stashRef was needed, update ref to HEAD
      if (!stashRef && commitHash) {
        await this.runGit(
          ['update-ref', `refs/cline/checkpoints/${id}`, commitHash],
          workspaceRoot,
        );
      }
    } else {
      // Non-git fallback: create an in-memory or snapshot record
      commitHash = 'non-git-snapshot';
    }

    const checkpoint: CheckpointRecord = {
      id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      createdAt: Date.now(),
      description: options.description || `Task Checkpoint (${new Date().toLocaleTimeString()})`,
      commitHash,
      isWorktree: !!options.isWorktree,
      worktreeBranch: options.worktreeBranch,
      worktreePath: options.worktreePath,
      stashRef,
      workspaceRoot,
      dirtyFilesBefore,
      untrackedFilesBefore,
      filesCount: dirtyFilesBefore.length + untrackedFilesBefore.length,
    };

    this.checkpoints.set(id, checkpoint);

    // Automatically prune older checkpoints to enforce LRU retention limit
    try {
      await this.pruneCheckpoints(workspaceRoot);
    } catch {
      // Safe to ignore pruning failure during creation
    }

    return this.toCheckpointInfo(checkpoint);
  }

  /**
   * Rollback / Restore workspace to the specified Checkpoint
   */
  public async rollbackCheckpoint(
    workspaceRoot: string,
    checkpointId?: string,
  ): Promise<{ success: boolean; message: string }> {
    let checkpoint: CheckpointRecord | undefined;

    if (checkpointId) {
      checkpoint = this.checkpoints.get(checkpointId);
    } else {
      // Find the most recent checkpoint for this workspace
      const all = Array.from(this.checkpoints.values()).filter(
        (c) => path.resolve(c.workspaceRoot) === path.resolve(workspaceRoot),
      );
      checkpoint = all.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    if (!checkpoint) {
      return { success: false, message: `找不到 Checkpoint 快照: ${checkpointId || '(最新)'}` };
    }

    // If this checkpoint is associated with an active worktree, discard the worktree
    if (checkpoint.isWorktree && checkpoint.worktreePath) {
      await this.discardWorktree(workspaceRoot, checkpoint.sessionId);
      return {
        success: true,
        message: `已成功捨棄 Worktree 隔離分支並還原主工作區狀態 (${checkpoint.id})`,
      };
    }

    const isGit = await this.isGitRepo(workspaceRoot);
    if (!isGit) {
      return {
        success: true,
        message: `非 Git 專案工作區還原完成 (${checkpoint.id})`,
      };
    }

    try {
      // 1. Reset tracked files to the base commit
      if (checkpoint.commitHash && checkpoint.commitHash !== 'non-git-snapshot') {
        const resetRes = await this.runGit(
          ['reset', '--hard', checkpoint.commitHash],
          workspaceRoot,
          120000,
        );
        if (resetRes.exitCode !== 0) {
          throw new Error(`Git reset failed: ${resetRes.stderr}`);
        }
      }

      // 2. Clean newly created untracked files that did not exist before checkpoint
      const currentStatus = await this.getStatus(workspaceRoot);
      const untrackedBeforeSet = new Set(checkpoint.untrackedFilesBefore || []);

      for (const untrackedFile of currentStatus.untracked) {
        if (!untrackedBeforeSet.has(untrackedFile)) {
          const absPath = path.join(workspaceRoot, untrackedFile);
          try {
            await fs.rm(absPath, { recursive: true, force: true });
          } catch {
            // ignore cleanup error
          }
        }
      }

      // 3. If there was a stashRef for dirty uncommitted state before task, restore it
      if (checkpoint.stashRef) {
        // Try restoring stash contents
        const restoreRes = await this.runGit(
          ['checkout', checkpoint.stashRef, '--', '.'],
          workspaceRoot,
        );
        if (restoreRes.exitCode !== 0) {
          // Fallback to stash apply
          await this.runGit(['stash', 'apply', checkpoint.stashRef], workspaceRoot);
        }
      }

      return {
        success: true,
        message: `已成功將工作區還原至任務前狀態 (Checkpoint: ${checkpoint.id})`,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `還原失敗: ${errMsg}`,
      };
    }
  }

  /**
   * Create an isolated Git Worktree for a session
   */
  public async createWorktree(
    workspaceRoot: string,
    sessionId: string,
    baseCommit?: string,
    options?: { timeoutMs?: number },
  ): Promise<{ worktreePath: string; branch: string }> {
    const isGit = await this.isGitRepo(workspaceRoot);
    if (!isGit) {
      throw new Error(`無法建立 Git Worktree: 目錄不是 Git 儲存庫 (${workspaceRoot})`);
    }

    await this.ensureGitExclude(workspaceRoot);

    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branch = `cline/task-${safeSessionId}`;
    const worktreesDir = path.join(workspaceRoot, '.cline-worktrees');
    await fs.mkdir(worktreesDir, { recursive: true });

    const worktreePath = path.join(worktreesDir, safeSessionId);

    // Prune stale worktrees first to clean up orphaned references
    await this.runGit(['worktree', 'prune'], workspaceRoot);

    // If an existing worktree is at this path, remove it first
    try {
      await fs.access(worktreePath);
      await this.runGit(['worktree', 'remove', '--force', worktreePath], workspaceRoot, 60000);
      await fs.rm(worktreePath, { recursive: true, force: true });
      await this.runGit(['worktree', 'prune'], workspaceRoot);
    } catch {
      // not existing, proceed
    }

    // Check if branch already exists and delete it
    await this.runGit(['branch', '-D', branch], workspaceRoot);

    // Add worktree (default 180s timeout to allow large repositories with 10k+ files on Windows)
    const commitTarget = baseCommit || 'HEAD';
    const worktreeTimeout = options?.timeoutMs ?? 180000;
    const addRes = await this.runGit(
      ['worktree', 'add', '-b', branch, worktreePath, commitTarget],
      workspaceRoot,
      worktreeTimeout,
    );

    if (addRes.exitCode !== 0) {
      // Clean up partially created worktree and branch on failure
      try {
        await this.runGit(['worktree', 'remove', '--force', worktreePath], workspaceRoot, 60000);
        await fs.rm(worktreePath, { recursive: true, force: true });
        await this.runGit(['worktree', 'prune'], workspaceRoot);
        await this.runGit(['branch', '-D', branch], workspaceRoot);
      } catch {
        // ignore cleanup error
      }
      throw new Error(`Git worktree add 失敗: ${addRes.stderr || addRes.stdout}`);
    }

    // Link dependencies (node_modules, .venv, .env) via junctions / symlinks
    await this.linkDependencies(workspaceRoot, worktreePath);

    const record: ActiveWorktreeRecord = {
      sessionId,
      workspaceRoot,
      worktreePath,
      branch,
      createdAt: Date.now(),
    };
    this.activeWorktrees.set(sessionId, record);

    return { worktreePath, branch };
  }

  /**
   * Link node_modules, .venv, and copy .env into worktree for instant zero-overhead testing
   */
  private async linkDependencies(sourceRoot: string, worktreePath: string): Promise<void> {
    const isWin = process.platform === 'win32';

    // 1. node_modules
    const sourceNodeModules = path.join(sourceRoot, 'node_modules');
    const targetNodeModules = path.join(worktreePath, 'node_modules');
    try {
      const stat = await fs.stat(sourceNodeModules);
      if (stat.isDirectory()) {
        try {
          await fs.symlink(
            sourceNodeModules,
            targetNodeModules,
            isWin ? 'junction' : 'dir',
          );
        } catch {
          // Ignore if link already exists or platform restricts
        }
      }
    } catch {
      // node_modules does not exist in root
    }

    // 2. .venv / venv
    for (const venvDir of ['.venv', 'venv']) {
      const sourceVenv = path.join(sourceRoot, venvDir);
      const targetVenv = path.join(worktreePath, venvDir);
      try {
        const stat = await fs.stat(sourceVenv);
        if (stat.isDirectory()) {
          try {
            await fs.symlink(
              sourceVenv,
              targetVenv,
              isWin ? 'junction' : 'dir',
            );
          } catch {
            // ignore
          }
        }
      } catch {
        // venv doesn't exist
      }
    }

    // 3. .env
    const sourceEnv = path.join(sourceRoot, '.env');
    const targetEnv = path.join(worktreePath, '.env');
    try {
      await fs.copyFile(sourceEnv, targetEnv);
    } catch {
      // .env doesn't exist
    }
  }

  /**
   * Merge isolated Worktree changes back into main workspace branch
   */
  public async mergeWorktree(
    workspaceRoot: string,
    sessionId: string,
    commitMessage?: string,
  ): Promise<{ success: boolean; message: string }> {
    const record = this.activeWorktrees.get(sessionId);
    if (!record) {
      return { success: false, message: `找不到 Session ${sessionId} 的活動 Worktree` };
    }

    const { worktreePath, branch } = record;

    try {
      // 1. In worktree: commit any uncommitted changes made by Agent
      const statusRes = await this.getStatus(worktreePath);
      if (statusRes.isDirty) {
        await this.runGit(['add', '-A'], worktreePath, 120000);
        const msg = commitMessage || `cline: completed task in session ${sessionId}`;
        await this.runGit(['commit', '-m', msg], worktreePath, 60000);
      }

      // 2. In main workspaceRoot: merge the worktree branch
      const mergeRes = await this.runGit(['merge', branch, '--no-edit'], workspaceRoot, 120000);
      if (mergeRes.exitCode !== 0) {
        throw new Error(`合併至主工作區失敗: ${mergeRes.stderr || mergeRes.stdout}`);
      }

      // 3. Clean up worktree and delete the temporary branch
      await this.cleanupWorktree(record);
      this.activeWorktrees.delete(sessionId);

      return {
        success: true,
        message: `已成功將 Worktree 分支 (${branch}) 合併至主工作區並完成清理！`,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Worktree 合併失敗: ${errMsg}`,
      };
    }
  }

  /**
   * Discard isolated Worktree without touching main workspace
   */
  public async discardWorktree(
    workspaceRoot: string,
    sessionId: string,
  ): Promise<{ success: boolean; message: string }> {
    const record = this.activeWorktrees.get(sessionId);
    if (!record) {
      // Check if worktree directory exists anyway
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const worktreePath = path.join(workspaceRoot, '.cline-worktrees', safeSessionId);
      try {
        await this.runGit(['worktree', 'remove', '--force', worktreePath], workspaceRoot, 60000);
        await fs.rm(worktreePath, { recursive: true, force: true });
        await this.runGit(['worktree', 'prune'], workspaceRoot);
      } catch {
        // ignore
      }
      return { success: true, message: `已清理 Worktree` };
    }

    try {
      await this.cleanupWorktree(record);
      this.activeWorktrees.delete(sessionId);
      return {
        success: true,
        message: `已捨棄 Worktree 分支 (${record.branch})，主工作區保持不變。`,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `捨棄 Worktree 失敗: ${errMsg}`,
      };
    }
  }

  /**
   * Helper to remove worktree and delete its branch
   */
  private async cleanupWorktree(record: ActiveWorktreeRecord): Promise<void> {
    const { workspaceRoot, worktreePath, branch } = record;

    // Remove symlinked node_modules/venv first if present
    for (const sub of ['node_modules', '.venv', 'venv']) {
      const p = path.join(worktreePath, sub);
      try {
        await fs.unlink(p);
      } catch {
        // ignore
      }
    }

    // Git worktree remove
    await this.runGit(['worktree', 'remove', '--force', worktreePath], workspaceRoot, 60000);
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await this.runGit(['worktree', 'prune'], workspaceRoot);

    // Delete temporary branch
    await this.runGit(['branch', '-D', branch], workspaceRoot);
  }

  /**
   * Get active worktree info for a session
   */
  public getActiveWorktree(sessionId: string): WorktreeStatusInfo | null {
    const record = this.activeWorktrees.get(sessionId);
    if (!record) {
      return null;
    }
    return {
      sessionId,
      isWorktree: true,
      worktreePath: record.worktreePath,
      branch: record.branch,
    };
  }

  /**
   * Get all checkpoints for a workspace
   */
  public getCheckpoints(workspaceRoot?: string): CheckpointInfo[] {
    const list: CheckpointInfo[] = [];
    for (const ckpt of this.checkpoints.values()) {
      if (
        !workspaceRoot ||
        path.resolve(ckpt.workspaceRoot) === path.resolve(workspaceRoot)
      ) {
        list.push(this.toCheckpointInfo(ckpt));
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Delete a specific Checkpoint and remove its Git reference
   */
  public async deleteCheckpoint(
    workspaceRoot: string,
    checkpointId: string,
  ): Promise<boolean> {
    const ckpt = this.checkpoints.get(checkpointId);
    if (!ckpt) return false;

    const isGit = await this.isGitRepo(workspaceRoot);
    if (isGit) {
      await this.runGit(
        ['update-ref', '-d', `refs/cline/checkpoints/${checkpointId}`],
        workspaceRoot,
      );
    }

    this.checkpoints.delete(checkpointId);
    return true;
  }

  /**
   * Prune checkpoints for a workspace according to LRU retention policy
   * Keeps only the newest `maxRetained` checkpoints and deletes older ones.
   */
  public async pruneCheckpoints(
    workspaceRoot: string,
    options?: { maxRetained?: number },
  ): Promise<number> {
    const maxRetained = options?.maxRetained ?? this.maxRetainedCheckpoints;
    const normalizedRoot = path.resolve(workspaceRoot);

    const workspaceCheckpoints = Array.from(this.checkpoints.values()).filter(
      (c) => path.resolve(c.workspaceRoot) === normalizedRoot,
    );

    if (workspaceCheckpoints.length <= maxRetained) {
      return 0;
    }

    // Sort descending by createdAt (newest first)
    workspaceCheckpoints.sort((a, b) => b.createdAt - a.createdAt);

    const staleCheckpoints = workspaceCheckpoints.slice(maxRetained);
    let deletedCount = 0;

    for (const ckpt of staleCheckpoints) {
      const ok = await this.deleteCheckpoint(workspaceRoot, ckpt.id);
      if (ok) deletedCount++;
    }

    return deletedCount;
  }

  /**
   * Scan and prune orphaned/stale cline/task-* worktree branches and unlinked directories
   */
  public async pruneStaleBranches(workspaceRoot: string): Promise<string[]> {
    const isGit = await this.isGitRepo(workspaceRoot);
    if (!isGit) return [];

    const prunedBranches: string[] = [];

    // 1. Prune git worktree administrative metadata
    await this.runGit(['worktree', 'prune'], workspaceRoot);

    // 2. Query all local branches matching cline/task-*
    const branchRes = await this.runGit(
      ['branch', '--list', 'cline/task-*'],
      workspaceRoot,
    );

    if (branchRes.exitCode === 0 && branchRes.stdout) {
      const branches = branchRes.stdout
        .split('\n')
        .map((b) => b.replace(/^\*?\s+/, '').trim())
        .filter((b) => b.startsWith('cline/task-'));

      const activeBranchSet = new Set(
        Array.from(this.activeWorktrees.values()).map((w) => w.branch),
      );

      for (const branch of branches) {
        // If not in activeWorktrees, it is considered stale / orphaned!
        if (!activeBranchSet.has(branch)) {
          const sessionId = branch.replace(/^cline\/task-/, '');
          const worktreeDir = path.join(workspaceRoot, '.cline-worktrees', sessionId);
          try {
            await this.runGit(['worktree', 'remove', '--force', worktreeDir], workspaceRoot, 10000);
            await fs.rm(worktreeDir, { recursive: true, force: true });
          } catch {
            // ignore
          }

          const delRes = await this.runGit(['branch', '-D', branch], workspaceRoot);
          if (delRes.exitCode === 0) {
            prunedBranches.push(branch);
          }
        }
      }
    }

    // 3. Clean up any empty/unregistered directories in .cline-worktrees
    try {
      const worktreesDir = path.join(workspaceRoot, '.cline-worktrees');
      const entries = await fs.readdir(worktreesDir, { withFileTypes: true });
      const activePaths = new Set(
        Array.from(this.activeWorktrees.values()).map((w) => path.resolve(w.worktreePath)),
      );
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.resolve(worktreesDir, entry.name);
          if (!activePaths.has(fullPath)) {
            try {
              await fs.rm(fullPath, { recursive: true, force: true });
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // .cline-worktrees does not exist, ignore
    }

    await this.runGit(['worktree', 'prune'], workspaceRoot);
    return prunedBranches;
  }

  /**
   * Delete all checkpoints and discard any worktree/branch for a specific session
   */
  public async deleteSessionCheckpoints(
    workspaceRoot: string,
    sessionId: string,
  ): Promise<{ deletedCheckpoints: number; deletedBranches: string[] }> {
    const isGit = await this.isGitRepo(workspaceRoot);
    let deletedCheckpoints = 0;
    const deletedBranches: string[] = [];

    // 1. Delete all checkpoints matching this sessionId
    const sessionCkpts = Array.from(this.checkpoints.values()).filter(
      (c) => c.sessionId === sessionId,
    );

    for (const ckpt of sessionCkpts) {
      if (isGit) {
        await this.runGit(
          ['update-ref', '-d', `refs/cline/checkpoints/${ckpt.id}`],
          workspaceRoot,
        );
      }
      this.checkpoints.delete(ckpt.id);
      deletedCheckpoints++;
    }

    // 2. Discard active worktree if present
    if (this.activeWorktrees.has(sessionId)) {
      await this.discardWorktree(workspaceRoot, sessionId);
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      deletedBranches.push(`cline/task-${safeSessionId}`);
    } else if (isGit) {
      // Also check if an orphaned branch exists for this session
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const branch = `cline/task-${safeSessionId}`;
      const branchRes = await this.runGit(['branch', '--list', branch], workspaceRoot);
      if (branchRes.exitCode === 0 && branchRes.stdout.includes(branch)) {
        const worktreeDir = path.join(workspaceRoot, '.cline-worktrees', safeSessionId);
        try {
          await this.runGit(['worktree', 'remove', '--force', worktreeDir], workspaceRoot, 10000);
          await fs.rm(worktreeDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        await this.runGit(['branch', '-D', branch], workspaceRoot);
        deletedBranches.push(branch);
      }
    }

    if (isGit) {
      await this.runGit(['worktree', 'prune'], workspaceRoot);
    }

    return { deletedCheckpoints, deletedBranches };
  }

  /**
   * Convert internal record to external info
   */
  private toCheckpointInfo(record: CheckpointRecord): CheckpointInfo {
    return {
      id: record.id,
      sessionId: record.sessionId,
      taskId: record.taskId,
      createdAt: record.createdAt,
      description: record.description,
      commitHash: record.commitHash,
      isWorktree: record.isWorktree,
      worktreeBranch: record.worktreeBranch,
      worktreePath: record.worktreePath,
      filesCount: record.filesCount,
      filesModified: record.filesModified,
      stashRef: record.stashRef,
    };
  }
}

