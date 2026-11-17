#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEPENDENCY_DIRS = ['node_modules', '.venv', 'venv'];
const EXCLUDE_PATTERNS = ['.harni-worktrees', '.harni-worktrees/**', '.harni/snapshots'];
const DEFAULT_CREATE_MAX_CHECKPOINTS = 10;
const DEFAULT_PRUNE_MAX_CHECKPOINTS = 5;
const DEFAULT_WORKTREE_TIMEOUT_MS = 180000;

const USAGE_TEXT = `git-sandbox.mjs - Cross-agent Git Checkpoint & Worktree Isolation CLI

Usage:
  node git-sandbox.mjs <command> [subcommand] [options]

Global Options:
  --workspace <dir>       Target repository directory (default: cwd)
  --json                  Output clean JSON to stdout
  -h, --help              Show this help message

Commands:
  status
      Inspect Git status, current branch/HEAD, checkpoints count, and active worktrees.

  checkpoint create [--session <id>] [--desc "<text>"] [--max <n>]
      Create a shadow Git checkpoint preserving uncommitted dirty tracked state.
      Default retention max is 10.

  checkpoint list [--session <id>]
      List stored checkpoints sorted by creation time descending.

  checkpoint rollback [--id <ckptId>] [--session <id>]
      Restore workspace to a checkpoint (or latest for session/workspace).

  checkpoint prune [--max <n>]
      Keep newest <n> checkpoints (default: 5) and delete older refs/records.

  worktree create --session <id> [--base <ref>] [--timeout <ms>]
      Create an isolated Git worktree with linked node_modules/.venv and copied .env.

  worktree list
      List active worktrees tracked in shared sandbox state.

  worktree merge --session <id> [--message "<msg>"]
      Commit dirty worktree changes, merge branch into main workspace, and clean up.

  worktree discard --session <id>
      Safely unlink dependency junctions, remove worktree, and delete branch.

  worktree prune
      Prune orphaned harni/task-* branches and stale .harni-worktrees directories.
`;

