import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_SYMLINK_DEPTH = 40;

/**
 * Checks whether a relative path (from `path.relative`) escapes its base directory.
 */
export function isRelativeOutside(rel: string): boolean {
  if (rel === '') return false;
  return (
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    rel.startsWith('../') ||
    path.isAbsolute(rel)
  );
}

/**
 * Validates that `candidatePath` (or its nearest existing ancestor, including
 * resolving dangling symlink targets) stays inside `realRoot`.
 */
function assertWithinRealRoot(
  candidatePath: string,
  realRoot: string,
  rawInput: string,
  workspaceRoot: string,
  visited = new Set<string>(),
  depth = 0,
): void {
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new Error(
      `Path traversal denied (symlink loop): '${rawInput}' exceeds symlink resolution limit`,
    );
  }

  let cursor = candidatePath;
  while (true) {
    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(cursor);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const parent = path.dirname(cursor);
        if (parent === cursor) {
          if (isRelativeOutside(path.relative(realRoot, candidatePath))) {
            throw new Error(
              `Path traversal denied: '${rawInput}' resolves outside workspace root '${workspaceRoot}'`,
            );
          }
          return;
        }
        cursor = parent;
        continue;
      }
      if (code === 'ELOOP') {
        throw new Error(
          `Path traversal denied (symlink loop): '${rawInput}' resolves through a symlink loop`,
        );
      }
      throw err;
    }

    if (lstat.isSymbolicLink()) {
      if (visited.has(cursor)) {
        throw new Error(
          `Path traversal denied (symlink loop): '${rawInput}' resolves through a symlink loop`,
        );
      }
      visited.add(cursor);

      try {
        const realTarget = fs.realpathSync(cursor);
        if (isRelativeOutside(path.relative(realRoot, realTarget))) {
          throw new Error(
            `Path traversal denied (symlink): '${rawInput}' resolves outside workspace root '${workspaceRoot}'`,
          );
        }
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') {
          throw new Error(
            `Path traversal denied (symlink loop): '${rawInput}' resolves through a symlink loop`,
          );
        }
        if (code !== 'ENOENT') {
          throw err;
        }

        // Dangling symlink: inspect the raw link target so nonexistent targets outside root are blocked
        const rawLinkTarget = fs.readlinkSync(cursor);
        const parentDir = path.dirname(cursor);
        const realParent = fs.existsSync(parentDir) ? fs.realpathSync(parentDir) : parentDir;
        const resolvedLinkTarget = path.resolve(realParent, rawLinkTarget);

        if (isRelativeOutside(path.relative(realRoot, resolvedLinkTarget))) {
          throw new Error(
            `Path traversal denied (dangling symlink): '${rawInput}' resolves outside workspace root '${workspaceRoot}'`,
          );
        }

        assertWithinRealRoot(
          resolvedLinkTarget,
          realRoot,
          rawInput,
          workspaceRoot,
          visited,
          depth + 1,
        );
        return;
      }
    }

    const realTarget = fs.realpathSync(cursor);
    if (isRelativeOutside(path.relative(realRoot, realTarget))) {
      throw new Error(
        `Path traversal denied (symlink): '${rawInput}' resolves outside workspace root '${workspaceRoot}'`,
      );
    }
    return;
  }
}

/**
 * Safely resolves a path and prevents path traversal (including via existing or
 * dangling symlinks) outside the workspaceRoot.
 */
export function resolveSafePath(filePath: string, workspaceRoot: string): string {
  const normalizedRoot = path.resolve(workspaceRoot);
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(normalizedRoot, filePath);

  // Lexical security check: ensure resolved path is inside normalizedRoot
  const relative = path.relative(normalizedRoot, resolved);
  if (isRelativeOutside(relative)) {
    throw new Error(
      `Path traversal denied: '${filePath}' is outside workspace root '${workspaceRoot}'`,
    );
  }

  // Symlink & dangling-symlink security check when workspaceRoot exists on disk
  if (fs.existsSync(normalizedRoot)) {
    const realRoot = fs.realpathSync(normalizedRoot);
    assertWithinRealRoot(resolved, realRoot, filePath, workspaceRoot);
  }

  return resolved;
}

/**
 * Returns true if `candidatePath` safely resolves within `rootPath`.
 */
export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  try {
    resolveSafePath(candidatePath, rootPath);
    return true;
  } catch {
    return false;
  }
}
