import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveSafePath, isPathWithinRoot } from '../src/utils/pathSecurity.js';

describe('pathSecurity (resolveSafePath & dangling symlink protection)', () => {
  const baseTempDir = path.resolve('temp_path_security_test');
  let workspaceDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    workspaceDir = path.join(baseTempDir, 'workspace');
    outsideDir = path.join(baseTempDir, 'outside');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(baseTempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('allows normal relative paths and filenames starting with double dots inside workspace', () => {
    expect(resolveSafePath('src/index.ts', workspaceDir)).toBe(
      path.join(workspaceDir, 'src', 'index.ts'),
    );
    expect(resolveSafePath('..config', workspaceDir)).toBe(path.join(workspaceDir, '..config'));
    expect(isPathWithinRoot(path.join(workspaceDir, 'sub'), workspaceDir)).toBe(true);
  });

  it('blocks lexical traversal outside workspace root', () => {
    expect(() => resolveSafePath('../outside/secret.txt', workspaceDir)).toThrow(
      /Path traversal denied/,
    );
    expect(() => resolveSafePath(path.join(outsideDir, 'secret.txt'), workspaceDir)).toThrow(
      /Path traversal denied/,
    );
    expect(isPathWithinRoot(outsideDir, workspaceDir)).toBe(false);
  });

  it('blocks dangling directory junction/symlink pointing to nonexistent path outside workspace', async () => {
    const danglingTarget = path.join(outsideDir, 'nonexistent_dir');
    const linkPath = path.join(workspaceDir, 'dangling_dir_link');

    // On Windows, 'junction' works without SeCreateSymbolicLinkPrivilege
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(danglingTarget, linkPath, linkType);

    expect(() => resolveSafePath('dangling_dir_link', workspaceDir)).toThrow(
      /Path traversal denied.*dangling symlink/,
    );
    expect(() => resolveSafePath(path.join('dangling_dir_link', 'payload.txt'), workspaceDir)).toThrow(
      /Path traversal denied.*dangling symlink/,
    );
  });

  it('allows dangling symlink/junction whose target stays inside workspace', async () => {
    const safeTarget = path.join(workspaceDir, 'future_subdir');
    const linkPath = path.join(workspaceDir, 'safe_dangling_link');

    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(safeTarget, linkPath, linkType);

    expect(resolveSafePath(path.join('safe_dangling_link', 'file.txt'), workspaceDir)).toBe(
      path.join(workspaceDir, 'safe_dangling_link', 'file.txt'),
    );
  });

  it('blocks existing symlink/junction pointing outside workspace', async () => {
    const existingOutside = path.join(outsideDir, 'real_outside_dir');
    await fs.mkdir(existingOutside, { recursive: true });
    const linkPath = path.join(workspaceDir, 'escape_dir_link');

    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(existingOutside, linkPath, linkType);

    expect(() => resolveSafePath(path.join('escape_dir_link', 'new_file.txt'), workspaceDir)).toThrow(
      /Path traversal denied.*symlink/,
    );
  });

  it('blocks file dangling symlink pointing outside workspace when supported by OS', async () => {
    const linkPath = path.join(workspaceDir, 'dangling_file_link');
    const missingOutsideFile = path.join(outsideDir, 'missing_secret.txt');

    let created = false;
    try {
      await fs.symlink(missingOutsideFile, linkPath, 'file');
      created = true;
    } catch (err: any) {
      if (err?.code === 'EPERM' || err?.code === 'ENOTSUP') {
        // Non-privileged Windows without Developer Mode cannot create file symlinks
        return;
      }
      throw err;
    }

    if (created) {
      expect(() => resolveSafePath('dangling_file_link', workspaceDir)).toThrow(
        /Path traversal denied.*dangling symlink/,
      );
    }
  });
});
