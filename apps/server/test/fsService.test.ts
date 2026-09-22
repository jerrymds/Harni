import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FSService, ConcurrencyLimiter, DEFAULT_DIR_CACHE_MAX_ENTRIES } from '../src/services/fsService.js';

describe('FSService & ConcurrencyLimiter', () => {
  const tempDir = path.resolve('temp_fsservice_test');
  let fsService: FSService;

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, 'src', 'nested'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
    await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), 'console.log("hello");', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'src', 'nested', 'helper.ts'), 'export const a = 1;', 'utf-8');

    fsService = new FSService(tempDir, 4);
  });

  afterEach(async () => {
    if (fsService) {
      await fsService.close();
    }
    await new Promise((r) => setTimeout(r, 100));
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  });

  it('limits concurrency using ConcurrencyLimiter', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let maxRunning = 0;
    let currentlyRunning = 0;

    const task = async () => {
      return limiter.run(async () => {
        currentlyRunning++;
        maxRunning = Math.max(maxRunning, currentlyRunning);
        await new Promise((r) => setTimeout(r, 30));
        currentlyRunning--;
      });
    };

    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('prevents directory traversal', () => {
    expect(() => {
      fsService.resolveSafePath('../../etc/passwd');
    }).toThrow(/Path traversal denied/);
  });

  it('performs lazy loading at depth 1 with undefined children for subdirectories', async () => {
    const nodes = await fsService.getDirectoryNodes('');
    expect(nodes.length).toBeGreaterThan(0);

    const srcDir = nodes.find((n) => n.name === 'src');
    expect(srcDir).toBeDefined();
    expect(srcDir?.type).toBe('directory');
    expect(srcDir?.children).toBeUndefined();

    const pkgFile = nodes.find((n) => n.name === 'package.json');
    expect(pkgFile).toBeDefined();
    expect(pkgFile?.type).toBe('file');
    expect(pkgFile?.size).toBeGreaterThan(0);
  });

  it('fetches subdirectories on demand', async () => {
    const srcNodes = await fsService.getDirectoryNodes('src');
    expect(srcNodes.length).toBe(2);

    const indexFile = srcNodes.find((n) => n.name === 'index.ts');
    expect(indexFile).toBeDefined();
    expect(indexFile?.type).toBe('file');

    const nestedDir = srcNodes.find((n) => n.name === 'nested');
    expect(nestedDir).toBeDefined();
    expect(nestedDir?.type).toBe('directory');
  });

  it('uses in-memory directory cache on subsequent reads', async () => {
    const initial = await fsService.getDirectoryNodes('');
    const cached = await fsService.getDirectoryNodes('');

    expect(cached).toEqual(initial);

    // Invalidate cache
    fsService.invalidateCache(tempDir, '');
    const refreshed = await fsService.getDirectoryNodes('');
    expect(refreshed).toEqual(initial);
  });

  it('invalidates cache and emits notification when writeFile is called', async () => {
    await fsService.getDirectoryNodes('');

    await fsService.writeFile('new_file.txt', 'Hello New File');
    const nodesAfter = await fsService.getDirectoryNodes('');

    const newFile = nodesAfter.find((n) => n.name === 'new_file.txt');
    expect(newFile).toBeDefined();
    expect(newFile?.type).toBe('file');
  });

  it('computes workspace info and counts files properly', async () => {
    const info = await fsService.getWorkspaceInfo();
    expect(info.rootPath).toBe(tempDir);
    expect(info.totalFiles).toBe(3);
    expect(info.isGitRepo).toBe(false);
  });

  it('builds multi-depth tree when requested', async () => {
    const fullTree = await fsService.getFileTree(3);
    const srcNode = fullTree.find((n) => n.name === 'src');
    expect(srcNode?.children).toBeDefined();
    const nestedNode = srcNode?.children?.find((n) => n.name === 'nested');
    expect(nestedNode?.children).toBeDefined();
    expect(nestedNode?.children?.some((n) => n.name === 'helper.ts')).toBe(true);
  });

  it('keeps the directory cache bounded when many directories are read', async () => {
    const many = path.join(tempDir, 'many');
    for (let i = 0; i < DEFAULT_DIR_CACHE_MAX_ENTRIES + 50; i++) {
      await fs.mkdir(path.join(many, `dir_${i}`), { recursive: true });
    }

    for (let i = 0; i < DEFAULT_DIR_CACHE_MAX_ENTRIES + 50; i++) {
      await fsService.getDirectoryNodes(`many/dir_${i}`);
    }

    expect(fsService.getCacheSize()).toBeLessThanOrEqual(DEFAULT_DIR_CACHE_MAX_ENTRIES);
  });

  it('counts files through a bounded walk that never populates the cache', async () => {
    const info = await fsService.getWorkspaceInfo();
    expect(info.totalFiles).toBe(3);
    // The summary scan must not cache directories (huge trees would be retained)
    expect(fsService.getCacheSize()).toBe(0);
  });

  it('ignores cache/build directories and dot-directories when counting files', async () => {
    await fs.mkdir(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'node_modules', 'pkg', 'index.js'), 'x', 'utf-8');
    await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
    await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), 'ref', 'utf-8');
    await fs.writeFile(path.join(tempDir, '.env'), 'A=1', 'utf-8');

    const info = await fsService.getWorkspaceInfo();
    // node_modules and .git are skipped; the dotfile .env is still counted
    expect(info.totalFiles).toBe(4);
  });
});
