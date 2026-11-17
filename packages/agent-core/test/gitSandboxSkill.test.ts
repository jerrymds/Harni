import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SkillRegistry } from '../src/index.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONOREPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_PATH = path.join(
  MONOREPO_ROOT,
  '.agents',
  'skills',
  'git-checkpoint-worktree',
  'scripts',
  'git-sandbox.mjs',
);

async function runCliJson<T = Record<string, unknown>>(args: string[], cwd?: string): Promise<T> {
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT_PATH, ...args, '--json'], {
    cwd: cwd ?? MONOREPO_ROOT,
    windowsHide: true,
  });
  return JSON.parse(stdout.trim()) as T;
}

async function initTempGitRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: dir, windowsHide: true });
  await execFileAsync('git', ['config', 'core.autocrlf', 'false'], {
    cwd: dir,
    windowsHide: true,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@harni.dev'], {
    cwd: dir,
    windowsHide: true,
  });
  await execFileAsync('git', ['config', 'user.name', 'Harni Test'], {
    cwd: dir,
    windowsHide: true,
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

describe('git-checkpoint-worktree Skill & CLI Integration Tests', () => {
  const testRoot = path.join(os.tmpdir(), `harni_git_sandbox_skill_${Date.now()}`);

  beforeAll(async () => {
    await fs.mkdir(testRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('discovers git-checkpoint-worktree skill via SkillRegistry.discoverWorkspaceSkills', async () => {
    const registry = new SkillRegistry(false);
    const discovered = await registry.discoverWorkspaceSkills(MONOREPO_ROOT);

    const skill = discovered.find((s) => s.name === 'git-checkpoint-worktree');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('git-checkpoint-worktree');
    expect(skill?.category).toBe('git');
    expect(skill?.description).toContain('shadow Git checkpoints');
    expect(skill?.requiredTools).toEqual(['run_command', 'read_file']);
    expect(skill?.instructions).toContain('git-sandbox.mjs');
    expect(skill?.instructions).toContain('cli-reference.md');
  });

  it('creates checkpoint across processes, preserves dirty tracked + pre-existing untracked files, and rolls back cleanly', async () => {
    const repo = path.join(testRoot, 'repo_checkpoint');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'app.ts'), 'export const v = "v1";\n', 'utf-8');
    await execFileAsync('git', ['add', 'app.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'initial commit'], { cwd: repo, windowsHide: true });

    // Pre-existing dirty tracked modification + pre-existing untracked file
    await fs.writeFile(path.join(repo, 'app.ts'), 'export const v = "dirty v1.5";\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'notes.txt'), 'keep me intact\n', 'utf-8');

    const statusBefore = await runCliJson<{
      isGitRepo: boolean;
      isDirty: boolean;
      modifiedFilesCount: number;
      untrackedFilesCount: number;
    }>(['status', '--workspace', repo]);
    expect(statusBefore.isGitRepo).toBe(true);
    expect(statusBefore.isDirty).toBe(true);
    expect(statusBefore.modifiedFilesCount).toBe(1);
    expect(statusBefore.untrackedFilesCount).toBe(1);

    // Child process 1: create checkpoint
    const created = await runCliJson<{
      success: boolean;
      checkpoint: {
        id: string;
        sessionId: string;
        stashRef?: string;
        dirtyFilesBefore: string[];
        untrackedFilesBefore: string[];
      };
    }>(['checkpoint', 'create', '--workspace', repo, '--session', 'sess1', '--desc', 'pre-edit']);
    expect(created.success).toBe(true);
    expect(created.checkpoint.id).toMatch(/^ckpt_sess1_/);
    expect(created.checkpoint.stashRef).toBeTruthy();
    expect(created.checkpoint.dirtyFilesBefore).toContain('app.ts');
    expect(created.checkpoint.untrackedFilesBefore).toContain('notes.txt');

    // Simulate bad agent edits: corrupt tracked file + add nested untracked files
    await fs.writeFile(path.join(repo, 'app.ts'), 'export const v = "BROKEN";\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'bad-temp.ts'), 'broken();\n', 'utf-8');
    await fs.mkdir(path.join(repo, 'tmp'), { recursive: true });
    await fs.writeFile(path.join(repo, 'tmp', 'junk.ts'), 'junk();\n', 'utf-8');

    // Child process 2: rollback checkpoint using --session
    const rolledBack = await runCliJson<{
      success: boolean;
      checkpointId: string;
      message: string;
    }>(['checkpoint', 'rollback', '--workspace', repo, '--session', 'sess1']);
    expect(rolledBack.success).toBe(true);
    expect(rolledBack.checkpointId).toBe(created.checkpoint.id);

    // Verify dirty v1.5 restored, notes.txt preserved, bad untracked files removed
    expect(await fs.readFile(path.join(repo, 'app.ts'), 'utf-8')).toBe(
      'export const v = "dirty v1.5";\n',
    );
    expect(await fs.readFile(path.join(repo, 'notes.txt'), 'utf-8')).toBe('keep me intact\n');
    expect(await pathExists(path.join(repo, 'bad-temp.ts'))).toBe(false);
    expect(await pathExists(path.join(repo, 'tmp', 'junk.ts'))).toBe(false);
  });

  it('creates isolated worktrees with linked node_modules/.env and safely merges or discards without harming main node_modules', async () => {
    const repo = path.join(testRoot, 'repo_worktree');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n.env\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'main.ts'), 'export const main = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', '.gitignore', 'main.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    // Create dummy node_modules and .env in main repo
    const pkgDir = path.join(repo, 'node_modules', 'pkg');
    await fs.mkdir(pkgDir, { recursive: true });
    const pkgEntry = path.join(pkgDir, 'index.js');
    await fs.writeFile(pkgEntry, 'module.exports = { ok: true };\n', 'utf-8');
    await fs.writeFile(path.join(repo, '.env'), 'HARNI_TEST_ENV=1\n', 'utf-8');

    // 1. Worktree create + merge
    const wtMerge = await runCliJson<{
      success: boolean;
      sessionId: string;
      worktreePath: string;
      branch: string;
    }>(['worktree', 'create', '--workspace', repo, '--session', 'wt_merge']);
    expect(wtMerge.success).toBe(true);
    expect(wtMerge.branch).toBe('harni/task-wt_merge');

    // Verify node_modules symlink/junction & .env exist in worktree
    const wtNodeModulesStat = await fs.lstat(path.join(wtMerge.worktreePath, 'node_modules'));
    expect(wtNodeModulesStat.isSymbolicLink()).toBe(true);
    expect(
      await fs.readFile(path.join(wtMerge.worktreePath, 'node_modules', 'pkg', 'index.js'), 'utf-8'),
    ).toBe('module.exports = { ok: true };\n');
    expect(await fs.readFile(path.join(wtMerge.worktreePath, '.env'), 'utf-8')).toBe(
      'HARNI_TEST_ENV=1\n',
    );

    // Worktree list should include wt_merge
    const listed = await runCliJson<{ worktrees: Array<{ sessionId: string }> }>([
      'worktree',
      'list',
      '--workspace',
      repo,
    ]);
    expect(listed.worktrees.some((w) => w.sessionId === 'wt_merge')).toBe(true);

    // Add feature inside worktree
    await fs.writeFile(
      path.join(wtMerge.worktreePath, 'feature.ts'),
      'export const feature = "ready";\n',
      'utf-8',
    );
    expect(await pathExists(path.join(repo, 'feature.ts'))).toBe(false);

    // Merge worktree back into main repo
    const merged = await runCliJson<{ success: boolean }>([
      'worktree',
      'merge',
      '--workspace',
      repo,
      '--session',
      'wt_merge',
      '--message',
      'feat: add feature from worktree',
    ]);
    expect(merged.success).toBe(true);
    expect(await fs.readFile(path.join(repo, 'feature.ts'), 'utf-8')).toBe(
      'export const feature = "ready";\n',
    );
    expect(await pathExists(wtMerge.worktreePath)).toBe(false);
    expect(await fs.readFile(pkgEntry, 'utf-8')).toBe('module.exports = { ok: true };\n');

    // 2. Worktree create + discard
    const wtDiscard = await runCliJson<{
      success: boolean;
      worktreePath: string;
      branch: string;
    }>(['worktree', 'create', '--workspace', repo, '--session', 'wt_discard']);
    expect(wtDiscard.success).toBe(true);

    await fs.writeFile(path.join(wtDiscard.worktreePath, 'main.ts'), 'corrupted\n', 'utf-8');
    const discarded = await runCliJson<{ success: boolean }>([
      'worktree',
      'discard',
      '--workspace',
      repo,
      '--session',
      'wt_discard',
    ]);
    expect(discarded.success).toBe(true);

    expect(await pathExists(wtDiscard.worktreePath)).toBe(false);
    expect(await fs.readFile(path.join(repo, 'main.ts'), 'utf-8')).toBe(
      'export const main = 1;\n',
    );
    expect(await fs.readFile(pkgEntry, 'utf-8')).toBe('module.exports = { ok: true };\n');

    const branchCheck = await execFileAsync('git', ['branch', '--list', wtDiscard.branch], {
      cwd: repo,
      windowsHide: true,
    });
    expect(branchCheck.stdout.trim()).toBe('');
  });

  it('prunes older checkpoint refs and orphaned worktree branches/directories', async () => {
    const repo = path.join(testRoot, 'repo_prune');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'index.ts'), 'export const a = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'index.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    // Create 4 checkpoints
    for (let i = 1; i <= 4; i++) {
      await runCliJson([
        'checkpoint',
        'create',
        '--workspace',
        repo,
        '--session',
        `p${i}`,
        '--desc',
        `ckpt ${i}`,
      ]);
    }

    const listBefore = await runCliJson<{ checkpoints: Array<{ id: string }> }>([
      'checkpoint',
      'list',
      '--workspace',
      repo,
    ]);
    expect(listBefore.checkpoints).toHaveLength(4);

    // Prune keeping newest 2
    const pruned = await runCliJson<{ success: boolean; deletedCount: number }>([
      'checkpoint',
      'prune',
      '--workspace',
      repo,
      '--max',
      '2',
    ]);
    expect(pruned.success).toBe(true);
    expect(pruned.deletedCount).toBe(2);

    const listAfter = await runCliJson<{ checkpoints: Array<{ id: string }> }>([
      'checkpoint',
      'list',
      '--workspace',
      repo,
    ]);
    expect(listAfter.checkpoints).toHaveLength(2);

    const refsOut = await execFileAsync(
      'git',
      ['for-each-ref', '--format=%(refname)', 'refs/harni/checkpoints/'],
      { cwd: repo, windowsHide: true },
    );
    const refLines = refsOut.stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(refLines).toHaveLength(2);

    // Create an orphaned harni/task-* branch and an orphaned .harni-worktrees dir
    await execFileAsync('git', ['branch', 'harni/task-orphan_branch'], {
      cwd: repo,
      windowsHide: true,
    });
    const orphanDir = path.join(repo, '.harni-worktrees', 'orphan_dir');
    await fs.mkdir(orphanDir, { recursive: true });
    await fs.writeFile(path.join(orphanDir, 'stale.txt'), 'stale', 'utf-8');

    const wtPruned = await runCliJson<{
      success: boolean;
      prunedBranches: string[];
      removedDirs: string[];
    }>(['worktree', 'prune', '--workspace', repo]);
    expect(wtPruned.success).toBe(true);
    expect(wtPruned.prunedBranches).toContain('harni/task-orphan_branch');
    expect(wtPruned.removedDirs).toContain('orphan_dir');
    expect(await pathExists(orphanDir)).toBe(false);
  });
});
