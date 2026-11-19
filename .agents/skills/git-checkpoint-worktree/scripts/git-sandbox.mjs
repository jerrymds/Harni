#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const STATE_SCHEMA_VERSION = 1;
const DEPENDENCY_DIRS = ['node_modules', '.venv', 'venv'];
const EXCLUDE_PATTERNS = ['.harni-worktrees', '.harni-worktrees/**', '.harni/snapshots'];
const DEFAULT_CREATE_MAX_CHECKPOINTS = 10;
const DEFAULT_PRUNE_MAX_CHECKPOINTS = 5;
const DEFAULT_WORKTREE_TIMEOUT_MS = 180000;
const DEFAULT_LOCK_TIMEOUT_MS = 15000;
const DEFAULT_LOCK_STALE_MS = 30000;

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

  checkpoint rollback [--id <ckptId>] [--session <id>] [--dry-run]
      Restore workspace to a checkpoint (or latest for session/workspace).

  checkpoint prune [--max <n>]
      Keep newest <n> checkpoints (default: 5) and delete older refs/records.

  worktree create --session <id> [--base <ref>] [--timeout <ms>] [--replace]
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
  const original = String(sessionId);
  if (/^[a-zA-Z0-9_-]{1,48}$/.test(original)) {
    return original;
  }
  const slug = original.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'session';
  const hash = createHash('sha256').update(original).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}

function canonicalizePath(targetPath) {
  const resolved = path.resolve(targetPath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isSameWorkspacePath(a, b) {
  if (!a || !b) return false;
  const resolvedA = canonicalizePath(a);
  const resolvedB = canonicalizePath(b);
  if (process.platform === 'win32') {
    return resolvedA.toLowerCase() === resolvedB.toLowerCase();
  }
  return resolvedA === resolvedB;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

function isSensitiveFilePath(relPath) {
  const base = path.posix.basename(relPath.replace(/\\/g, '/')).toLowerCase();
  if (base === '.env') return true;
  if (
    base.startsWith('.env.') &&
    base !== '.env.example' &&
    base !== '.env.sample' &&
    base !== '.env.template'
  ) {
    return true;
  }
  if (base.endsWith('.pem') || base.endsWith('.key')) return true;
  if (base === 'credentials.json') return true;
  if (base.startsWith('secrets.')) return true;
  return false;
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
  const gitCommonDir = canonicalizePath(path.resolve(workspaceRoot, commonRes.stdout));
  return { isGitRepo: true, gitCommonDir };
}

function getStateFilePath(gitCommonDir) {
  return path.join(gitCommonDir, 'harni-sandbox-state.json');
}

async function acquireLockFile(
  lockPath,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  staleMs = DEFAULT_LOCK_STALE_MS,
  label = 'sandbox state lock',
) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        const payload = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
        await handle.writeFile(payload, 'utf-8');
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          await fs.unlink(lockPath);
        } catch (err) {
          if (err?.code !== 'ENOENT') {
            throw err;
          }
        }
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        throw err;
      }

      let shouldRetryImmediately = false;
      try {
        const stat = await fs.stat(lockPath);
        const raw = await fs.readFile(lockPath, 'utf-8');
        const trimmed = raw.trim();
        const ageFromMtime = Date.now() - stat.mtimeMs;

        if (!trimmed) {
          if (ageFromMtime >= 1000 && ageFromMtime > staleMs) {
            shouldRetryImmediately = true;
          }
        } else {
          let parsedPid;
          let parsedCreatedAt;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
              parsedPid = parsed.pid;
              parsedCreatedAt = parsed.createdAt;
            }
          } catch {
            // Corrupt lock file payload; fall back to mtime staleness check
          }

          const pidDead =
            typeof parsedPid === 'number' && Number.isInteger(parsedPid) && parsedPid > 0
              ? !isProcessAlive(parsedPid)
              : false;
          const age = Date.now() - (typeof parsedCreatedAt === 'number' ? parsedCreatedAt : stat.mtimeMs);
          if (pidDead || age > staleMs) {
            shouldRetryImmediately = true;
          }
        }

        if (shouldRetryImmediately) {
          try {
            await fs.unlink(lockPath);
          } catch (unlinkErr) {
            if (unlinkErr?.code !== 'ENOENT') {
              throw unlinkErr;
            }
          }
          continue;
        }
      } catch (inspectErr) {
        if (inspectErr?.code === 'ENOENT') {
          continue;
        }
        throw inspectErr;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${label}`);
      }
      const jitterMs = 20 + Math.floor(Math.random() * 101);
      await sleep(Math.min(jitterMs, Math.max(1, deadline - Date.now())));
    }
  }
}

async function acquireStateLock(
  gitCommonDir,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  staleMs = DEFAULT_LOCK_STALE_MS,
) {
  return acquireLockFile(
    `${getStateFilePath(gitCommonDir)}.lock`,
    timeoutMs,
    staleMs,
    'sandbox state lock',
  );
}

async function loadState(gitCommonDir) {
  const statePath = getStateFilePath(gitCommonDir);
  let raw;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      raw = await fs.readFile(statePath, 'utf-8');
      break;
    } catch (err) {
      if (err?.code === 'ENOENT') {
        return { version: STATE_SCHEMA_VERSION, checkpoints: {}, activeWorktrees: {} };
      }
      const retryable =
        err?.code === 'EPERM' || err?.code === 'EACCES' || err?.code === 'EBUSY';
      if (retryable && attempt < maxRetries) {
        await sleep(20 + Math.floor(Math.random() * 21));
        continue;
      }
      throw new Error(`Failed to read sandbox state file (${statePath}): ${err?.message || String(err)}`);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Corrupted sandbox state file (${statePath}): ${err?.message || String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid sandbox state structure in ${statePath}`);
  }

  return {
    version: parsed.version || STATE_SCHEMA_VERSION,
    checkpoints:
      parsed.checkpoints && typeof parsed.checkpoints === 'object' && !Array.isArray(parsed.checkpoints)
        ? parsed.checkpoints
        : {},
    activeWorktrees:
      parsed.activeWorktrees &&
      typeof parsed.activeWorktrees === 'object' &&
      !Array.isArray(parsed.activeWorktrees)
        ? parsed.activeWorktrees
        : {},
  };
}

