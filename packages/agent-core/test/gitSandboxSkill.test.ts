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

async function runCliJsonFailure<T = Record<string, unknown>>(
  args: string[],
  cwd?: string,
): Promise<{ exitCode: number; payload: T }> {
  try {
    await execFileAsync(process.execPath, [SCRIPT_PATH, ...args, '--json'], {
      cwd: cwd ?? MONOREPO_ROOT,
      windowsHide: true,
    });
    throw new Error(`Expected CLI command to fail, but it succeeded: ${args.join(' ')}`);
  } catch (err) {
    const execErr = err as { code?: number; stdout?: string; stderr?: string };
    const rawStdout = String(execErr.stdout ?? '').trim();
    if (!rawStdout) {
      throw new Error(
        `CLI failed without JSON stdout (code=${String(execErr.code)}): ${String(execErr.stderr ?? '')}`,
      );
    }
    return {
      exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
      payload: JSON.parse(rawStdout) as T,
    };
  }
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

  it('accurately restores staged, unstaged, and deleted tracked files across rollback', async () => {
    const repo = path.join(testRoot, 'repo_staged_unstaged_deleted');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'staged.ts'), 'export const s = 1;\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'unstaged.ts'), 'export const u = 1;\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'deleted_staged.ts'), 'export const ds = 1;\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'deleted_unstaged.ts'), 'export const du = 1;\n', 'utf-8');
    await execFileAsync(
      'git',
      ['add', 'staged.ts', 'unstaged.ts', 'deleted_staged.ts', 'deleted_unstaged.ts'],
      { cwd: repo, windowsHide: true },
    );
    await execFileAsync('git', ['commit', '-m', 'base'], { cwd: repo, windowsHide: true });

    // Create staged + unstaged + staged-deleted + unstaged-deleted state before checkpoint
    await fs.writeFile(path.join(repo, 'staged.ts'), 'export const s = 2;\n', 'utf-8');
    await execFileAsync('git', ['add', 'staged.ts'], { cwd: repo, windowsHide: true });
    await fs.writeFile(path.join(repo, 'staged.ts'), 'export const s = 3;\n', 'utf-8'); // MM (staged 2, unstaged 3)

    await fs.writeFile(path.join(repo, 'unstaged.ts'), 'export const u = 2;\n', 'utf-8'); // _M
    await execFileAsync('git', ['rm', 'deleted_staged.ts'], { cwd: repo, windowsHide: true }); // D_
    await fs.rm(path.join(repo, 'deleted_unstaged.ts')); // _D

    const ckpt = await runCliJson<{
      success: boolean;
      checkpoint: { id: string; stashRef?: string };
    }>(['checkpoint', 'create', '--workspace', repo, '--session', 'mix']);
    expect(ckpt.success).toBe(true);
    expect(ckpt.checkpoint.stashRef).toBeTruthy();

    // Corrupt everything after checkpoint
    await fs.writeFile(path.join(repo, 'staged.ts'), 'CORRUPTED\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'unstaged.ts'), 'CORRUPTED\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'deleted_staged.ts'), 'SHOULD NOT EXIST\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'deleted_unstaged.ts'), 'SHOULD NOT EXIST\n', 'utf-8');
    await execFileAsync('git', ['add', '-A'], { cwd: repo, windowsHide: true });

    const rb = await runCliJson<{ success: boolean }>([
      'checkpoint',
      'rollback',
      '--workspace',
      repo,
      '--id',
      ckpt.checkpoint.id,
    ]);
    expect(rb.success).toBe(true);

    // Working tree contents restored accurately
    expect(await fs.readFile(path.join(repo, 'staged.ts'), 'utf-8')).toBe('export const s = 3;\n');
    expect(await fs.readFile(path.join(repo, 'unstaged.ts'), 'utf-8')).toBe(
      'export const u = 2;\n',
    );
    expect(await pathExists(path.join(repo, 'deleted_staged.ts'))).toBe(false);
    expect(await pathExists(path.join(repo, 'deleted_unstaged.ts'))).toBe(false);

    // Index (staged) state restored accurately
    const statusOut = await execFileAsync('git', ['status', '--porcelain=v1'], {
      cwd: repo,
      windowsHide: true,
    });
    const statusLines = statusOut.stdout.trimEnd().split(/\r?\n/);
    expect(statusLines).toContain('MM staged.ts');
    expect(statusLines).toContain(' M unstaged.ts');
    expect(statusLines).toContain('D  deleted_staged.ts');
    expect(statusLines).toContain(' D deleted_unstaged.ts');

    const stagedContent = await execFileAsync('git', ['show', ':staged.ts'], {
      cwd: repo,
      windowsHide: true,
    });
    expect(stagedContent.stdout).toBe('export const s = 2;\n');
  });

  it('preserves pre-existing untracked files even if staged after checkpoint (Option A boundary)', async () => {
    const repo = path.join(testRoot, 'repo_untracked_guard');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'base.ts'), 'export const base = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'base.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    // Only pre-existing untracked file (no dirty tracked edits)
    await fs.writeFile(path.join(repo, 'notes.txt'), 'original notes\n', 'utf-8');

    const ckpt = await runCliJson<{
      success: boolean;
      checkpoint: { id: string; stashRef?: string; untrackedFilesBefore: string[] };
    }>(['checkpoint', 'create', '--workspace', repo, '--session', 'untracked']);
    expect(ckpt.success).toBe(true);
    expect(ckpt.checkpoint.stashRef).toBeUndefined();
    expect(ckpt.checkpoint.untrackedFilesBefore).toContain('notes.txt');

    // Accidentally git add notes.txt and create a post-checkpoint untracked file
    await execFileAsync('git', ['add', 'notes.txt'], { cwd: repo, windowsHide: true });
    await fs.writeFile(path.join(repo, 'temp-after.txt'), 'delete me\n', 'utf-8');

    const rb = await runCliJson<{ success: boolean }>([
      'checkpoint',
      'rollback',
      '--workspace',
      repo,
      '--id',
      ckpt.checkpoint.id,
    ]);
    expect(rb.success).toBe(true);

    // notes.txt MUST NOT be deleted from disk even though it was staged before rollback
    expect(await pathExists(path.join(repo, 'notes.txt'))).toBe(true);
    expect(await fs.readFile(path.join(repo, 'notes.txt'), 'utf-8')).toBe('original notes\n');
    // Post-checkpoint untracked file must be deleted
    expect(await pathExists(path.join(repo, 'temp-after.txt'))).toBe(false);
  });

  it('handles filenames containing spaces and Unicode characters during checkpoint and rollback', async () => {
    const repo = path.join(testRoot, 'repo_unicode_spaces');
    await initTempGitRepo(repo);

    const trackedDir = path.join(repo, 'dir with space');
    await fs.mkdir(trackedDir, { recursive: true });
    const trackedRel = 'dir with space/中文檔案 name.txt';
    await fs.writeFile(path.join(repo, trackedRel), 'v1\n', 'utf-8');
    await execFileAsync('git', ['add', trackedRel], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init unicode'], { cwd: repo, windowsHide: true });

    // Dirty tracked + pre-existing untracked with spaces & Unicode
    await fs.writeFile(path.join(repo, trackedRel), 'dirty v2\n', 'utf-8');
    const preUntrackedRel = 'dir with space/保留 筆記.txt';
    await fs.writeFile(path.join(repo, preUntrackedRel), 'keep unicode\n', 'utf-8');

    const ckpt = await runCliJson<{ success: boolean; checkpoint: { id: string } }>([
      'checkpoint',
      'create',
      '--workspace',
      repo,
      '--session',
      'uni',
    ]);
    expect(ckpt.success).toBe(true);

    // Corrupt tracked file and add new Unicode/space untracked file
    await fs.writeFile(path.join(repo, trackedRel), 'BROKEN\n', 'utf-8');
    const postUntrackedRel = 'dir with space/多餘 檔案.txt';
    await fs.writeFile(path.join(repo, postUntrackedRel), 'remove me\n', 'utf-8');

    const rb = await runCliJson<{ success: boolean }>([
      'checkpoint',
      'rollback',
      '--workspace',
      repo,
      '--id',
      ckpt.checkpoint.id,
    ]);
    expect(rb.success).toBe(true);

    expect(await fs.readFile(path.join(repo, trackedRel), 'utf-8')).toBe('dirty v2\n');
    expect(await fs.readFile(path.join(repo, preUntrackedRel), 'utf-8')).toBe('keep unicode\n');
    expect(await pathExists(path.join(repo, postUntrackedRel))).toBe(false);
  });

  it('does not copy unignored .env into worktree and blocks committing sensitive files during worktree merge', async () => {
    const repo = path.join(testRoot, 'repo_sensitive_env');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'app.ts'), 'export const app = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'app.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    // .env is NOT in .gitignore
    await fs.writeFile(path.join(repo, '.env'), 'SECRET_KEY=topsecret\n', 'utf-8');

    const wt = await runCliJson<{ success: boolean; worktreePath: string }>([
      'worktree',
      'create',
      '--workspace',
      repo,
      '--session',
      'sec_wt',
    ]);
    expect(wt.success).toBe(true);
    // Must NOT copy unignored .env
    expect(await pathExists(path.join(wt.worktreePath, '.env'))).toBe(false);

    // Clean main repo .env so main workspace is clean before merge
    await fs.rm(path.join(repo, '.env'));

    // Create sensitive files inside worktree
    await fs.writeFile(path.join(wt.worktreePath, '.env'), 'LEAK=1\n', 'utf-8');
    await fs.writeFile(path.join(wt.worktreePath, 'secrets.json'), '{"token":"abc"}\n', 'utf-8');
    await fs.writeFile(path.join(wt.worktreePath, 'server.key'), 'PRIVATE KEY\n', 'utf-8');
    await fs.writeFile(path.join(wt.worktreePath, 'credentials.json'), '{"key":"123"}\n', 'utf-8');

    const mergeFail = await runCliJsonFailure<{
      success: boolean;
      error: string;
      files: string[];
    }>(['worktree', 'merge', '--workspace', repo, '--session', 'sec_wt']);
    expect(mergeFail.exitCode).toBe(1);
    expect(mergeFail.payload.success).toBe(false);
    expect(mergeFail.payload.error).toBe('Sensitive untracked files would be committed');
    expect(mergeFail.payload.files).toEqual(
      expect.arrayContaining(['.env', 'secrets.json', 'server.key', 'credentials.json']),
    );

    // Ensure no commit was created in worktree
    const logRes = await execFileAsync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: wt.worktreePath,
      windowsHide: true,
    });
    expect(Number(logRes.stdout.trim())).toBe(1);

    // Remove sensitive files and instead add .env.example (should be allowed)
    await fs.rm(path.join(wt.worktreePath, '.env'));
    await fs.rm(path.join(wt.worktreePath, 'secrets.json'));
    await fs.rm(path.join(wt.worktreePath, 'server.key'));
    await fs.rm(path.join(wt.worktreePath, 'credentials.json'));
    await fs.writeFile(path.join(wt.worktreePath, '.env.example'), 'PORT=3000\n', 'utf-8');

    const mergeOk = await runCliJson<{ success: boolean }>([
      'worktree',
      'merge',
      '--workspace',
      repo,
      '--session',
      'sec_wt',
    ]);
    expect(mergeOk.success).toBe(true);
    expect(await fs.readFile(path.join(repo, '.env.example'), 'utf-8')).toBe('PORT=3000\n');
  });

  it('prevents lost updates when creating multiple checkpoints in parallel', async () => {
    const repo = path.join(testRoot, 'repo_parallel_ckpt');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'index.ts'), 'export const x = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'index.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    const results = await Promise.all([
      runCliJson<{ success: boolean; checkpoint: { id: string } }>([
        'checkpoint',
        'create',
        '--workspace',
        repo,
        '--session',
        'parA',
      ]),
      runCliJson<{ success: boolean; checkpoint: { id: string } }>([
        'checkpoint',
        'create',
        '--workspace',
        repo,
        '--session',
        'parB',
      ]),
      runCliJson<{ success: boolean; checkpoint: { id: string } }>([
        'checkpoint',
        'create',
        '--workspace',
        repo,
        '--session',
        'parC',
      ]),
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    const createdIds = results.map((r) => r.checkpoint.id);

    const listed = await runCliJson<{ checkpoints: Array<{ id: string }> }>([
      'checkpoint',
      'list',
      '--workspace',
      repo,
    ]);
    expect(listed.checkpoints).toHaveLength(3);
    for (const id of createdIds) {
      expect(listed.checkpoints.some((c) => c.id === id)).toBe(true);
    }

    const refsOut = await execFileAsync(
      'git',
      ['for-each-ref', '--format=%(refname)', 'refs/harni/checkpoints/'],
      { cwd: repo, windowsHide: true },
    );
    const refLines = refsOut.stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(refLines).toHaveLength(3);
  });

  it('prevents lost updates when creating multiple worktrees in parallel', async () => {
    const repo = path.join(testRoot, 'repo_parallel_wt');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'index.ts'), 'export const x = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'index.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    const results = await Promise.all([
      runCliJson<{ success: boolean; sessionId: string }>([
        'worktree',
        'create',
        '--workspace',
        repo,
        '--session',
        'wtA',
      ]),
      runCliJson<{ success: boolean; sessionId: string }>([
        'worktree',
        'create',
        '--workspace',
        repo,
        '--session',
        'wtB',
      ]),
      runCliJson<{ success: boolean; sessionId: string }>([
        'worktree',
        'create',
        '--workspace',
        repo,
        '--session',
        'wtC',
      ]),
    ]);

    expect(results.every((r) => r.success)).toBe(true);

    const listed = await runCliJson<{ worktrees: Array<{ sessionId: string }> }>([
      'worktree',
      'list',
      '--workspace',
      repo,
    ]);
    expect(listed.worktrees).toHaveLength(3);
    expect(listed.worktrees.map((w) => w.sessionId).sort()).toEqual(['wtA', 'wtB', 'wtC']);
  });

  it('avoids session ID collisions and refuses overwriting existing worktree without --replace', async () => {
    const repo = path.join(testRoot, 'repo_session_collision');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'index.ts'), 'export const x = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'index.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    const sessions = ['feature/a', 'feature:a', 'feature a', 'feature_a'];
    const created = [];
    for (const s of sessions) {
      const res = await runCliJson<{
        success: boolean;
        sessionId: string;
        worktreePath: string;
        branch: string;
      }>(['worktree', 'create', '--workspace', repo, '--session', s]);
      expect(res.success).toBe(true);
      created.push(res);
    }

    const branches = new Set(created.map((c) => c.branch));
    const paths = new Set(created.map((c) => c.worktreePath));
    expect(branches.size).toBe(4);
    expect(paths.size).toBe(4);

    // Put a marker file inside feature_a worktree
    const targetWt = created.find((c) => c.sessionId === 'feature_a')!;
    const markerFile = path.join(targetWt.worktreePath, 'keep-me.txt');
    await fs.writeFile(markerFile, 'important work\n', 'utf-8');

    // Creating again without --replace must fail and preserve markerFile
    const dupFail = await runCliJsonFailure<{ success: boolean; error: string }>([
      'worktree',
      'create',
      '--workspace',
      repo,
      '--session',
      'feature_a',
    ]);
    expect(dupFail.exitCode).toBe(1);
    expect(dupFail.payload.success).toBe(false);
    expect(dupFail.payload.error).toContain('--replace');
    expect(await fs.readFile(markerFile, 'utf-8')).toBe('important work\n');

    // With --replace it succeeds and replaces the worktree
    const replaced = await runCliJson<{ success: boolean; worktreePath: string }>([
      'worktree',
      'create',
      '--workspace',
      repo,
      '--session',
      'feature_a',
      '--replace',
    ]);
    expect(replaced.success).toBe(true);
    expect(await pathExists(markerFile)).toBe(false);
  });

  it('rejects worktree merge when main workspace is dirty', async () => {
    const repo = path.join(testRoot, 'repo_dirty_main_merge');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'app.ts'), 'export const a = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'app.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    const wt = await runCliJson<{ success: boolean; worktreePath: string }>([
      'worktree',
      'create',
      '--workspace',
      repo,
      '--session',
      'wt_dirty_main',
    ]);
    expect(wt.success).toBe(true);
    await fs.writeFile(path.join(wt.worktreePath, 'new.ts'), 'export const n = 1;\n', 'utf-8');

    // Make main workspace dirty (both modified and untracked)
    await fs.writeFile(path.join(repo, 'app.ts'), 'export const a = 999;\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'scratch.txt'), 'uncommitted\n', 'utf-8');

    const fail = await runCliJsonFailure<{
      success: boolean;
      error: string;
      modified: string[];
      untracked: string[];
    }>(['worktree', 'merge', '--workspace', repo, '--session', 'wt_dirty_main']);

    expect(fail.exitCode).toBe(1);
    expect(fail.payload.success).toBe(false);
    expect(fail.payload.error).toBe('Main workspace must be clean before merge');
    expect(fail.payload.modified).toContain('app.ts');
    expect(fail.payload.untracked).toContain('scratch.txt');

    // Neither main workspace nor worktree should be harmed
    expect(await fs.readFile(path.join(repo, 'app.ts'), 'utf-8')).toBe('export const a = 999;\n');
    expect(await fs.readFile(path.join(wt.worktreePath, 'new.ts'), 'utf-8')).toBe(
      'export const n = 1;\n',
    );
  });

  it('automatically aborts merge conflict on worktree merge while preserving worktree', async () => {
    const repo = path.join(testRoot, 'repo_merge_conflict');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'shared.ts'), 'export const v = "base";\n', 'utf-8');
    await execFileAsync('git', ['add', 'shared.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'base'], { cwd: repo, windowsHide: true });

    const wt = await runCliJson<{ success: boolean; worktreePath: string }>([
      'worktree',
      'create',
      '--workspace',
      repo,
      '--session',
      'wt_conflict',
    ]);
    expect(wt.success).toBe(true);

    // Edit shared.ts on main and commit
    await fs.writeFile(path.join(repo, 'shared.ts'), 'export const v = "main-edit";\n', 'utf-8');
    await execFileAsync('git', ['add', 'shared.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'main change'], { cwd: repo, windowsHide: true });

    // Edit shared.ts differently in worktree
    await fs.writeFile(
      path.join(wt.worktreePath, 'shared.ts'),
      'export const v = "wt-edit";\n',
      'utf-8',
    );

    const fail = await runCliJsonFailure<{ success: boolean; error: string }>([
      'worktree',
      'merge',
      '--workspace',
      repo,
      '--session',
      'wt_conflict',
    ]);
    expect(fail.exitCode).toBe(1);
    expect(fail.payload.success).toBe(false);
    expect(fail.payload.error).toBe('Merge failed');

    // Main workspace must be clean with no MERGE_HEAD and no conflict markers
    const mainStatus = await runCliJson<{ isDirty: boolean }>([
      'status',
      '--workspace',
      repo,
    ]);
    expect(mainStatus.isDirty).toBe(false);
    expect(await pathExists(path.join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(await fs.readFile(path.join(repo, 'shared.ts'), 'utf-8')).toBe(
      'export const v = "main-edit";\n',
    );
    // Worktree must still be preserved
    expect(await fs.readFile(path.join(wt.worktreePath, 'shared.ts'), 'utf-8')).toBe(
      'export const v = "wt-edit";\n',
    );
  });

  it('validates workspace and repository ownership on checkpoint rollback', async () => {
    const repoA = path.join(testRoot, 'repo_owner_a');
    const repoB = path.join(testRoot, 'repo_owner_b');
    await initTempGitRepo(repoA);
    await initTempGitRepo(repoB);

    await fs.writeFile(path.join(repoA, 'a.ts'), 'export const a = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'a.ts'], { cwd: repoA, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init A'], { cwd: repoA, windowsHide: true });

    await fs.writeFile(path.join(repoB, 'b.ts'), 'export const b = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'b.ts'], { cwd: repoB, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init B'], { cwd: repoB, windowsHide: true });

    const ckptA = await runCliJson<{ success: boolean; checkpoint: { id: string } }>([
      'checkpoint',
      'create',
      '--workspace',
      repoA,
      '--session',
      'sharedSess',
    ]);
    expect(ckptA.success).toBe(true);

    // Create a worktree inside repoA (shares gitCommonDir & state file with repoA)
    const wtA = await runCliJson<{ success: boolean; worktreePath: string }>([
      'worktree',
      'create',
      '--workspace',
      repoA,
      '--session',
      'wt_owner',
    ]);
    expect(wtA.success).toBe(true);
    await fs.writeFile(path.join(wtA.worktreePath, 'a.ts'), 'worktree change\n', 'utf-8');

    // Rolling back inside wtA without --id must NOT fall back to repoA's checkpoint
    const noIdFail = await runCliJsonFailure<{ success: boolean; error: string }>([
      'checkpoint',
      'rollback',
      '--workspace',
      wtA.worktreePath,
      '--session',
      'sharedSess',
    ]);
    expect(noIdFail.exitCode).toBe(1);
    expect(noIdFail.payload.success).toBe(false);
    expect(await fs.readFile(path.join(wtA.worktreePath, 'a.ts'), 'utf-8')).toBe(
      'worktree change\n',
    );

    // Rolling back inside wtA WITH repoA's checkpoint --id must also be rejected
    const withIdFail = await runCliJsonFailure<{ success: boolean; error: string }>([
      'checkpoint',
      'rollback',
      '--workspace',
      wtA.worktreePath,
      '--id',
      ckptA.checkpoint.id,
    ]);
    expect(withIdFail.exitCode).toBe(1);
    expect(withIdFail.payload.success).toBe(false);
    expect(withIdFail.payload.error).toContain('belongs to a different workspace');
    expect(await fs.readFile(path.join(wtA.worktreePath, 'a.ts'), 'utf-8')).toBe(
      'worktree change\n',
    );

    // Rolling back in completely different repoB with ckptA's id must fail
    const crossRepoFail = await runCliJsonFailure<{ success: boolean; error: string }>([
      'checkpoint',
      'rollback',
      '--workspace',
      repoB,
      '--id',
      ckptA.checkpoint.id,
    ]);
    expect(crossRepoFail.exitCode).toBe(1);
    expect(crossRepoFail.payload.success).toBe(false);
  });

  it('supports checkpoint rollback --dry-run without modifying files or Git state', async () => {
    const repo = path.join(testRoot, 'repo_dry_run');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'app.ts'), 'export const v = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'app.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    await fs.writeFile(path.join(repo, 'app.ts'), 'export const v = 2;\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'keep.txt'), 'keep\n', 'utf-8');

    const ckpt = await runCliJson<{
      success: boolean;
      checkpoint: { id: string; commitHash: string };
    }>(['checkpoint', 'create', '--workspace', repo, '--session', 'dry']);
    expect(ckpt.success).toBe(true);

    // Post-checkpoint changes
    await fs.writeFile(path.join(repo, 'app.ts'), 'export const v = 99;\n', 'utf-8');
    await fs.writeFile(path.join(repo, 'extra.txt'), 'delete me later\n', 'utf-8');

    const preview = await runCliJson<{
      success: boolean;
      dryRun: boolean;
      checkpointId: string;
      wouldResetTo: string;
      trackedFilesToRestore: string[];
      untrackedFilesToDelete: string[];
      untrackedFilesToRestore: string[];
      untrackedFilesPreserved: string[];
    }>(['checkpoint', 'rollback', '--workspace', repo, '--id', ckpt.checkpoint.id, '--dry-run']);

    expect(preview.success).toBe(true);
    expect(preview.dryRun).toBe(true);
    expect(preview.checkpointId).toBe(ckpt.checkpoint.id);
    expect(preview.wouldResetTo).toBe(ckpt.checkpoint.commitHash);
    expect(preview.trackedFilesToRestore).toContain('app.ts');
    expect(preview.untrackedFilesToDelete).toEqual(['extra.txt']);
    expect(preview.untrackedFilesToRestore).toEqual([]);
    expect(preview.untrackedFilesPreserved).toEqual(['keep.txt']);

    // Nothing on disk was modified
    expect(await fs.readFile(path.join(repo, 'app.ts'), 'utf-8')).toBe('export const v = 99;\n');
    expect(await fs.readFile(path.join(repo, 'extra.txt'), 'utf-8')).toBe('delete me later\n');
    expect(await fs.readFile(path.join(repo, 'keep.txt'), 'utf-8')).toBe('keep\n');
  });

  it('recovers from stale state locks and refuses to overwrite corrupted state files', async () => {
    const repo = path.join(testRoot, 'repo_lock_and_corrupt');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'app.ts'), 'export const v = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'app.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    const lockPath = path.join(repo, '.git', 'harni-sandbox-state.json.lock');
    // Write a stale lock with a dead PID and old timestamp
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 99999999, createdAt: Date.now() - 120000 }),
      'utf-8',
    );

    const created = await runCliJson<{ success: boolean; checkpoint: { id: string } }>([
      'checkpoint',
      'create',
      '--workspace',
      repo,
      '--session',
      'stale_recover',
    ]);
    expect(created.success).toBe(true);
    expect(await pathExists(lockPath)).toBe(false);

    // Corrupt harni-sandbox-state.json and verify CLI refuses to overwrite it
    const statePath = path.join(repo, '.git', 'harni-sandbox-state.json');
    const corruptContent = '{ invalid json !!!';
    await fs.writeFile(statePath, corruptContent, 'utf-8');

    const corruptFail = await runCliJsonFailure<{ success: boolean; error: string }>([
      'checkpoint',
      'create',
      '--workspace',
      repo,
      '--session',
      'should_fail',
    ]);
    expect(corruptFail.exitCode).toBe(1);
    expect(corruptFail.payload.success).toBe(false);
    expect(corruptFail.payload.error).toContain('Corrupted sandbox state file');
    // Corrupted file must NOT be wiped/overwritten
    expect(await fs.readFile(statePath, 'utf-8')).toBe(corruptContent);
  });

  it('serializes parallel worktree create for the same session so the loser fails without deleting the winner', async () => {
    const repo = path.join(testRoot, 'repo_parallel_same_session_wt');
    await initTempGitRepo(repo);

    await fs.writeFile(path.join(repo, 'index.ts'), 'export const x = 1;\n', 'utf-8');
    await execFileAsync('git', ['add', 'index.ts'], { cwd: repo, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo, windowsHide: true });

    const runAttempt = async () => {
      try {
        const payload = await runCliJson<{
          success: boolean;
          sessionId: string;
          worktreePath: string;
          branch: string;
        }>(['worktree', 'create', '--workspace', repo, '--session', 'same_wt']);
        return { ok: true as const, payload };
      } catch (err) {
        const execErr = err as { code?: number; stdout?: string };
        return {
          ok: false as const,
          exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
          payload: JSON.parse(String(execErr.stdout ?? '{}')) as {
            success?: boolean;
            error?: string;
          },
        };
      }
    };

    const attempts = await Promise.all([runAttempt(), runAttempt()]);

    const winners = attempts.filter((a) => a.ok);
    const losers = attempts.filter((a) => !a.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].exitCode).toBe(1);
    expect(losers[0].payload.success).toBe(false);
    expect(losers[0].payload.error).toContain('--replace');

    const winner = winners[0].payload;
    expect(winner.success).toBe(true);
    expect(await pathExists(winner.worktreePath)).toBe(true);
    expect(await fs.readFile(path.join(winner.worktreePath, 'index.ts'), 'utf-8')).toBe(
      'export const x = 1;\n',
    );

    const branchCheck = await execFileAsync('git', ['branch', '--list', winner.branch], {
      cwd: repo,
      windowsHide: true,
    });
    expect(branchCheck.stdout.trim()).toContain(winner.branch);

    const listed = await runCliJson<{
      worktrees: Array<{ sessionId: string; branch: string; schemaVersion?: number }>;
    }>(['worktree', 'list', '--workspace', repo]);
    expect(listed.worktrees).toHaveLength(1);
    expect(listed.worktrees[0].sessionId).toBe('same_wt');
    expect(listed.worktrees[0].branch).toBe(winner.branch);
    expect(listed.worktrees[0].schemaVersion).toBe(1);
  });
});
