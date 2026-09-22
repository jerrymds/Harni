import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as path from 'node:path';
import {
  FSService,
  classifyWatcherError,
  createWatcherIgnoreMatcher,
  getWatcherErrorCode,
} from '../src/services/fsService.js';

interface FakeWatcher {
  closed: boolean;
  close: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => FakeWatcher;
  emit: (event: string, ...args: unknown[]) => boolean;
}

interface WatchCall {
  root: string;
  options: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  calls: [] as WatchCall[],
  watchers: [] as FakeWatcher[],
}));

// chokidar is replaced by an EventEmitter stub so the error/restart behaviour
// can be driven deterministically without touching the real filesystem.
vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events');

  class FakeFSWatcher extends EventEmitter {
    public closed = false;

    public async close(): Promise<void> {
      this.closed = true;
      // Listeners are intentionally kept: chokidar dispatches fs.watch errors
      // through callbacks captured before close(), so a stale error can still
      // reach the service after the watcher was replaced.
    }
  }

  return {
    FSWatcher: FakeFSWatcher,
    watch: (root: string, options: Record<string, unknown>) => {
      const watcher = new FakeFSWatcher();
      state.calls.push({ root, options });
      state.watchers.push(watcher as unknown as FakeWatcher);
      return watcher;
    },
  };
});

const nodeError = (code: string, message = code): Error =>
  Object.assign(new Error(message), { code, errno: -4048, syscall: 'watch' });

