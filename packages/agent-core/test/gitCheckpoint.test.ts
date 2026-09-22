import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import {
  AgentCoreEngine,
  GitCheckpointService,
  MockProvider,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('GitCheckpointService & Worktree Unit Tests', () => {
  const testRoot = path.join(os.tmpdir(), `cline_test_checkpoints_${Date.now()}`);
  const gitRepoDir = path.join(testRoot, 'test_repo');
  const nonGitDir = path.join(testRoot, 'non_git');
  let service: GitCheckpointService;

  beforeAll(async () => {
    service = new GitCheckpointService();
    await fs.mkdir(testRoot, { recursive: true });
    await fs.mkdir(nonGitDir, { recursive: true });
    await fs.mkdir(gitRepoDir, { recursive: true });

    // Initialize real git repo for testing
    await execFileAsync('git', ['init'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'cline-test@example.com'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Cline Test'], { cwd: gitRepoDir });

    // Create initial commit
    await fs.writeFile(path.join(gitRepoDir, 'hello.txt'), 'version 1', 'utf-8');
    await execFileAsync('git', ['add', 'hello.txt'], { cwd: gitRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: gitRepoDir });
  });

  afterAll(async () => {
    // Cleanup any worktrees before removing directory
    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: gitRepoDir });
    } catch {
      // ignore
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('correctly detects git vs non-git directories', async () => {
    const isGit = await service.isGitRepo(gitRepoDir);
    const isNonGit = await service.isGitRepo(nonGitDir);

    expect(isGit).toBe(true);
    expect(isNonGit).toBe(false);
  });

  it('retrieves head commit and branch name', async () => {
    const commit = await service.getHeadCommit(gitRepoDir);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);

    const branch = await service.getCurrentBranch(gitRepoDir);
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });

  it('detects clean vs dirty working tree', async () => {
    const cleanStatus = await service.getStatus(gitRepoDir);
    expect(cleanStatus.isDirty).toBe(false);

    // Modify a file
    await fs.writeFile(path.join(gitRepoDir, 'hello.txt'), 'version 1 modified', 'utf-8');
    const dirtyStatus = await service.getStatus(gitRepoDir);
    expect(dirtyStatus.isDirty).toBe(true);
    expect(dirtyStatus.files.length).toBeGreaterThan(0);

    // Restore to clean
    await execFileAsync('git', ['checkout', '--', 'hello.txt'], { cwd: gitRepoDir });
  });

  it('creates checkpoint and rolls back changes accurately (One-Click Revert)', async () => {
    // 1. Create a checkpoint at clean state
    const ckpt = await service.createCheckpoint(gitRepoDir, {
      sessionId: 'sess_revert_test',
      description: 'Pre-task state',
    });

    expect(ckpt.id).toMatch(/^ckpt_sess_revert_test_/);
    expect(ckpt.commitHash).toMatch(/^[0-9a-f]{40}$/);

    // 2. Modify existing file and create new untracked file
    await fs.writeFile(path.join(gitRepoDir, 'hello.txt'), 'version corrupted by agent', 'utf-8');
    const unwantedFile = path.join(gitRepoDir, 'agent_temp.ts');
    await fs.writeFile(unwantedFile, 'console.log("bad");', 'utf-8');

    const dirtyCheck = await service.getStatus(gitRepoDir);
    expect(dirtyCheck.isDirty).toBe(true);

    // 3. Rollback to checkpoint
    const rollbackRes = await service.rollbackCheckpoint(gitRepoDir, ckpt.id);
    expect(rollbackRes.success).toBe(true);

    // 4. Verify original content restored and new file removed
    const restoredContent = await fs.readFile(path.join(gitRepoDir, 'hello.txt'), 'utf-8');
    expect(restoredContent).toBe('version 1');

    let unwantedExists = true;
    try {
      await fs.access(unwantedFile);
    } catch {
      unwantedExists = false;
    }
    expect(unwantedExists).toBe(false);

    const finalStatus = await service.getStatus(gitRepoDir);
    expect(finalStatus.isDirty).toBe(false);
  });

  it('manages isolated Git Worktree lifecycle (create, isolate, merge)', async () => {
    const sessionId = 'session_wt_1';

    // Create worktree
    const { worktreePath, branch } = await service.createWorktree(gitRepoDir, sessionId);
    expect(branch).toBe(`cline/task-${sessionId}`);

    // Verify worktree directory exists and is a git worktree
    const stat = await fs.stat(worktreePath);
    expect(stat.isDirectory()).toBe(true);

    const activeInfo = service.getActiveWorktree(sessionId);
    expect(activeInfo).not.toBeNull();
    expect(activeInfo?.branch).toBe(branch);

    // Agent modifies file inside worktree
    const wtFile = path.join(worktreePath, 'feature.txt');
    await fs.writeFile(wtFile, 'new feature in worktree', 'utf-8');

    // Main workspace should NOT have feature.txt yet (isolation verified!)
    let mainHasFeature = true;
    try {
      await fs.access(path.join(gitRepoDir, 'feature.txt'));
    } catch {
      mainHasFeature = false;
    }
    expect(mainHasFeature).toBe(false);

    // Merge worktree back to main workspace
    const mergeRes = await service.mergeWorktree(gitRepoDir, sessionId, 'feat: add feature from worktree');
    expect(mergeRes.success).toBe(true);

    // Main workspace now has feature.txt!
    const mergedContent = await fs.readFile(path.join(gitRepoDir, 'feature.txt'), 'utf-8');
    expect(mergedContent).toBe('new feature in worktree');

    // Worktree should be cleaned up
    expect(service.getActiveWorktree(sessionId)).toBeNull();
  }, 15000);

  it('discards isolated Git Worktree cleanly without affecting main workspace', async () => {
    const sessionId = 'session_wt_discard';

    // Create worktree
    const { worktreePath } = await service.createWorktree(gitRepoDir, sessionId);

    // Make an unwanted change inside worktree
    await fs.writeFile(path.join(worktreePath, 'hello.txt'), 'broken in worktree', 'utf-8');

    // Discard worktree
    const discardRes = await service.discardWorktree(gitRepoDir, sessionId);
    expect(discardRes.success).toBe(true);

    // Main workspace is 100% clean and intact
    const mainContent = await fs.readFile(path.join(gitRepoDir, 'hello.txt'), 'utf-8');
    expect(mainContent).toBe('version 1');
  });

  it('integrates seamlessly with AgentCoreEngine', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: gitRepoDir,
      gitCheckpointEnabled: true,
      worktreeIsolationEnabled: false,
    });

    const mock = new MockProvider();
    mock.setScript([{ text: 'I am analyzing the repository without modifying files.' }]);

    let checkpointCreatedEmitted = false;
    engine.on('checkpoint:created', (payload) => {
      if (payload.sessionId === 'session_engine_test') {
        checkpointCreatedEmitted = true;
      }
    });

    await engine.startTask('Analyze project', {
      sessionId: 'session_engine_test',
      customProvider: mock,
    });

    expect(checkpointCreatedEmitted).toBe(true);

    const checkpoints = engine.getCheckpoints(gitRepoDir);
    expect(checkpoints.length).toBeGreaterThan(0);

    // Test rollback through engine
    const rollbackRes = await engine.rollbackCheckpoint('session_engine_test');
    expect(rollbackRes.success).toBe(true);

    await engine.dispose();
  });

  it('formats timeout notice in stderr when runGit times out', async () => {
    const timeoutError = Object.assign(new Error('Command timed out: git status'), {
      killed: true,
      signal: 'SIGTERM',
      code: 'ETIMEDOUT',
      stderr: 'fatal: timeout occurred',
    });
    vi.spyOn(service, 'executeGit').mockRejectedValueOnce(timeoutError);

    const res = await service.runGit(['status'], gitRepoDir, 10000);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('Git 命令執行逾時已強制終止: 超過 10 秒');
    expect(res.stderr).toContain('fatal: timeout occurred');
  });

  it('createWorktree cleans up directory and branch when creation fails', async () => {
    const failSessionId = 'session_fail_cleanup';
    await expect(
      service.createWorktree(gitRepoDir, failSessionId, 'invalid-nonexistent-ref'),
    ).rejects.toThrow('Git worktree add 失敗');

    const worktreePath = path.join(gitRepoDir, '.cline-worktrees', failSessionId);
    let exists = false;
    try {
      await fs.access(worktreePath);
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it('prunes old checkpoints when exceeding maxRetained limit', async () => {
    service.maxRetainedCheckpoints = 2;

    // Create 3 checkpoints
    await service.createCheckpoint(gitRepoDir, { sessionId: 's1', description: 'ckpt 1' });
    await new Promise((r) => setTimeout(r, 10));
    await service.createCheckpoint(gitRepoDir, { sessionId: 's2', description: 'ckpt 2' });
    await new Promise((r) => setTimeout(r, 10));
    const ckpt3 = await service.createCheckpoint(gitRepoDir, { sessionId: 's3', description: 'ckpt 3' });

    const currentCheckpoints = service.getCheckpoints(gitRepoDir);
    // Should have pruned and kept only the 2 newest
    expect(currentCheckpoints.length).toBe(2);
    expect(currentCheckpoints[0].id).toBe(ckpt3.id);
  });

  it('scans and prunes orphaned cline/task-* branches', async () => {
    // Create an orphaned branch manually
    const orphanBranch = 'cline/task-orphan_test_session';
    await execFileAsync('git', ['branch', orphanBranch], { cwd: gitRepoDir });

    const checkBefore = await execFileAsync('git', ['branch', '--list', orphanBranch], { cwd: gitRepoDir });
    expect(checkBefore.stdout).toContain(orphanBranch);

    // Call pruneStaleBranches
    const pruned = await service.pruneStaleBranches(gitRepoDir);
    expect(pruned).toContain(orphanBranch);

    const checkAfter = await execFileAsync('git', ['branch', '--list', orphanBranch], { cwd: gitRepoDir });
    expect(checkAfter.stdout).not.toContain(orphanBranch);
  });

  it('deletes all session git artifacts and branches via deleteSessionCheckpoints', async () => {
    const targetSession = 'session_to_delete';
    const safeSession = targetSession.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branchName = `cline/task-${safeSession}`;

    await service.createCheckpoint(gitRepoDir, { sessionId: targetSession, description: 'session ckpt' });
    await execFileAsync('git', ['branch', branchName], { cwd: gitRepoDir });

    expect(service.getCheckpoints(gitRepoDir).some((c) => c.sessionId === targetSession)).toBe(true);

    const res = await service.deleteSessionCheckpoints(gitRepoDir, targetSession);
    expect(res.deletedCheckpoints).toBeGreaterThan(0);
    expect(res.deletedBranches).toContain(branchName);

    expect(service.getCheckpoints(gitRepoDir).some((c) => c.sessionId === targetSession)).toBe(false);
  });
});