async function saveState(gitCommonDir, state) {
  const statePath = getStateFilePath(gitCommonDir);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const stateToWrite = {
    version: STATE_SCHEMA_VERSION,
    checkpoints: state.checkpoints || {},
    activeWorktrees: state.activeWorktrees || {},
  };
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    await fs.writeFile(tmpPath, JSON.stringify(stateToWrite, null, 2), 'utf-8');

    const maxRetries = 5;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await fs.rename(tmpPath, statePath);
        return;
      } catch (err) {
        const retryable =
          err?.code === 'EPERM' || err?.code === 'EACCES' || err?.code === 'EBUSY';
        if (retryable && attempt < maxRetries) {
          await sleep(20 + Math.floor(Math.random() * 31));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore temp file cleanup errors
    }
    throw err;
  }
}

async function withStateLock(gitCommonDir, fn) {
  const releaseLock = await acquireStateLock(gitCommonDir);
  try {
    const state = await loadState(gitCommonDir);
    const result = await fn(state);
    await saveState(gitCommonDir, state);
    return result;
  } finally {
    await releaseLock();
  }
}

async function getRepositoryIdentity(workspaceRoot, gitCommonDir) {
  const rootsRes = await runGit(['rev-list', '--max-parents=0', 'HEAD'], workspaceRoot, 10000);
  const roots =
    rootsRes.exitCode === 0 && rootsRes.stdout
      ? rootsRes.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .sort()
          .join(',')
      : '';
  const resolvedCommonDir = canonicalizePath(gitCommonDir);
  const normalizedCommonDir =
    process.platform === 'win32' ? resolvedCommonDir.toLowerCase() : resolvedCommonDir;
  return createHash('sha256')
    .update(`${normalizedCommonDir}\n${roots}`)
    .digest('hex')
    .slice(0, 16);
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

  const envIgnoredRes = await runGit(['check-ignore', '-q', '.env'], sourceRoot, 10000);
  if (envIgnoredRes.exitCode === 0) {
    const sourceEnv = path.join(sourceRoot, '.env');
    const targetEnv = path.join(worktreePath, '.env');
    try {
      await fs.copyFile(sourceEnv, targetEnv);
    } catch {
      // .env does not exist
    }
  }
}

