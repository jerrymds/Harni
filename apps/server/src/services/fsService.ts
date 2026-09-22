import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { watch, type ChokidarOptions, type FSWatcher } from 'chokidar';
import type { FileNode, WorkspaceInfo } from '@harni/types';

export interface WatcherLimits {
  /** Watcher scanning depth below the workspace root. Default 2. */
  depth?: number;
  /** Hard cap on watched entries per workspace. Default 3000. */
  maxEntries?: number;
  /** File size cap (bytes) for chokidar atomic-write bookkeeping. Default 50MB. */
  awaitWriteFinishThreshold?: number;
}

/** Default watcher depth when HARNI_WATCH_DEPTH is not set. */
export const DEFAULT_WATCH_DEPTH = 2;
/** Default cap on watched entries per workspace when HARNI_WATCH_MAX_ENTRIES is not set. */
export const DEFAULT_WATCH_MAX_ENTRIES = 3000;

const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.turbo',
  'dist',
  'build',
  '.next',
  '.cache',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
]);

/**
 * A path segment is ignored when it is a cache/build artifact or a dot entry
 * (`.git`, `.cache`, `.next`, ...), matching the previous regex-based behavior.
 */
function isIgnoredSegment(segment: string): boolean {
  return segment.startsWith('.') || IGNORED_NAMES.has(segment);
}

/**
 * Build the chokidar `ignored` predicate for a workspace root.
 *
 * chokidar v4 removed glob support: string entries are compared with strict
 * equality (`matcher === string`), so the legacy `'**\/node_modules/**'`-style
 * patterns silently matched nothing. As a result chokidar watched ~750
 * directories inside `node_modules/.pnpm` (pnpm junctions plus locked binaries
 * on Windows), wasting file handles and surfacing
 * `EPERM: operation not permitted, watch` errors.
 *
 * A predicate over the workspace-relative path segments restores the intended
 * ignore rules on any chokidar version.
 */
export function createWatcherIgnoreMatcher(workspaceRoot: string): (testPath: string) => boolean {
  const root = path.resolve(workspaceRoot);
  return (testPath: string): boolean => {
    // chokidar normalizes tested paths to forward slashes. Never ignore the
    // watch root itself so a workspace located inside e.g. `dist/` still works.
    const relative = path.relative(root, testPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return false;
    }
    return relative
      .split(/[/\\]+/)
      .some((segment) => segment !== '' && isIgnoredSegment(segment));
  };
}

/**
 * Errors that simply mean "this path is gone", which chokidar already recovers
 * from internally. They must not trigger log spam or watcher restarts.
 */
const IGNORABLE_WATCH_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

/**
 * Errors where the OS refused to watch a path, or the process ran out of watch
 * resources. Retrying in polling mode (or the same mode) is the documented
 * mitigation for these.
 */
const PERMISSION_WATCH_ERROR_CODES = new Set([
  'EPERM',
  'EACCES',
  'ENOSPC',
  'EMFILE',
  'ENFILE',
  'EBUSY',
]);

/** Minimum delay between two watcher-error log lines / restarts for one root. */
const WATCHER_ERROR_COOLDOWN_MS = 30_000;
/** Grace period before a failed watcher is recreated. */
const WATCHER_RESTART_DELAY_MS = 1_000;
/** Upper bound on automatic restarts, so a broken root cannot loop forever. */
const MAX_WATCHER_RESTART_ATTEMPTS = 2;
/** Polling interval used by the fallback watcher (ms). */
const WATCHER_POLL_INTERVAL_MS = 1_000;

export type WatcherErrorKind = 'ignorable' | 'permission' | 'unknown';

/**
 * Extract the Node error code (EPERM, ENOSPC, ...) from an unknown thrown value.
 */
export function getWatcherErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

/**
 * Classify a watcher error so the service can decide between ignoring it,
 * retrying with polling, or retrying in the current mode.
 */
