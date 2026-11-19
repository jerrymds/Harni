import * as path from 'node:path';
import { isPathWithinRoot, type AgentCoreEngine } from '@harni/agent-core';
import type { DBService } from '../services/dbService.js';
import type { ServerContext } from '../types/server.js';

export const DEFAULT_MAX_APPROVED_WORKSPACE_ROOTS = 200;

export class WorkspaceAuthorizationError extends Error {
  public readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceAuthorizationError';
  }
}

export interface WorkspaceAuthOptions {
  defaultWorkspaceRoot: string;
  dbService?: DBService;
  engine?: AgentCoreEngine;
  approvedWorkspaceRoots?: Iterable<string>;
  configuredAllowedRoots?: string[];
  extraRoots?: Iterable<string>;
}

/**
 * Checks whether a resolved path is a filesystem root (e.g. `/` or `C:\`).
 */
export function isFilesystemRoot(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  return path.dirname(resolved) === resolved;
}

/**
 * Parses a delimiter-separated list of allowed workspace roots from env config.
 */
export function parseAllowedWorkspaceRootsEnv(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

/**
 * Records a user-approved workspace root (e.g. from native OS directory picker),
 * bounded to prevent unbounded memory growth.
 */
export function recordApprovedWorkspaceRoot(
  approvedRoots: Set<string>,
  targetPath: string,
  maxEntries = DEFAULT_MAX_APPROVED_WORKSPACE_ROOTS,
): void {
  const resolved = path.resolve(targetPath);
  if (approvedRoots.has(resolved)) {
    approvedRoots.delete(resolved);
  }
  approvedRoots.add(resolved);
  while (approvedRoots.size > maxEntries) {
    const oldest = approvedRoots.values().next().value;
    if (oldest !== undefined) {
      approvedRoots.delete(oldest);
    } else {
      break;
    }
  }
}

/**
 * Collects all authorized workspace roots for the server instance.
 */
export function getAllowedWorkspaceRoots(opts: WorkspaceAuthOptions): string[] {
  const roots = new Set<string>([path.resolve(opts.defaultWorkspaceRoot)]);
  const hasConfiguredRoots = Boolean(
    opts.configuredAllowedRoots && opts.configuredAllowedRoots.length > 0,
  );

  if (hasConfiguredRoots) {
    for (const root of opts.configuredAllowedRoots!) {
      roots.add(path.resolve(root));
    }
  } else {
    if (opts.dbService) {
      for (const folder of opts.dbService.getFolders()) {
        if (folder?.path) {
          roots.add(path.resolve(folder.path));
        }
      }
    }
    if (opts.approvedWorkspaceRoots) {
      for (const root of opts.approvedWorkspaceRoots) {
        roots.add(path.resolve(root));
      }
    }
  }

  if (opts.engine) {
    for (const wtPath of opts.engine.getActiveWorktreePaths()) {
      roots.add(path.resolve(wtPath));
    }
  }

  if (opts.extraRoots) {
    for (const root of opts.extraRoots) {
      roots.add(path.resolve(root));
    }
  }

  return Array.from(roots);
}

/**
 * Validates a folder path before persisting it to the database.
 */
export function assertValidFolderPath(
  folderPath: string,
  opts: { defaultWorkspaceRoot: string; configuredAllowedRoots?: string[] },
): string {
  const resolved = path.resolve(folderPath);
  const defaultResolved = path.resolve(opts.defaultWorkspaceRoot);

  if (isFilesystemRoot(resolved) && resolved !== defaultResolved) {
    throw new WorkspaceAuthorizationError(
      `Cannot register filesystem root as workspace folder: '${folderPath}'`,
    );
  }

  if (opts.configuredAllowedRoots && opts.configuredAllowedRoots.length > 0) {
    const allowed = [defaultResolved, ...opts.configuredAllowedRoots.map((r) => path.resolve(r))];
    if (!allowed.some((root) => isPathWithinRoot(resolved, root))) {
      throw new WorkspaceAuthorizationError(
        `Path traversal denied: folder '${folderPath}' is outside configured allowed workspace roots`,
      );
    }
  }

  return resolved;
}

/**
 * Resolves `requestedRoot` if provided and ensures it resides within an authorized
 * workspace root; otherwise falls back to `defaultWorkspaceRoot`.
 */
export function resolveAuthorizedWorkspaceRoot(
  requestedRoot: string | undefined,
  opts: WorkspaceAuthOptions,
): string {
  const defaultResolved = path.resolve(opts.defaultWorkspaceRoot);
  if (!requestedRoot) {
    return defaultResolved;
  }

  const resolved = path.resolve(requestedRoot);
  if (isFilesystemRoot(resolved) && resolved !== defaultResolved) {
    throw new WorkspaceAuthorizationError(
      `Path traversal denied: workspaceRoot '${requestedRoot}' cannot be a filesystem root`,
    );
  }

  const allowedRoots = getAllowedWorkspaceRoots(opts);
  if (!allowedRoots.some((allowed) => isPathWithinRoot(resolved, allowed))) {
    throw new WorkspaceAuthorizationError(
      `Path traversal denied: workspaceRoot '${requestedRoot}' is outside allowed workspace roots`,
    );
  }

  return resolved;
}

/**
 * Convenience helper for HTTP route handlers to validate a `workspaceRoot`
 * query/body parameter against `ServerContext`.
 */
export function resolveContextWorkspaceRoot(
  ctx: Pick<
    ServerContext,
    'workspaceRoot' | 'dbService' | 'engine' | 'approvedWorkspaceRoots' | 'configuredAllowedRoots'
  >,
  requestedRoot?: string,
): string {
  return resolveAuthorizedWorkspaceRoot(requestedRoot, {
    defaultWorkspaceRoot: ctx.workspaceRoot,
    dbService: ctx.dbService,
    engine: ctx.engine,
    approvedWorkspaceRoots: ctx.approvedWorkspaceRoots,
    configuredAllowedRoots: ctx.configuredAllowedRoots,
  });
}