async function removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch) {
  await unlinkWorktreeDependencies(worktreePath);

  const listRes = await runGit(['worktree', 'list', '--porcelain'], workspaceRoot, 15000);
  let isRegistered = false;
  if (listRes.exitCode === 0 && listRes.stdout) {
    for (const line of listRes.stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        const wtEntryPath = line.slice('worktree '.length).trim();
        if (isSameWorkspacePath(wtEntryPath, worktreePath)) {
          isRegistered = true;
          break;
        }
      }
    }
  }

  if (isRegistered) {
    const removeRes = await runGit(
      ['worktree', 'remove', '--force', worktreePath],
      workspaceRoot,
      60000,
    );
    if (removeRes.exitCode !== 0) {
      throw new Error(
        `Failed to remove Git worktree (${worktreePath}): ${removeRes.stderr || removeRes.stdout}`,
      );
    }
  }

  let stillExists = false;
  try {
    await fs.lstat(worktreePath);
    stillExists = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw err;
    }
  }

  if (stillExists) {
    await unlinkWorktreeDependencies(worktreePath);
    await fs.rm(worktreePath, { recursive: true, force: true });
    let verifyExists = false;
    try {
      await fs.lstat(worktreePath);
      verifyExists = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        throw err;
      }
    }
    if (verifyExists) {
      throw new Error(`Worktree directory still exists after removal: ${worktreePath}`);
    }
  }

  const pruneRes = await runGit(['worktree', 'prune'], workspaceRoot, 15000);
  if (pruneRes.exitCode !== 0) {
    throw new Error(`git worktree prune failed: ${pruneRes.stderr || pruneRes.stdout}`);
  }

  if (branch) {
    const refCheck = await runGit(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      workspaceRoot,
      10000,
    );
    if (refCheck.exitCode === 0) {
      const delBranchRes = await runGit(['branch', '-D', branch], workspaceRoot, 15000);
      if (delBranchRes.exitCode !== 0) {
        throw new Error(
          `Failed to delete branch ${branch}: ${delBranchRes.stderr || delBranchRes.stdout}`,
        );
      }
    }
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
    const refName = `refs/harni/checkpoints/${ckpt.id}`;
    const checkRes = await runGit(['show-ref', '--verify', '--quiet', refName], workspaceRoot, 10000);
    if (checkRes.exitCode === 0) {
      const delRes = await runGit(['update-ref', '-d', refName], workspaceRoot, 15000);
      if (delRes.exitCode !== 0) {
        throw new Error(
          `Failed to delete checkpoint ref ${refName}: ${delRes.stderr || delRes.stdout}`,
        );
      }
    }
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

function resolveWorkspaceChildPath(workspaceRoot, relPath) {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const absPath = path.resolve(resolvedWorkspace, relPath);
  const relative = path.relative(resolvedWorkspace, absPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access path outside workspace: ${relPath}`);
  }
  return absPath;
}

function assertCheckpointBelongsToWorkspace(checkpoint, resolvedRoot, gitCommonDir, repositoryId) {
  if (checkpoint.gitCommonDir && !isSameWorkspacePath(checkpoint.gitCommonDir, gitCommonDir)) {
    throw new Error(
      `Checkpoint ${checkpoint.id} belongs to a different Git repository (${checkpoint.gitCommonDir}).`,
    );
  }
  if (checkpoint.repositoryId && repositoryId && checkpoint.repositoryId !== repositoryId) {
    throw new Error(
      `Checkpoint ${checkpoint.id} belongs to a different repository identity (${checkpoint.repositoryId} !== ${repositoryId}).`,
    );
  }
  if (!checkpoint.isWorktree && !isSameWorkspacePath(checkpoint.workspaceRoot, resolvedRoot)) {
    throw new Error(
      `Checkpoint ${checkpoint.id} belongs to a different workspace (${checkpoint.workspaceRoot} !== ${resolvedRoot}).`,
    );
  }
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

  const maxRetained =
    opts.max !== undefined ? parseIntFlag(opts.max, '--max', 0) : DEFAULT_CREATE_MAX_CHECKPOINTS;
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedCommonDir = canonicalizePath(gitCommonDir);
  const repositoryId = await getRepositoryIdentity(workspaceRoot, gitCommonDir);

  const checkpoint = await withStateLock(gitCommonDir, async (state) => {
    let ts = Date.now();
    while (state.checkpoints[`ckpt_${safeSessionId}_${ts}`]) {
      ts += 1;
    }
    const id = `ckpt_${safeSessionId}_${ts}`;

    const status = await getStatus(workspaceRoot);
    const dirtyFilesBefore = status.files;
    const untrackedFilesBefore = status.untracked;
    let stashRef;

    if (dirtyFilesBefore.length > 0) {
      const stashRes = await runGit(
        ['stash', 'create', `harni-checkpoint-${id}`],
        workspaceRoot,
        60000,
      );
      if (stashRes.exitCode !== 0 || !stashRes.stdout) {
        throw new Error(
          `Failed to capture dirty tracked state with git stash create: ${stashRes.stderr || stashRes.stdout || 'empty stash ref'}`,
        );
      }
      stashRef = stashRes.stdout;
    }

    const targetRef = stashRef || headCommit;
    const refRes = await runGit(
      ['update-ref', `refs/harni/checkpoints/${id}`, targetRef],
      workspaceRoot,
      15000,
    );
    if (refRes.exitCode !== 0) {
      throw new Error(
        `Failed to store checkpoint ref refs/harni/checkpoints/${id}: ${refRes.stderr || refRes.stdout}`,
      );
    }

    const record = {
      schemaVersion: STATE_SCHEMA_VERSION,
      id,
      sessionId,
      createdAt: ts,
      description: opts.desc || `Checkpoint (${new Date(ts).toISOString()})`,
      commitHash: headCommit,
      isWorktree: false,
      ...(stashRef ? { stashRef } : {}),
      workspaceRoot: resolvedRoot,
      gitCommonDir: resolvedCommonDir,
      repositoryId,
      dirtyFilesBefore,
      untrackedFilesBefore,
      filesCount: dirtyFilesBefore.length + untrackedFilesBefore.length,
    };

    state.checkpoints[id] = record;
    await pruneCheckpointsInState(workspaceRoot, state, maxRetained);
    return record;
  });

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

  const resolvedRoot = path.resolve(workspaceRoot);
  const repositoryId = await getRepositoryIdentity(workspaceRoot, gitCommonDir);
  const state = await loadState(gitCommonDir);
  let checkpoint;

  if (opts.id) {
    checkpoint = state.checkpoints[opts.id];
  } else {
    let candidates = Object.values(state.checkpoints).filter((c) => {
      if (c.isWorktree) {
        return isSameWorkspacePath(c.gitCommonDir || gitCommonDir, gitCommonDir);
      }
      const rootMatches = isSameWorkspacePath(c.workspaceRoot, resolvedRoot);
      const commonMatches = c.gitCommonDir
        ? isSameWorkspacePath(c.gitCommonDir, gitCommonDir)
        : true;
      const repoMatches =
        c.repositoryId && repositoryId ? c.repositoryId === repositoryId : true;
      return rootMatches && commonMatches && repoMatches;
    });

    if (opts.session) {
      const safeSession = sanitizeSessionId(opts.session);
      candidates = candidates.filter(
        (c) => c.sessionId === opts.session || sanitizeSessionId(c.sessionId) === safeSession,
      );
    }

    candidates.sort((a, b) => b.createdAt - a.createdAt);
    checkpoint = candidates[0];
  }

  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${opts.id || opts.session || 'latest'}`);
  }

  assertCheckpointBelongsToWorkspace(checkpoint, resolvedRoot, gitCommonDir, repositoryId);

  if (opts.dryRun) {
    if (checkpoint.isWorktree && checkpoint.worktreePath) {
      return {
        success: true,
        dryRun: true,
        checkpointId: checkpoint.id,
        wouldResetTo: checkpoint.commitHash,
        wouldDiscardWorktree: checkpoint.worktreePath,
        trackedFilesToRestore: [],
        untrackedFilesToDelete: [],
        untrackedFilesToRestore: [],
        untrackedFilesPreserved: [],
      };
    }

    const currentStatus = await getStatus(workspaceRoot);
    const currentHead = await getHeadCommit(workspaceRoot);
    let diffFiles = [];
    if (currentHead && checkpoint.commitHash && currentHead !== checkpoint.commitHash) {
      const diffRes = await runGit(
        ['-c', 'core.quotepath=false', 'diff', '--name-only', currentHead, checkpoint.commitHash],
        workspaceRoot,
        30000,
        { trimStdout: false },
      );
      if (diffRes.exitCode === 0 && diffRes.stdout) {
        diffFiles = diffRes.stdout
          .split(/\r?\n/)
          .map((line) => unquoteGitPath(line))
          .filter(Boolean);
      }
    }

    const trackedFilesToRestore = [
      ...new Set([...currentStatus.files, ...(checkpoint.dirtyFilesBefore || []), ...diffFiles]),
    ].sort();
    const untrackedBeforeSet = new Set(checkpoint.untrackedFilesBefore || []);
    const untrackedFilesToDelete = currentStatus.untracked.filter(
      (f) => !untrackedBeforeSet.has(f),
    );
    const untrackedFilesPreserved = currentStatus.untracked.filter((f) =>
      untrackedBeforeSet.has(f),
    );

    return {
      success: true,
      dryRun: true,
      checkpointId: checkpoint.id,
      wouldResetTo: checkpoint.commitHash,
      trackedFilesToRestore,
      untrackedFilesToDelete,
      untrackedFilesToRestore: [],
      untrackedFilesPreserved,
    };
  }

  if (checkpoint.isWorktree && checkpoint.worktreePath) {
    const safeSession = sanitizeSessionId(checkpoint.sessionId);
    const branch = checkpoint.worktreeBranch || `harni/task-${safeSession}`;
    await removeWorktreeDirAndBranch(workspaceRoot, checkpoint.worktreePath, branch);
    await withStateLock(gitCommonDir, (lockedState) => {
      delete lockedState.activeWorktrees[checkpoint.sessionId];
      delete lockedState.activeWorktrees[safeSession];
      delete lockedState.checkpoints[checkpoint.id];
    });
    return {
      success: true,
      checkpointId: checkpoint.id,
      message: `Discarded isolated worktree and restored main workspace (${checkpoint.id})`,
    };
  }

  const untrackedBeforeList = checkpoint.untrackedFilesBefore || [];
  if (untrackedBeforeList.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < untrackedBeforeList.length; i += CHUNK_SIZE) {
      const batch = untrackedBeforeList.slice(i, i + CHUNK_SIZE);
      const rmCachedRes = await runGit(
        ['rm', '-r', '--cached', '--ignore-unmatch', '--', ...batch],
        workspaceRoot,
        30000,
      );
      if (rmCachedRes.exitCode !== 0) {
        throw new Error(
          `Failed to unstage pre-existing untracked files before reset: ${rmCachedRes.stderr || rmCachedRes.stdout}`,
        );
      }
    }
  }

  const resetRes = await runGit(['reset', '--hard', checkpoint.commitHash], workspaceRoot, 120000);
  if (resetRes.exitCode !== 0) {
    throw new Error(`Git reset failed: ${resetRes.stderr || resetRes.stdout}`);
  }

  const currentStatus = await getStatus(workspaceRoot);
  const untrackedBeforeSet = new Set(untrackedBeforeList);
  for (const untrackedFile of currentStatus.untracked) {
    if (!untrackedBeforeSet.has(untrackedFile)) {
      const absPath = resolveWorkspaceChildPath(workspaceRoot, untrackedFile);
      await fs.rm(absPath, { recursive: true, force: true });
    }
  }

  if (checkpoint.stashRef) {
    const checkoutRes = await runGit(
      ['checkout', '--no-overlay', checkpoint.stashRef, '--', '.'],
      workspaceRoot,
      60000,
    );
    if (checkoutRes.exitCode !== 0) {
      const stderrLower = (checkoutRes.stderr || '').toLowerCase();
      if (stderrLower.includes('unknown option')) {
        const fallbackRes = await runGit(
          ['checkout', checkpoint.stashRef, '--', '.'],
          workspaceRoot,
          60000,
        );
        if (fallbackRes.exitCode !== 0) {
          throw new Error(
            `Failed to restore dirty state from stashRef: ${fallbackRes.stderr || fallbackRes.stdout}`,
          );
        }
        const [treeRes, indexRes] = await Promise.all([
          runGit(['ls-tree', '-r', '-z', '--name-only', checkpoint.stashRef], workspaceRoot, 30000, {
            trimStdout: false,
          }),
          runGit(['ls-files', '-z'], workspaceRoot, 30000, { trimStdout: false }),
        ]);
        if (treeRes.exitCode === 0 && indexRes.exitCode === 0) {
          const expectedFiles = new Set(treeRes.stdout.split('\0').filter(Boolean));
          const currentFiles = indexRes.stdout.split('\0').filter(Boolean);
          for (const trackedPath of currentFiles) {
            if (!expectedFiles.has(trackedPath)) {
              const absPath = resolveWorkspaceChildPath(workspaceRoot, trackedPath);
              await fs.rm(absPath, { recursive: true, force: true });
            }
          }
        }
      } else {
        throw new Error(
          `Failed to restore dirty state from stashRef: ${checkoutRes.stderr || checkoutRes.stdout}`,
        );
      }
    }

    const parent2Res = await runGit(
      ['rev-parse', '--verify', '--quiet', `${checkpoint.stashRef}^2`],
      workspaceRoot,
      10000,
    );
    if (parent2Res.exitCode === 0) {
      const readTreeRes = await runGit(
        ['read-tree', `${checkpoint.stashRef}^2`],
        workspaceRoot,
        30000,
      );
      if (readTreeRes.exitCode !== 0) {
        throw new Error(
          `Failed to restore index state from stashRef^2: ${readTreeRes.stderr || readTreeRes.stdout}`,
        );
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

  const deletedCount = await withStateLock(gitCommonDir, async (state) => {
    return await pruneCheckpointsInState(workspaceRoot, state, maxRetained);
  });

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
  const worktreePath = path.join(worktreesDir, safeSessionId);
  const commitTarget = opts.base || 'HEAD';
  const timeoutMs =
    opts.timeout !== undefined
      ? parseIntFlag(opts.timeout, '--timeout', 1000)
      : DEFAULT_WORKTREE_TIMEOUT_MS;

  const sessionLockPath = path.join(gitCommonDir, 'harni-worktree-locks', `${safeSessionId}.lock`);
  const releaseSessionLock = await acquireLockFile(
    sessionLockPath,
    Math.max(timeoutMs, DEFAULT_LOCK_TIMEOUT_MS),
    DEFAULT_LOCK_STALE_MS,
    `worktree session lock (${safeSessionId})`,
  );

  try {
    const pruneRes = await runGit(['worktree', 'prune'], workspaceRoot, 15000);
    if (pruneRes.exitCode !== 0) {
      throw new Error(`git worktree prune failed: ${pruneRes.stderr || pruneRes.stdout}`);
    }

    const preState = await loadState(gitCommonDir);
    const existsInState = Boolean(preState.activeWorktrees[safeSessionId]);
    let existsOnDisk = false;
    try {
      await fs.lstat(worktreePath);
      existsOnDisk = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        throw err;
      }
    }
    const branchRefCheck = await runGit(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      workspaceRoot,
      10000,
    );
    const branchExists = branchRefCheck.exitCode === 0;
    const existedBefore = existsInState || existsOnDisk || branchExists;

    if (existedBefore && !opts.replace) {
      throw new Error(
        `Worktree or branch already exists for session "${sessionId}" (${branch}). Pass --replace to overwrite.`,
      );
    }

    if (opts.replace && existedBefore) {
      await removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch);
    }

    await fs.mkdir(worktreesDir, { recursive: true });

    const addRes = await runGit(
      ['worktree', 'add', '-b', branch, worktreePath, commitTarget],
      workspaceRoot,
      timeoutMs,
    );

    if (addRes.exitCode !== 0) {
      const stderrLower = (addRes.stderr || '').toLowerCase();
      const isAlreadyExistsCollision =
        stderrLower.includes('already exists') || stderrLower.includes('already checked out');
      if ((opts.replace || !existedBefore) && !isAlreadyExistsCollision) {
        await removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch).catch(() => {});
      }
      throw new Error(`git worktree add failed: ${addRes.stderr || addRes.stdout}`);
    }

    await linkWorktreeDependencies(workspaceRoot, worktreePath);

    const resolvedRoot = path.resolve(workspaceRoot);
    await withStateLock(gitCommonDir, async (state) => {
      if (!opts.replace && state.activeWorktrees[safeSessionId]) {
        throw new Error(
          `Worktree or branch already exists for session "${sessionId}" (${branch}). Pass --replace to overwrite.`,
        );
      }

      state.activeWorktrees[safeSessionId] = {
        schemaVersion: STATE_SCHEMA_VERSION,
        sessionId,
        safeSessionId,
        workspaceRoot: resolvedRoot,
        worktreePath,
        branch,
        createdAt: Date.now(),
      };
    });

    return {
      success: true,
      sessionId,
      worktreePath,
      branch,
    };
  } finally {
    await releaseSessionLock();
  }
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

  const mainStatus = await getStatus(workspaceRoot);
  if (mainStatus.isDirty) {
    return {
      success: false,
      error: 'Main workspace must be clean before merge',
      message: 'Main workspace must be clean before merge',
      modified: mainStatus.files,
      untracked: mainStatus.untracked,
    };
  }

  const wtStatus = await getStatus(worktreePath);
  if (wtStatus.isDirty) {
    const candidates = [...new Set([...wtStatus.files, ...wtStatus.untracked])];
    const sensitiveFiles = candidates.filter((filePath) => isSensitiveFilePath(filePath));
    if (sensitiveFiles.length > 0) {
      return {
        success: false,
        error: 'Sensitive untracked files would be committed',
        message: `Sensitive untracked files would be committed: ${sensitiveFiles.join(', ')}`,
        files: sensitiveFiles,
      };
    }

    const BATCH_SIZE = 200;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const addRes = await runGit(['add', '-A', '--', ...batch], worktreePath, 120000);
      if (addRes.exitCode !== 0) {
        return {
          success: false,
          message: `Failed to stage changes in worktree: ${addRes.stderr || addRes.stdout}`,
        };
      }
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
    const abortRes = await runGit(['merge', '--abort'], workspaceRoot, 30000);
    if (abortRes.exitCode !== 0) {
      await runGit(['reset', '--merge'], workspaceRoot, 30000);
    }
    return {
      success: false,
      error: 'Merge failed',
      message: `Merge failed (main workspace restored; worktree preserved): ${mergeRes.stderr || mergeRes.stdout}`,
    };
  }

  await removeWorktreeDirAndBranch(workspaceRoot, worktreePath, branch);
  await withStateLock(gitCommonDir, (lockedState) => {
    delete lockedState.activeWorktrees[key];
    delete lockedState.activeWorktrees[record.sessionId];
  });

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
  await withStateLock(gitCommonDir, (lockedState) => {
    delete lockedState.activeWorktrees[key];
    delete lockedState.activeWorktrees[record.sessionId];
  });

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
  const initialPruneRes = await runGit(['worktree', 'prune'], workspaceRoot, 15000);
  if (initialPruneRes.exitCode !== 0) {
    throw new Error(`git worktree prune failed: ${initialPruneRes.stderr || initialPruneRes.stdout}`);
  }

  const activeWorktreeList = Object.values(state.activeWorktrees);
  const activeBranches = new Set(activeWorktreeList.map((w) => w.branch));
  const isPathActive = (targetPath) =>
    activeWorktreeList.some((w) => isSameWorkspacePath(w.worktreePath, targetPath));

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
        if (!isPathActive(fullPath)) {
          await removeWorktreeDirAndBranch(workspaceRoot, fullPath, null);
          removedDirs.push(entry.name);
        }
      }
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw err;
    }
  }

  const finalPruneRes = await runGit(['worktree', 'prune'], workspaceRoot, 15000);
  if (finalPruneRes.exitCode !== 0) {
    throw new Error(`git worktree prune failed: ${finalPruneRes.stderr || finalPruneRes.stdout}`);
  }
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
    dryRun: false,
    replace: false,
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
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--replace') {
      opts.replace = true;
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
  const rawArgv = process.argv.slice(2);
  try {
    const parsed = parseCliArgs(rawArgv);
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
    const wantsJson = opts.json || rawArgv.includes('--json');
    if (wantsJson) {
      process.stdout.write(`${JSON.stringify({ success: false, error: message })}\n`);
    } else {
      process.stderr.write(`Error: ${message}\n\n${USAGE_TEXT}`);
    }
    process.exit(1);
  }
}

main();