describe('FSService watcher resilience', () => {
  const workspaceRoot = path.resolve('temp_fswatcher_workspace');
  let fsService: FSService;
  let warnSpy: MockInstance;

  const latestOptions = (): Record<string, unknown> => state.calls[state.calls.length - 1].options;

  beforeEach(() => {
    state.calls.length = 0;
    state.watchers.length = 0;
    vi.useFakeTimers();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fsService = new FSService(workspaceRoot, 4);
  });

  afterEach(async () => {
    await fsService.close();
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('watches each root once with the workspace-relative ignore matcher', () => {
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].root).toBe(workspaceRoot);

    const options = latestOptions();
    expect(options.ignoreInitial).toBe(true);
    expect(options.persistent).toBe(true);
    expect(options.ignorePermissionErrors).toBe(true);
    expect(options.usePolling).toBe(false);

    expect(typeof options.ignored).toBe('function');
    const isIgnored = options.ignored as (testPath: string) => boolean;
    expect(isIgnored(workspaceRoot)).toBe(false);
    expect(isIgnored(path.join(workspaceRoot, 'src', 'index.ts'))).toBe(false);
    expect(isIgnored(path.join(workspaceRoot, 'node_modules', 'chokidar', 'index.js'))).toBe(true);
    expect(isIgnored(path.join(workspaceRoot, 'packages', 'types', 'dist', 'index.js'))).toBe(true);
    // chokidar hands over forward-slash normalized paths
    expect(isIgnored(`${workspaceRoot.replace(/\\/g, '/')}/.git/HEAD`)).toBe(true);
  });

  it('does not start a second watcher for the same root', () => {
    fsService.startWatching(workspaceRoot);
    fsService.startWatching();
    expect(state.calls).toHaveLength(1);
  });

  it('restarts in polling mode after a permission (EPERM) error', async () => {
    state.watchers[0].emit('error', nodeError('EPERM', 'EPERM: operation not permitted, watch'));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('EPERM');
    expect(message).toContain('polling fallback');
    expect(state.watchers[0].closed).toBe(true);

    await vi.advanceTimersByTimeAsync(1_200);

    expect(state.calls).toHaveLength(2);
    expect(latestOptions().usePolling).toBe(true);
    expect(latestOptions().ignorePermissionErrors).toBe(true);
    expect(fsService.getWatcherStatus(workspaceRoot)).toEqual({ watching: true, polling: true });
  });

  it('silently ignores errors for paths that disappeared mid-traversal', async () => {
    state.watchers[0].emit('error', nodeError('ENOENT'));

    await vi.advanceTimersByTimeAsync(2_000);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(state.calls).toHaveLength(1);
    expect(state.watchers[0].closed).toBe(false);
    expect(fsService.getWatcherStatus(workspaceRoot).polling).toBe(false);
  });

  it('ignores stale errors from a replaced watcher and throttles error storms', async () => {
    state.watchers[0].emit('error', new Error('watch failed'));
    // chokidar may still deliver queued errors from the watcher we just closed
    state.watchers[0].emit('error', new Error('watch failed again'));

    expect(warnSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_200);

    expect(state.calls).toHaveLength(2);
    expect(latestOptions().usePolling).toBe(false);
  });

  it('holds the restart while one is already pending', async () => {
    state.watchers[0].emit('error', nodeError('ENOSPC'));

    // e.g. getDirectoryNodes() calling startWatching right after the failure
    fsService.startWatching(workspaceRoot);
    expect(state.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_200);
    expect(state.calls).toHaveLength(2);
  });

  it('gives up after the restart budget is exhausted instead of looping forever', async () => {
    state.watchers[0].emit('error', nodeError('EPERM'));
    await vi.advanceTimersByTimeAsync(1_200);
    expect(state.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(30_000);
    state.watchers[1].emit('error', nodeError('EPERM'));
    await vi.advanceTimersByTimeAsync(1_200);
    expect(state.calls).toHaveLength(3);
    expect(state.watchers[2].closed).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    state.watchers[2].emit('error', nodeError('EPERM'));
    await vi.advanceTimersByTimeAsync(1_200);

    expect(state.calls).toHaveLength(3);
    expect(state.watchers[2].closed).toBe(true);
    expect(fsService.getWatcherStatus(workspaceRoot)).toEqual({ watching: false, polling: true });
    const lastMessage = String(warnSpy.mock.calls[warnSpy.mock.calls.length - 1][0]);
    expect(lastMessage).toContain('stopped after 2 restart attempts');
  });

  it('does not recreate watchers after close()', async () => {
    state.watchers[0].emit('error', nodeError('EPERM'));
    await fsService.close();
    await vi.advanceTimersByTimeAsync(1_200);

    expect(state.calls).toHaveLength(1);
    expect(fsService.getWatcherStatus(workspaceRoot)).toEqual({ watching: false, polling: false });
  });

  it('bounds watcher depth and entry budget by default', () => {
    const options = latestOptions();
    expect(options.depth).toBe(2);
    expect(options.maxEntries).toBe(3000);
  });

  it('honours HARNI_WATCH_DEPTH and HARNI_WATCH_MAX_ENTRIES overrides', async () => {
    process.env.HARNI_WATCH_DEPTH = '1';
    process.env.HARNI_WATCH_MAX_ENTRIES = '100';
    try {
      const svc = new FSService(workspaceRoot, 4);
      const options = latestOptions();
      expect(options.depth).toBe(1);
      expect(options.maxEntries).toBe(100);
      await svc.close();
    } finally {
      delete process.env.HARNI_WATCH_DEPTH;
      delete process.env.HARNI_WATCH_MAX_ENTRIES;
    }
  });
});

describe('FSService watcher helpers', () => {
  it('classifies watcher errors into ignorable / permission / unknown', () => {
    expect(classifyWatcherError(nodeError('ENOENT'))).toBe('ignorable');
    expect(classifyWatcherError(nodeError('ENOTDIR'))).toBe('ignorable');
    expect(classifyWatcherError(nodeError('EPERM'))).toBe('permission');
    expect(classifyWatcherError(nodeError('EACCES'))).toBe('permission');
    expect(classifyWatcherError(nodeError('ENOSPC'))).toBe('permission');
    expect(classifyWatcherError(nodeError('EMFILE'))).toBe('permission');
    expect(classifyWatcherError(new Error('plain error'))).toBe('unknown');
    expect(classifyWatcherError('not-an-error')).toBe('unknown');
    expect(classifyWatcherError(undefined)).toBe('unknown');
  });

  it('extracts only string error codes', () => {
    expect(getWatcherErrorCode(nodeError('EPERM'))).toBe('EPERM');
    expect(getWatcherErrorCode({ code: 'EBUSY' })).toBe('EBUSY');
    expect(getWatcherErrorCode({ code: 42 })).toBeUndefined();
    expect(getWatcherErrorCode(null)).toBeUndefined();
  });

  it('ignores cache/build directories but never the watch root', () => {
    const root = path.resolve('fake-workspace');
    const isIgnored = createWatcherIgnoreMatcher(root);

    expect(isIgnored(root)).toBe(false);
    expect(isIgnored(path.join(root, 'apps', 'web', 'src', 'App.tsx'))).toBe(false);
    expect(isIgnored(path.join(root, 'node_modules'))).toBe(true);
    expect(isIgnored(path.join(root, 'apps', 'server', 'node_modules', 'chokidar', 'index.js'))).toBe(
      true,
    );
    expect(isIgnored(path.join(root, 'coverage', 'index.html'))).toBe(true);
    expect(isIgnored(path.join(root, '.cache', 'keep.json'))).toBe(true);
    // paths outside the workspace are not this matcher's concern
    expect(isIgnored(path.resolve('..', 'outside-workspace'))).toBe(false);
  });

  it('keeps watching when the workspace root itself lives in an ignored-looking folder', () => {
    const root = path.resolve('somewhere', 'node_modules', 'my-project');
    const isIgnored = createWatcherIgnoreMatcher(root);

    expect(isIgnored(root)).toBe(false);
    expect(isIgnored(path.join(root, 'package.json'))).toBe(false);
    expect(isIgnored(path.join(root, 'dist', 'bundle.js'))).toBe(true);
  });
});