function sanitizeSessionId(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function unquoteGitPath(rawPath) {
  const trimmed = rawPath.replace(/\r$/, '');
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

async function runGit(args, cwd, timeoutMs = 60000, options = {}) {
  const { trimStdout = true } = options;
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      stdout: trimStdout ? stdout.trim() : stdout.replace(/\r?\n$/, ''),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (err) {
    const error = err || {};
    const isTimeout =
      Boolean(error.killed) ||
      error.code === 'ETIMEDOUT' ||
      error.signal === 'SIGTERM' ||
      Boolean(error.message && String(error.message).includes('TIMEDOUT'));
    let stderrMsg = String(error.stderr || error.message || '').trim();
    if (isTimeout) {
      const timeoutNotice = `(Git command timed out after ${Math.round(timeoutMs / 1000)}s)`;
      stderrMsg = stderrMsg ? `${stderrMsg} ${timeoutNotice}` : timeoutNotice;
    }
    const rawStdout = String(error.stdout || '');
    return {
      stdout: trimStdout ? rawStdout.trim() : rawStdout.replace(/\r?\n$/, ''),
      stderr: stderrMsg,
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

async function detectGitRepo(workspaceRoot) {
  const insideRes = await runGit(['rev-parse', '--is-inside-work-tree'], workspaceRoot, 10000);
  if (insideRes.exitCode !== 0 || insideRes.stdout !== 'true') {
    return { isGitRepo: false, gitCommonDir: null };
  }
  const commonRes = await runGit(['rev-parse', '--git-common-dir'], workspaceRoot, 10000);
  if (commonRes.exitCode !== 0 || !commonRes.stdout) {
    return { isGitRepo: false, gitCommonDir: null };
  }
  const gitCommonDir = path.resolve(workspaceRoot, commonRes.stdout);
  return { isGitRepo: true, gitCommonDir };
}

function getStateFilePath(gitCommonDir) {
  return path.join(gitCommonDir, 'harni-sandbox-state.json');
}

async function loadState(gitCommonDir) {
  const statePath = getStateFilePath(gitCommonDir);
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      checkpoints:
        parsed && typeof parsed.checkpoints === 'object' && parsed.checkpoints !== null
          ? parsed.checkpoints
          : {},
      activeWorktrees:
        parsed && typeof parsed.activeWorktrees === 'object' && parsed.activeWorktrees !== null
          ? parsed.activeWorktrees
          : {},
    };
  } catch {
    return { checkpoints: {}, activeWorktrees: {} };
  }
}

async function saveState(gitCommonDir, state) {
  const statePath = getStateFilePath(gitCommonDir);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

async function ensureGitExclude(gitCommonDir) {
  try {
    const infoDir = path.join(gitCommonDir, 'info');
    const excludeFile = path.join(infoDir, 'exclude');
    let content = '';
    try {
      content = await fs.readFile(excludeFile, 'utf-8');
    } catch {
      await fs.mkdir(infoDir, { recursive: true });
    }

    const existingLines = new Set(content.split(/\r?\n/).map((line) => line.trim()));
    const missing = EXCLUDE_PATTERNS.filter((pattern) => !existingLines.has(pattern));
    if (missing.length > 0) {
      const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      const header = existingLines.has('# Harni Worktrees') ? '' : '# Harni Worktrees\n';
      const addition = `${prefix}${content.length > 0 ? '\n' : ''}${header}${missing.join('\n')}\n`;
      await fs.writeFile(excludeFile, content + addition, 'utf-8');
    }
  } catch {
    // Safe to ignore exclude write errors
  }
}

async function getHeadCommit(workspaceRoot) {
  const { stdout, exitCode } = await runGit(['rev-parse', 'HEAD'], workspaceRoot, 10000);
  return exitCode === 0 ? stdout : '';
}

async function getCurrentBranch(workspaceRoot) {
  const revRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot, 10000);
  if (revRes.exitCode === 0 && revRes.stdout) {
    return revRes.stdout;
  }
  const symRes = await runGit(['symbolic-ref', '--short', 'HEAD'], workspaceRoot, 10000);
  if (symRes.exitCode === 0 && symRes.stdout) {
    return symRes.stdout;
  }
  return 'HEAD';
}

async function getStatus(workspaceRoot) {
  const { stdout, exitCode } = await runGit(
    ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-uall', '.'],
    workspaceRoot,
    15000,
    { trimStdout: false },
  );
  if (exitCode !== 0 || !stdout) {
    return { isDirty: false, files: [], untracked: [] };
  }

  const lines = stdout.split(/\r?\n/).filter((line) => line.length >= 4);
  const files = [];
  const untracked = [];

  for (const line of lines) {
    const status = line.slice(0, 2);
    let rawPath = line.slice(3);
    if ((status[0] === 'R' || status[0] === 'C') && rawPath.includes(' -> ')) {
      const parts = rawPath.split(' -> ');
      rawPath = parts[parts.length - 1];
    }
    const filePath = unquoteGitPath(rawPath);
    if (!filePath) continue;

    if (status === '??') {
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

async function safeUnlinkJunction(targetPath) {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      try {
        await fs.unlink(targetPath);
      } catch {
        await fs.rmdir(targetPath);
      }
    }
  } catch {
    // Target does not exist or cannot be unlinked
  }
}

async function unlinkWorktreeDependencies(worktreePath) {
  for (const sub of DEPENDENCY_DIRS) {
    await safeUnlinkJunction(path.join(worktreePath, sub));
  }
}

async function linkWorktreeDependencies(sourceRoot, worktreePath) {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';

  for (const dirName of DEPENDENCY_DIRS) {
    const sourceDir = path.join(sourceRoot, dirName);
    const targetDir = path.join(worktreePath, dirName);
    try {
      const stat = await fs.stat(sourceDir);
      if (stat.isDirectory()) {
        try {
          await fs.symlink(sourceDir, targetDir, linkType);
        } catch {
          // Ignore if link already exists or platform restricts symlinks
        }
      }
    } catch {
      // Source directory does not exist
    }
  }

  const sourceEnv = path.join(sourceRoot, '.env');
  const targetEnv = path.join(worktreePath, '.env');
  try {
    await fs.copyFile(sourceEnv, targetEnv);
  } catch {
    // .env does not exist
  }
}

async function removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch) {
  await unlinkWorktreeDependencies(worktreePath);
  await runGit(['worktree', 'remove', '--force', worktreePath], workspaceRoot, 60000);
  try {
    await fs.rm(worktreePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
  await runGit(['worktree', 'prune'], workspaceRoot, 15000);
  if (branch) {
    await runGit(['branch', '-D', branch], workspaceRoot, 15000);
  }
}

async function pruneCheckpointsInState(workspaceRoot, state, maxRetained) {
  const all = Object.values(state.checkpoints).sort((a, b) => b.createdAt - a.createdAt);
  if (all.length <= maxRetained) {
    return 0;
  }

  const stale = all.slice(maxRetained);
  let deletedCount = 0;

  for (const ckpt of stale) {
    await runGit(['update-ref', '-d', `refs/harni/checkpoints/${ckpt.id}`], workspaceRoot, 15000);
    delete state.checkpoints[ckpt.id];
    deletedCount++;
  }

  return deletedCount;
}

async function handleStatus(workspaceRoot) {
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    return {
      isGitRepo: false,
      workspaceRoot,
      currentBranch: '',
      headCommit: '',
      isDirty: false,
      modifiedFilesCount: 0,
      untrackedFilesCount: 0,
      checkpointsCount: 0,
      activeWorktrees: [],
    };
  }

  const [currentBranch, headCommit, status, state] = await Promise.all([
    getCurrentBranch(workspaceRoot),
    getHeadCommit(workspaceRoot),
    getStatus(workspaceRoot),
    loadState(gitCommonDir),
  ]);

  return {
    isGitRepo: true,
    workspaceRoot,
    currentBranch,
    headCommit,
    isDirty: status.isDirty,
    modifiedFilesCount: status.files.length,
    untrackedFilesCount: status.untracked.length,
    checkpointsCount: Object.keys(state.checkpoints).length,
    activeWorktrees: Object.values(state.activeWorktrees),
  };
}

async function handleCheckpointCreate(workspaceRoot, opts) {
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  await ensureGitExclude(gitCommonDir);

  const sessionId = opts.session || 'default';
  const safeSessionId = sanitizeSessionId(sessionId);
  const headCommit = await getHeadCommit(workspaceRoot);
  if (!headCommit) {
    throw new Error('Cannot create checkpoint: repository has no commits (HEAD does not exist).');
  }

  const state = await loadState(gitCommonDir);
  let ts = Date.now();
  while (state.checkpoints[`ckpt_${safeSessionId}_${ts}`]) {
    ts += 1;
  }
  const id = `ckpt_${safeSessionId}_${ts}`;

  const status = await getStatus(workspaceRoot);
  const dirtyFilesBefore = status.files;
  const untrackedFilesBefore = status.untracked;
  let stashRef;

  if (status.isDirty) {
    const stashRes = await runGit(
      ['stash', 'create', `harni-checkpoint-${id}`],
      workspaceRoot,
      60000,
    );
    if (stashRes.exitCode === 0 && stashRes.stdout) {
      stashRef = stashRes.stdout;
      await runGit(['update-ref', `refs/harni/checkpoints/${id}`, stashRef], workspaceRoot, 15000);
    }
  }

  if (!stashRef) {
    await runGit(['update-ref', `refs/harni/checkpoints/${id}`, headCommit], workspaceRoot, 15000);
  }

  const checkpoint = {
    id,
    sessionId,
    createdAt: ts,
    description: opts.desc || `Checkpoint (${new Date(ts).toISOString()})`,
    commitHash: headCommit,
    isWorktree: false,
    ...(stashRef ? { stashRef } : {}),
    workspaceRoot,
    dirtyFilesBefore,
    untrackedFilesBefore,
    filesCount: dirtyFilesBefore.length + untrackedFilesBefore.length,
  };

  state.checkpoints[id] = checkpoint;

  const maxRetained =
    opts.max !== undefined ? parseIntFlag(opts.max, '--max', 0) : DEFAULT_CREATE_MAX_CHECKPOINTS;
  await pruneCheckpointsInState(workspaceRoot, state, maxRetained);
  await saveState(gitCommonDir, state);

  return { success: true, checkpoint };
}

async function handleCheckpointList(workspaceRoot, opts) {
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  const state = await loadState(gitCommonDir);
  let checkpoints = Object.values(state.checkpoints);
  if (opts.session) {
    const safeSession = sanitizeSessionId(opts.session);
    checkpoints = checkpoints.filter(
      (c) => c.sessionId === opts.session || sanitizeSessionId(c.sessionId) === safeSession,
    );
  }
  checkpoints.sort((a, b) => b.createdAt - a.createdAt);
  return { checkpoints };
}

async function handleCheckpointRollback(workspaceRoot, opts) {
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  const state = await loadState(gitCommonDir);
  let checkpoint;

  if (opts.id) {
    checkpoint = state.checkpoints[opts.id];
  } else {
    let candidates = Object.values(state.checkpoints);
    if (opts.session) {
      const safeSession = sanitizeSessionId(opts.session);
      candidates = candidates.filter(
        (c) => c.sessionId === opts.session || sanitizeSessionId(c.sessionId) === safeSession,
      );
    } else {
      const resolvedRoot = path.resolve(workspaceRoot);
      const rootMatches = candidates.filter((c) => path.resolve(c.workspaceRoot) === resolvedRoot);
      if (rootMatches.length > 0) {
        candidates = rootMatches;
      }
    }
    candidates.sort((a, b) => b.createdAt - a.createdAt);
    checkpoint = candidates[0];
  }

  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${opts.id || opts.session || 'latest'}`);
  }

  if (checkpoint.isWorktree && checkpoint.worktreePath) {
    const safeSession = sanitizeSessionId(checkpoint.sessionId);
    const branch = checkpoint.worktreeBranch || `harni/task-${safeSession}`;
    await removeWorktreeDirAndBranch(workspaceRoot, checkpoint.worktreePath, branch);
    delete state.activeWorktrees[checkpoint.sessionId];
    delete state.activeWorktrees[safeSession];
    delete state.checkpoints[checkpoint.id];
    await saveState(gitCommonDir, state);
    return {
      success: true,
      checkpointId: checkpoint.id,
      message: `Discarded isolated worktree and restored main workspace (${checkpoint.id})`,
    };
  }

  const resetRes = await runGit(['reset', '--hard', checkpoint.commitHash], workspaceRoot, 120000);
  if (resetRes.exitCode !== 0) {
    throw new Error(`Git reset failed: ${resetRes.stderr || resetRes.stdout}`);
  }

  const currentStatus = await getStatus(workspaceRoot);
  const untrackedBeforeSet = new Set(checkpoint.untrackedFilesBefore || []);
  for (const untrackedFile of currentStatus.untracked) {
    if (!untrackedBeforeSet.has(untrackedFile)) {
      const absPath = path.join(workspaceRoot, untrackedFile);
      await fs.rm(absPath, { recursive: true, force: true });
    }
  }

  if (checkpoint.stashRef) {
    const restoreRes = await runGit(
      ['checkout', checkpoint.stashRef, '--', '.'],
      workspaceRoot,
      60000,
    );
    if (restoreRes.exitCode !== 0) {
      const applyRes = await runGit(['stash', 'apply', checkpoint.stashRef], workspaceRoot, 60000);
      if (applyRes.exitCode !== 0) {
        throw new Error(`Failed to restore dirty state from stashRef: ${applyRes.stderr}`);
      }
    }
  }

  return {
    success: true,
    checkpointId: checkpoint.id,
    message: `Workspace restored to checkpoint ${checkpoint.id}`,
  };
}

async function handleCheckpointPrune(workspaceRoot, opts) {
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  const maxRetained =
    opts.max !== undefined ? parseIntFlag(opts.max, '--max', 0) : DEFAULT_PRUNE_MAX_CHECKPOINTS;
  const state = await loadState(gitCommonDir);
  const deletedCount = await pruneCheckpointsInState(workspaceRoot, state, maxRetained);
  await saveState(gitCommonDir, state);

  return { success: true, deletedCount };
}

async function handleWorktreeCreate(workspaceRoot, opts) {
  if (!opts.session) {
    throw new Error('Missing required option: --session <id>');
  }
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  await ensureGitExclude(gitCommonDir);

  const sessionId = opts.session;
  const safeSessionId = sanitizeSessionId(sessionId);
  const branch = `harni/task-${safeSessionId}`;
  const worktreesDir = path.join(workspaceRoot, '.harni-worktrees');
  await fs.mkdir(worktreesDir, { recursive: true });
  const worktreePath = path.join(worktreesDir, safeSessionId);

  await runGit(['worktree', 'prune'], workspaceRoot, 15000);

  try {
    await fs.lstat(worktreePath);
    await removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch);
  } catch {
    await runGit(['branch', '-D', branch], workspaceRoot, 15000);
  }

  const commitTarget = opts.base || 'HEAD';
  const timeoutMs =
    opts.timeout !== undefined
      ? parseIntFlag(opts.timeout, '--timeout', 1000)
      : DEFAULT_WORKTREE_TIMEOUT_MS;

  const addRes = await runGit(
    ['worktree', 'add', '-b', branch, worktreePath, commitTarget],
    workspaceRoot,
    timeoutMs,
  );

  if (addRes.exitCode !== 0) {
    await removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch);
    throw new Error(`git worktree add failed: ${addRes.stderr || addRes.stdout}`);
  }

  await linkWorktreeDependencies(workspaceRoot, worktreePath);

  const state = await loadState(gitCommonDir);
  state.activeWorktrees[safeSessionId] = {
    sessionId,
    safeSessionId,
    workspaceRoot,
    worktreePath,
    branch,
    createdAt: Date.now(),
  };
  await saveState(gitCommonDir, state);

  return {
    success: true,
    sessionId,
    worktreePath,
    branch,
  };
}

async function handleWorktreeList(workspaceRoot) {
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  const state = await loadState(gitCommonDir);
  return {
    worktrees: Object.values(state.activeWorktrees),
  };
}

function findWorktreeRecord(state, workspaceRoot, sessionId) {
  const safeSessionId = sanitizeSessionId(sessionId);
  const existing =
    state.activeWorktrees[safeSessionId] ||
    state.activeWorktrees[sessionId] ||
    Object.values(state.activeWorktrees).find(
      (w) => w.sessionId === sessionId || sanitizeSessionId(w.sessionId) === safeSessionId,
    );

  if (existing) {
    return { record: existing, key: existing.safeSessionId || safeSessionId };
  }

  return {
    record: {
      sessionId,
      safeSessionId,
      workspaceRoot,
      worktreePath: path.join(workspaceRoot, '.harni-worktrees', safeSessionId),
      branch: `harni/task-${safeSessionId}`,
      createdAt: 0,
    },
    key: safeSessionId,
  };
}

async function handleWorktreeMerge(workspaceRoot, opts) {
  if (!opts.session) {
    throw new Error('Missing required option: --session <id>');
  }
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  const state = await loadState(gitCommonDir);
  const { record, key } = findWorktreeRecord(state, workspaceRoot, opts.session);
  const { worktreePath, branch } = record;

  try {
    await fs.stat(worktreePath);
  } catch {
    return {
      success: false,
      message: `Worktree not found for session ${opts.session} at ${worktreePath}`,
    };
  }

  const wtStatus = await getStatus(worktreePath);
  if (wtStatus.isDirty) {
    const addRes = await runGit(['add', '-A'], worktreePath, 120000);
    if (addRes.exitCode !== 0) {
      return {
        success: false,
        message: `Failed to stage changes in worktree: ${addRes.stderr || addRes.stdout}`,
      };
    }
    const commitMsg = opts.message || `harni: completed task in session ${record.sessionId}`;
    const commitRes = await runGit(['commit', '-m', commitMsg], worktreePath, 60000);
    if (commitRes.exitCode !== 0) {
      return {
        success: false,
        message: `Failed to commit changes in worktree: ${commitRes.stderr || commitRes.stdout}`,
      };
    }
  }

  const mergeRes = await runGit(['merge', branch, '--no-edit'], workspaceRoot, 120000);
  if (mergeRes.exitCode !== 0) {
    return {
      success: false,
      message: `Merge failed (worktree preserved): ${mergeRes.stderr || mergeRes.stdout}`,
    };
  }

  await removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch);
  delete state.activeWorktrees[key];
  delete state.activeWorktrees[record.sessionId];
  await saveState(gitCommonDir, state);

  return {
    success: true,
    sessionId: record.sessionId,
    branch,
    message: `Merged worktree branch (${branch}) into main workspace and cleaned up.`,
  };
}

async function handleWorktreeDiscard(workspaceRoot, opts) {
  if (!opts.session) {
    throw new Error('Missing required option: --session <id>');
  }
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  const state = await loadState(gitCommonDir);
  const { record, key } = findWorktreeRecord(state, workspaceRoot, opts.session);

  await removeWorktreeDirAndBranch(workspaceRoot, record.worktreePath, record.branch);
  delete state.activeWorktrees[key];
  delete state.activeWorktrees[record.sessionId];
  await saveState(gitCommonDir, state);

  return {
    success: true,
    sessionId: record.sessionId,
    branch: record.branch,
    message: `Discarded worktree branch (${record.branch}); main workspace untouched.`,
  };
}

async function handleWorktreePrune(workspaceRoot) {
  const { isGitRepo, gitCommonDir } = await detectGitRepo(workspaceRoot);
  if (!isGitRepo || !gitCommonDir) {
    throw new Error(`Directory is not a Git repository: ${workspaceRoot}`);
  }

  const state = await loadState(gitCommonDir);
  await runGit(['worktree', 'prune'], workspaceRoot, 15000);

  const activeBranches = new Set(Object.values(state.activeWorktrees).map((w) => w.branch));
  const activePaths = new Set(
    Object.values(state.activeWorktrees).map((w) => path.resolve(w.worktreePath)),
  );

  const prunedBranches = [];
  const branchRes = await runGit(['branch', '--list', 'harni/task-*'], workspaceRoot, 15000);
  if (branchRes.exitCode === 0 && branchRes.stdout) {
    const branches = branchRes.stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/^[+*]?\s+/, '').trim())
      .filter((branch) => branch.startsWith('harni/task-'));

    for (const branch of branches) {
      if (!activeBranches.has(branch)) {
        const safeSession = branch.replace(/^harni\/task-/, '');
        const wtDir = path.join(workspaceRoot, '.harni-worktrees', safeSession);
        await removeWorktreeDirAndBranch(workspaceRoot, wtDir, branch);
        prunedBranches.push(branch);
      }
    }
  }

  const removedDirs = [];
  const worktreesDir = path.join(workspaceRoot, '.harni-worktrees');
  try {
    const entries = await fs.readdir(worktreesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.resolve(worktreesDir, entry.name);
        if (!activePaths.has(fullPath)) {
          await unlinkWorktreeDependencies(fullPath);
          await runGit(['worktree', 'remove', '--force', fullPath], workspaceRoot, 15000);
          await fs.rm(fullPath, { recursive: true, force: true });
          removedDirs.push(entry.name);
        }
      }
    }
  } catch {
    // .harni-worktrees directory does not exist
  }

  await runGit(['worktree', 'prune'], workspaceRoot, 15000);
  return { success: true, prunedBranches, removedDirs };
}

function parseIntFlag(raw, flagName, minVal) {
  const num = Number(raw);
  if (!Number.isInteger(num) || num < minVal) {
    throw new Error(`Invalid integer value for ${flagName}: ${raw}`);
  }
  return num;
}

function parseCliArgs(argv) {
  const positionals = [];
  const opts = {
    json: false,
    help: false,
    workspace: undefined,
    session: undefined,
    desc: undefined,
    max: undefined,
    id: undefined,
    base: undefined,
    timeout: undefined,
    message: undefined,
  };

  const valueFlags = new Set([
    '--workspace',
    '--session',
    '--desc',
    '--max',
    '--id',
    '--base',
    '--timeout',
    '--message',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }

    const eqIdx = arg.indexOf('=');
    if (eqIdx > -1 && arg.startsWith('--')) {
      const flag = arg.slice(0, eqIdx);
      const val = arg.slice(eqIdx + 1);
      if (valueFlags.has(flag)) {
        opts[flag.slice(2)] = val;
        continue;
      }
      throw new Error(`Unknown option: ${flag}`);
    }

    if (valueFlags.has(arg)) {
      if (i + 1 >= argv.length) {
        throw new Error(`Option ${arg} requires a value`);
      }
      opts[arg.slice(2)] = argv[++i];
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  return { positionals, opts };
}

function formatHumanOutput(command, subcommand, result) {
  if (command === 'status') {
    const lines = [
      `Workspace: ${result.workspaceRoot}`,
      `Git Repo: ${result.isGitRepo ? 'yes' : 'no'}`,
    ];
    if (result.isGitRepo) {
      lines.push(
        `Branch: ${result.currentBranch} (${result.headCommit.slice(0, 7)})`,
        `Dirty: ${result.isDirty ? `yes (${result.modifiedFilesCount} modified, ${result.untrackedFilesCount} untracked)` : 'clean'}`,
        `Checkpoints: ${result.checkpointsCount}`,
        `Active Worktrees: ${result.activeWorktrees.length}`,
      );
    }
    return lines.join('\n');
  }

  if (command === 'checkpoint' && subcommand === 'list') {
    if (result.checkpoints.length === 0) return 'No checkpoints found.';
    return result.checkpoints
      .map((c) => `${c.id}  ${new Date(c.createdAt).toISOString()}  [${c.sessionId}]  ${c.description}`)
      .join('\n');
  }

  if (command === 'worktree' && subcommand === 'list') {
    if (result.worktrees.length === 0) return 'No active worktrees.';
    return result.worktrees
      .map((w) => `${w.sessionId}  ${w.branch}  ->  ${w.worktreePath}`)
      .join('\n');
  }

  if (result.message) {
    return result.message;
  }

  return JSON.stringify(result, null, 2);
}

async function main() {
  let opts = { json: false, help: false };
  try {
    const parsed = parseCliArgs(process.argv.slice(2));
    opts = parsed.opts;
    const { positionals } = parsed;

    if (opts.help) {
      process.stdout.write(USAGE_TEXT);
      process.exit(0);
    }

    if (positionals.length === 0) {
      process.stderr.write(USAGE_TEXT);
      process.exit(1);
    }

    const workspaceRoot = path.resolve(opts.workspace || process.cwd());
    const [command, subcommand] = positionals;

    let result;
    if (command === 'status' && positionals.length === 1) {
      result = await handleStatus(workspaceRoot);
    } else if (command === 'checkpoint') {
      if (subcommand === 'create') {
        result = await handleCheckpointCreate(workspaceRoot, opts);
      } else if (subcommand === 'list') {
        result = await handleCheckpointList(workspaceRoot, opts);
      } else if (subcommand === 'rollback') {
        result = await handleCheckpointRollback(workspaceRoot, opts);
      } else if (subcommand === 'prune') {
        result = await handleCheckpointPrune(workspaceRoot, opts);
      } else {
        throw new Error(`Unknown checkpoint subcommand: ${subcommand || '(none)'}`);
      }
    } else if (command === 'worktree') {
      if (subcommand === 'create') {
        result = await handleWorktreeCreate(workspaceRoot, opts);
      } else if (subcommand === 'list') {
        result = await handleWorktreeList(workspaceRoot);
      } else if (subcommand === 'merge') {
        result = await handleWorktreeMerge(workspaceRoot, opts);
      } else if (subcommand === 'discard') {
        result = await handleWorktreeDiscard(workspaceRoot, opts);
      } else if (subcommand === 'prune') {
        result = await handleWorktreePrune(workspaceRoot);
      } else {
        throw new Error(`Unknown worktree subcommand: ${subcommand || '(none)'}`);
      }
    } else {
      throw new Error(`Unknown command: ${positionals.join(' ')}`);
    }

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stdout.write(`${formatHumanOutput(command, subcommand, result)}\n`);
    }

    if (result && result.success === false) {
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ success: false, error: message })}\n`);
    } else {
      process.stderr.write(`Error: ${message}\n\n${USAGE_TEXT}`);
    }
    process.exit(1);
  }
}

main();