export function classifyWatcherError(error: unknown): WatcherErrorKind {
  const code = getWatcherErrorCode(error);
  if (code && IGNORABLE_WATCH_ERROR_CODES.has(code)) {
    return 'ignorable';
  }
  if (code && PERMISSION_WATCH_ERROR_CODES.has(code)) {
    return 'permission';
  }
  return 'unknown';
}

/**
 * Build a short, single-line description of a watcher error (avoids dumping a
 * raw stack trace into the server log on every filesystem hiccup).
 */
function describeWatcherError(error: unknown): string {
  const code = getWatcherErrorCode(error);
  if (code) {
    return code;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lightweight async concurrency limiter to prevent file descriptor exhaustion (EMFILE)
 */
export class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number = 16) {}

  public async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

/** Default cap on number of directories kept in the in-memory directory cache. */
export const DEFAULT_DIR_CACHE_MAX_ENTRIES = 500;

/** Maximum number of directories visited by a workspace summary scan. */
export const WORKSPACE_INFO_MAX_DIRS = 2000;
/** Depth limit for the workspace summary scan. */
export const WORKSPACE_INFO_MAX_DEPTH = 3;
/** Wall-clock budget (ms) for the workspace summary scan. */
export const WORKSPACE_INFO_TIME_BUDGET_MS = 1500;

interface DirCacheEntry {
  nodes: FileNode[];
  timestamp: number;
}

export class FSService {
  private workspaceRoot: string;
  private limiter: ConcurrencyLimiter;
  private dirCache = new Map<string, DirCacheEntry>();
  private cacheTTLMs = 30000; // 30s cache TTL
  private cacheMaxEntries = DEFAULT_DIR_CACHE_MAX_ENTRIES;
  private watchers = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private onTreeChangeListeners: Array<(tree: FileNode[], workspaceRoot: string) => void> = [];
  private onDirChangeListeners: Array<(relPath: string, children: FileNode[], workspaceRoot: string) => void> = [];
  /** Roots that must be watched with polling (fs.watch refused or ran out of handles). */
  private pollingRoots = new Set<string>();
  /** Pending watcher restarts, keyed by workspace root. */
  private watcherRestartTimers = new Map<string, NodeJS.Timeout>();
  /** Automatic restart attempts per root, to stop restart loops. */
  private watcherRestartAttempts = new Map<string, number>();
  /** Last time a watcher error was reported per root, to throttle log spam. */
  private watcherErrorReportedAt = new Map<string, number>();
  private closed = false;

  constructor(workspaceRoot: string, concurrencyLimit = 16) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.limiter = new ConcurrencyLimiter(concurrencyLimit);
    this.startWatching(this.workspaceRoot);
  }

  public getWorkspaceRoot(customRoot?: string): string {
    return customRoot ? path.resolve(customRoot) : this.workspaceRoot;
  }

  public setWorkspaceRoot(newRoot: string): void {
    const resolved = path.resolve(newRoot);
    if (resolved !== this.workspaceRoot) {
      this.stopWatching(this.workspaceRoot).catch(() => {});
      this.workspaceRoot = resolved;
      this.startWatching(this.workspaceRoot);
      this.notifyTreeChange(this.workspaceRoot);
    }
  }

  /**
   * Safely resolves a path and prevents path traversal outside the workspaceRoot.
   */
  public resolveSafePath(targetPath: string, customRoot?: string): string {
    const root = path.resolve(customRoot || this.workspaceRoot);
    const resolved = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(root, targetPath);

    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal denied: '${targetPath}' is outside workspace root '${root}'`,
      );
    }
    return resolved;
  }

  /**
   * Read file content safely
   */
  public async readFile(targetPath: string, customRoot?: string): Promise<string> {
    const safePath = this.resolveSafePath(targetPath, customRoot);
    return await this.limiter.run(() => fs.readFile(safePath, 'utf-8'));
  }

  /**
   * Write file content safely (creating parent directories if needed)
   */
  public async writeFile(targetPath: string, content: string, customRoot?: string): Promise<void> {
    const safePath = this.resolveSafePath(targetPath, customRoot);
    const root = path.resolve(customRoot || this.workspaceRoot);
    const relPath = path.relative(root, safePath).replace(/\\/g, '/');
    const parentRelDir = path.posix.dirname(relPath) === '.' ? '' : path.posix.dirname(relPath);

    await this.limiter.run(async () => {
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, content, 'utf-8');
    });

    this.invalidateCache(root, parentRelDir);
    this.notifyDirChange(parentRelDir, root);
    this.notifyTreeChange(root);
  }

  private getCacheKey(root: string, relPath: string): string {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return `${root}::${normalized}`;
  }

  /**
   * Keep the directory cache bounded.
   *
   * The cache used to grow without limit. A recursive scan of a large
   * workspace (the desktop shell defaults to the user home directory) cached
   * every visited directory's node array forever, which is what pushed the
   * packaged app's memory into the gigabytes. The Map iterates in insertion
   * order, so dropping from the front is a cheap FIFO eviction.
   */
  private evictOldestCacheEntries(): void {
    while (this.dirCache.size > this.cacheMaxEntries) {
      const oldestKey = this.dirCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.dirCache.delete(oldestKey);
    }
  }

  /** Number of cached directories (bounded by cacheMaxEntries). */
  public getCacheSize(): number {
    return this.dirCache.size;
  }

  /**
   * Invalidate directory cache for a path and its ancestors
   */
  public invalidateCache(customRoot?: string, relPath?: string): void {
    const root = path.resolve(customRoot || this.workspaceRoot);
    if (relPath === undefined) {
      // Invalidate all caches for this root
      const prefix = `${root}::`;
      for (const key of Array.from(this.dirCache.keys())) {
        if (key.startsWith(prefix)) {
          this.dirCache.delete(key);
        }
      }
      return;
    }

    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    let current: string | null = normalized;
    while (current !== null) {
      this.dirCache.delete(this.getCacheKey(root, current));
      if (current === '') {
        current = null;
      } else {
        const next = path.posix.dirname(current);
        current = next === '.' ? '' : next;
      }
    }
  }

  /**
   * Get single-level directory children (depth 1) with in-memory caching and concurrency limits
   */
  public async getDirectoryNodes(targetRelativePath = '', customRoot?: string): Promise<FileNode[]> {
    const root = path.resolve(customRoot || this.workspaceRoot);
    const safeDirPath = this.resolveSafePath(targetRelativePath, root);
    const normalizedRelDir = path.relative(root, safeDirPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const cacheKey = this.getCacheKey(root, normalizedRelDir);

    const cached = this.dirCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTLMs) {
      return cached.nodes;
    }

    try {
      const dirents = await this.limiter.run(() =>
        fs.readdir(safeDirPath, { withFileTypes: true }),
      );

      // Sort: directories first, then alphabetical
      dirents.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      const nodes: FileNode[] = [];
      const statPromises: Promise<void>[] = [];

      for (const dirent of dirents) {
        if (IGNORED_NAMES.has(dirent.name)) continue;

        const childRelPath = normalizedRelDir
          ? `${normalizedRelDir}/${dirent.name}`
          : dirent.name;
        const childFullPath = path.join(safeDirPath, dirent.name);

        if (dirent.isDirectory()) {
          nodes.push({
            name: dirent.name,
            path: childRelPath,
            type: 'directory',
          });
        } else {
          const fileNode: FileNode = {
            name: dirent.name,
            path: childRelPath,
            type: 'file',
            size: 0,
            lastModified: 0,
          };
          nodes.push(fileNode);

          statPromises.push(
            this.limiter.run(async () => {
              try {
                const stat = await fs.stat(childFullPath);
                fileNode.size = stat.size;
                fileNode.lastModified = stat.mtimeMs;
              } catch {
                // ignore stat error
              }
            }),
          );
        }
      }

      if (statPromises.length > 0) {
        await Promise.all(statPromises);
      }

      this.dirCache.set(cacheKey, {
        nodes,
        timestamp: Date.now(),
      });
      this.evictOldestCacheEntries();

      // Ensure watcher is active
      this.startWatching(root);

      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * Build hierarchical FileNode tree of workspace.
   * Defaults to depth 1 for lazy loading, but supports recursive traversal up to maxDepth.
   */
  public async getFileTree(maxDepth = 1, customRoot?: string): Promise<FileNode[]> {
    const root = path.resolve(customRoot || this.workspaceRoot);

    const buildTree = async (relativeDir: string, currentDepth: number): Promise<FileNode[]> => {
      if (currentDepth > maxDepth) return [];

      const nodes = await this.getDirectoryNodes(relativeDir, root);
      if (currentDepth >= maxDepth) {
        return nodes;
      }

      const cloneNodes: FileNode[] = [];
      for (const node of nodes) {
        if (node.type === 'directory') {
          const children = await buildTree(node.path, currentDepth + 1);
          cloneNodes.push({
            ...node,
            children,
          });
        } else {
          cloneNodes.push({ ...node });
        }
      }
      return cloneNodes;
    };

    return await buildTree('', 1);
  }

  /**
   * Get workspace info summary.
   *
   * The file count is produced by a bounded, cache-free walk: depth, visited
   * directories and elapsed time are all capped. The previous implementation
   * recursed through `getDirectoryNodes`, which cached every visited
   * directory forever and stat-ed every file (millions of entries when the
   * workspace is a user home directory), so a single summary request could
   * retain gigabytes. `totalFiles` is therefore a bounded estimate for huge
   * workspaces rather than an exhaustive count.
   */
  public async getWorkspaceInfo(customRoot?: string): Promise<WorkspaceInfo> {
    const root = path.resolve(customRoot || this.workspaceRoot);

    let isGitRepo = false;
    try {
      await fs.stat(path.join(root, '.git'));
      isGitRepo = true;
    } catch {
      isGitRepo = false;
    }

    const totalFiles = await this.countFilesBounded(root);

    return {
      rootPath: root,
      totalFiles,
      isGitRepo,
    };
  }

  /**
   * Bounded breadth-first file count used by `getWorkspaceInfo`.
   * Never touches the directory cache, so a huge tree cannot be retained.
   */
  private async countFilesBounded(root: string): Promise<number> {
    const deadline = Date.now() + WORKSPACE_INFO_TIME_BUDGET_MS;
    let totalFiles = 0;
    let visitedDirs = 0;
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

    while (queue.length > 0) {
      if (visitedDirs >= WORKSPACE_INFO_MAX_DIRS || Date.now() > deadline) {
        break;
      }
      const { dir, depth } = queue.shift() as { dir: string; depth: number };
      visitedDirs += 1;

      let dirents: Dirent[];
      try {
        dirents = await this.limiter.run(() => fs.readdir(dir, { withFileTypes: true }));
      } catch {
        continue;
      }

      for (const dirent of dirents) {
        if (IGNORED_NAMES.has(dirent.name)) continue;
        if (dirent.isDirectory()) {
          // Skip dot-directories (.git, .cache, ...) but still count dotfiles.
          if (dirent.name.startsWith('.')) continue;
          if (depth + 1 <= WORKSPACE_INFO_MAX_DEPTH) {
            queue.push({ dir: path.join(dir, dirent.name), depth: depth + 1 });
          }
        } else {
          totalFiles += 1;
        }
      }
    }

    return totalFiles;
  }

  /**
   * Start Chokidar watcher on a workspace root
   */
  public startWatching(customRoot?: string): void {
    const root = path.resolve(customRoot || this.workspaceRoot);
    if (this.closed || this.watchers.has(root) || this.watcherRestartTimers.has(root)) return;

    try {
      const watcher = watch(root, this.buildWatchOptions(root));

      const handleEvent = (filePath: string) => {
        try {
          const relPath = path.relative(root, filePath).replace(/\\/g, '/');
          const parentRelDir = path.posix.dirname(relPath) === '.' ? '' : path.posix.dirname(relPath);
          this.invalidateCache(root, parentRelDir);
          this.scheduleDebouncedDirNotification(root, parentRelDir);
        } catch {
          // ignore
        }
      };

      watcher.on('add', handleEvent);
      watcher.on('unlink', handleEvent);
      watcher.on('addDir', handleEvent);
      watcher.on('unlinkDir', handleEvent);
      watcher.on('change', handleEvent);
      watcher.on('error', (error: unknown) => {
        this.handleWatcherError(root, watcher, error);
      });

      this.watchers.set(root, watcher);
    } catch (err) {
      console.warn(`[FSService] Failed to start watcher on ${root}: ${describeWatcherError(err)}`);
    }
  }

  /**
   * Watcher options for a root. `ignorePermissionErrors` makes chokidar swallow
   * EPERM/EACCES on individual entries (locked files, ACL-restricted folders)
   * instead of failing the whole watch, which is what produced the noisy
   * `EPERM: operation not permitted, watch` errors before.
   */
  private buildWatchOptions(root: string): ChokidarOptions {
    const usePolling = this.pollingRoots.has(root);
    const depth = parseInt(process.env.HARNI_WATCH_DEPTH || '', 10);
    const maxEntries = parseInt(process.env.HARNI_WATCH_MAX_ENTRIES || '', 10);
    return {
      ignored: createWatcherIgnoreMatcher(root),
      ignoreInitial: true,
      persistent: true,
      ignorePermissionErrors: true,
      usePolling,
      depth: Number.isFinite(depth) && depth >= 0 ? depth : DEFAULT_WATCH_DEPTH,
      ...(Number.isFinite(maxEntries) && maxEntries > 0
        ? {
            // Stop watching after the budget is exhausted. A bounded watcher
            // keeps memory flat on huge workspaces (e.g. a user home folder)
            // where an unbounded recursive scan would balloon to gigabytes.
            maxEntries,
          }
        : {
            maxEntries: DEFAULT_WATCH_MAX_ENTRIES,
          }),
      ...(usePolling
        ? { interval: WATCHER_POLL_INTERVAL_MS, binaryInterval: WATCHER_POLL_INTERVAL_MS * 3 }
        : {
            awaitWriteFinish: {
              stabilityThreshold: 150,
              pollInterval: 50,
            },
          }),
    };
  }

  /**
   * Central watcher error handler.
   *
   * - Paths that disappeared mid-traversal (`ENOENT`/`ENOTDIR`/`EISDIR`) are
   *   ignored: chokidar cleans those up itself.
   * - Repeated errors are throttled so a failing root cannot flood the log.
   * - Permission/resource failures are retried, falling back to polling mode,
   *   and give up after `MAX_WATCHER_RESTART_ATTEMPTS` so the process never
   *   spins in a restart loop.
   */
  private handleWatcherError(root: string, watcher: FSWatcher, error: unknown): void {
    // chokidar can deliver errors from a watcher that was already replaced
    // (its fs.watch error callbacks are async). Ignore anything stale.
    if (this.watchers.get(root) !== watcher) return;

    const kind = classifyWatcherError(error);
    if (kind === 'ignorable') return;

    const now = Date.now();
    const reportedAt = this.watcherErrorReportedAt.get(root) ?? 0;
    if (now - reportedAt < WATCHER_ERROR_COOLDOWN_MS) return;
    this.watcherErrorReportedAt.set(root, now);

    const attempts = this.watcherRestartAttempts.get(root) ?? 0;
    if (attempts >= MAX_WATCHER_RESTART_ATTEMPTS) {
      console.warn(
        `[FSService] Watcher on ${root} stopped after ${attempts} restart attempts (${describeWatcherError(
          error,
        )}); file tree updates now rely on explicit refreshes.`,
      );
      void this.teardownWatcher(root);
      return;
    }

    this.watcherRestartAttempts.set(root, attempts + 1);
    if (kind === 'permission') {
      this.pollingRoots.add(root);
    }
    console.warn(
      `[FSService] Watcher error on ${root} (${describeWatcherError(error)}); restarting${
        kind === 'permission' ? ' with polling fallback' : ''
      }.`,
    );
    this.scheduleWatcherRestart(root);
  }

  /**
   * Close the current watcher (if any) and start a new one after a short delay.
   */
  private scheduleWatcherRestart(root: string): void {
    if (this.closed || this.watcherRestartTimers.has(root)) return;
    void this.teardownWatcher(root);

    const timer = setTimeout(() => {
      this.watcherRestartTimers.delete(root);
      if (!this.closed && !this.watchers.has(root)) {
        this.startWatching(root);
      }
    }, WATCHER_RESTART_DELAY_MS);
    timer.unref?.();

    this.watcherRestartTimers.set(root, timer);
  }

  private async teardownWatcher(root: string): Promise<void> {
    const watcher = this.watchers.get(root);
    if (!watcher) return;
    this.watchers.delete(root);
    try {
      await watcher.close();
    } catch {
      // ignore
    }
  }

  /**
   * Snapshot of the watcher state for a root (used by diagnostics and tests).
   */
  public getWatcherStatus(customRoot?: string): { watching: boolean; polling: boolean } {
    const root = path.resolve(customRoot || this.workspaceRoot);
    return {
      watching: this.watchers.has(root),
      polling: this.pollingRoots.has(root),
    };
  }

  /**
   * Stop Chokidar watcher for a workspace root
   */
  public async stopWatching(customRoot?: string): Promise<void> {
    const root = path.resolve(customRoot || this.workspaceRoot);

    const restartTimer = this.watcherRestartTimers.get(root);
    if (restartTimer) {
      clearTimeout(restartTimer);
      this.watcherRestartTimers.delete(root);
    }
    this.watcherRestartAttempts.delete(root);
    this.watcherErrorReportedAt.delete(root);
    this.pollingRoots.delete(root);

    await this.teardownWatcher(root);
  }

  private scheduleDebouncedDirNotification(root: string, relDir: string): void {
    const timerKey = `${root}::${relDir}`;
    const existing = this.debounceTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(timerKey);
      const children = await this.getDirectoryNodes(relDir, root);
      for (const listener of this.onDirChangeListeners) {
        listener(relDir, children, root);
      }
      if (relDir === '') {
        for (const listener of this.onTreeChangeListeners) {
          listener(children, root);
        }
      }
    }, 150);

    this.debounceTimers.set(timerKey, timer);
  }

  public onTreeChange(listener: (tree: FileNode[], workspaceRoot: string) => void): () => void {
    this.onTreeChangeListeners.push(listener);
    return () => {
      this.onTreeChangeListeners = this.onTreeChangeListeners.filter((l) => l !== listener);
    };
  }

  public onDirChange(
    listener: (relPath: string, children: FileNode[], workspaceRoot: string) => void,
  ): () => void {
    this.onDirChangeListeners.push(listener);
    return () => {
      this.onDirChangeListeners = this.onDirChangeListeners.filter((l) => l !== listener);
    };
  }

  public notifyDirChange(relPath: string, customRoot?: string): void {
    const root = path.resolve(customRoot || this.workspaceRoot);
    this.scheduleDebouncedDirNotification(root, relPath);
  }

  public notifyTreeChange(customRoot?: string): void {
    const root = path.resolve(customRoot || this.workspaceRoot);
    const timerKey = `${root}::__tree__`;
    const existingTimer = this.debounceTimers.get(timerKey);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(timerKey);
      const tree = await this.getFileTree(1, root);
      for (const listener of this.onTreeChangeListeners) {
        listener(tree, root);
      }
    }, 150);

    this.debounceTimers.set(timerKey, timer);
  }

  /**
   * Clean up all watchers and debounce timers
   */
  public async close(): Promise<void> {
    this.closed = true;

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const timer of this.watcherRestartTimers.values()) {
      clearTimeout(timer);
    }
    this.watcherRestartTimers.clear();
    this.watcherRestartAttempts.clear();
    this.watcherErrorReportedAt.clear();
    this.pollingRoots.clear();

    const closePromises: Promise<void>[] = [];
    for (const watcher of this.watchers.values()) {
      closePromises.push(watcher.close().catch(() => {}));
    }
    this.watchers.clear();
    this.dirCache.clear();
    await Promise.all(closePromises);
  }
}
