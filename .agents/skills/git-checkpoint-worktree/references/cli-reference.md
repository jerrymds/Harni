# `git-sandbox.mjs` CLI Reference

Standalone ESM Node.js CLI (`node:fs/promises`, `node:path`, `node:child_process`, `node:crypto`, `node:util`) with zero external dependencies.

## Global Options

Global flags may appear anywhere in the argument list:

| Flag | Default | Description |
| --- | --- | --- |
| `--workspace <dir>` | `process.cwd()` | Target Git repository (or worktree) path |
| `--json` | `false` | Emit single-line JSON to `stdout` |
| `-h`, `--help` | `false` | Print usage help and exit `0` |

On error (or `success: false`), the CLI exits with code `1`. When `--json` is passed, errors are printed to `stdout` as:

```json
{ "success": false, "error": "Error message" }
```

---

## Commands

### `status`

Inspect Git repository status, active branch, dirty counts, checkpoint count, and active worktrees.

**Example Response (`--json`)**:
```json
{
  "isGitRepo": true,
  "workspaceRoot": "/path/to/repo",
  "currentBranch": "main",
  "headCommit": "a1b2c3d4...",
  "isDirty": true,
  "modifiedFilesCount": 1,
  "untrackedFilesCount": 1,
  "checkpointsCount": 2,
  "activeWorktrees": []
}
```

---

### `checkpoint create`

Create a shadow snapshot before risky edits.

- `--session <id>`: Session identifier (default: `"default"`).
- `--desc "<text>"`: Human-readable description.
- `--max <n>`: Maximum checkpoints to retain after creation (default: `10`).

**Behavior**:
1. Ensures `.git/info/exclude` ignores `.harni-worktrees`, `.harni-worktrees/**`, and `.harni/snapshots`.
2. Records `HEAD` commit hash, `dirtyFilesBefore`, `untrackedFilesBefore`, `workspaceRoot`, `gitCommonDir`, and `repositoryId`.
3. Only `HEAD` and dirty tracked state are snapshotted: if `dirtyFilesBefore` is non-empty, creates a dangling stash commit via `git stash create harni-checkpoint-<id>` (without modifying the working tree) and aborts with an error if stash creation fails. `untrackedFilesBefore` only records pre-existing untracked file paths so rollback excludes them from deletion—their contents are **not** snapshotted or restored.
4. Stores `refs/harni/checkpoints/<id>` (checked for exit code `0`) and persists the record under exclusive lock in `<gitCommonDir>/harni-sandbox-state.json`, then prunes excess checkpoints.

**Example Response (`--json`)**:
```json
{
  "success": true,
  "checkpoint": {
    "schemaVersion": 1,
    "id": "ckpt_sess1_1700000000000",
    "sessionId": "sess1",
    "createdAt": 1700000000000,
    "description": "before refactor",
    "commitHash": "a1b2c3d4...",
    "isWorktree": false,
    "stashRef": "e5f6a7b8...",
    "workspaceRoot": "/path/to/repo",
    "gitCommonDir": "/path/to/repo/.git",
    "repositoryId": "0123456789abcdef",
    "dirtyFilesBefore": ["app.ts"],
    "untrackedFilesBefore": ["notes.txt"],
    "filesCount": 2
  }
}
```

---

### `checkpoint list`

List stored checkpoints sorted by `createdAt` descending.

- `--session <id>`: Filter checkpoints by session ID.

**Example Response (`--json`)**:
```json
{
  "checkpoints": [ ... ]
}
```

---

### `checkpoint rollback`

Restore the workspace to a saved checkpoint.

- `--id <ckptId>`: Specific checkpoint ID.
- `--session <id>`: Use the newest checkpoint for the given session matching the current workspace/repository (if `--id` is omitted).
- `--dry-run`: Preview what would be reset, restored, deleted, or preserved without modifying any files, Git refs, or state.

**Behavior**:
1. **Workspace & Repository Ownership Validation**: Matches candidates strictly against the current `workspaceRoot`, `gitCommonDir`, and `repositoryId` (never falling back to another workspace). Even when `--id` is provided, rejects checkpoints belonging to a different workspace or repository.
2. **Dry Run (`--dry-run`)**: Returns a preview JSON payload without modifying disk or Git state.
3. If the checkpoint belongs to a worktree (`isWorktree && worktreePath`), safely discards the worktree and removes it from state under exclusive lock.
4. Otherwise:
   - Unstages any `untrackedFilesBefore` paths via `git rm -r --cached --ignore-unmatch` so pre-existing untracked files that were later `git add`-ed are not deleted from disk by reset.
   - Runs `git reset --hard <commitHash>`.
   - Deletes untracked files created *after* the checkpoint (validated to reside within `workspaceRoot`) while preserving any files listed in `untrackedFilesBefore`.
   - Restores pre-checkpoint dirty tracked files (including staged, unstaged, and deleted tracked files) from `stashRef` via `git checkout --no-overlay <stashRef> -- .` (with a `git ls-tree` / `git ls-files` deletion fallback if `--no-overlay` is unsupported) followed by `git read-tree <stashRef>^2` to accurately restore the staged index state.

**Example Response (`--json`)**:
```json
{
  "success": true,
  "checkpointId": "ckpt_sess1_1700000000000",
  "message": "Workspace restored to checkpoint ckpt_sess1_1700000000000"
}
```

**Example Dry-Run Response (`--dry-run --json`)**:
```json
{
  "success": true,
  "dryRun": true,
  "checkpointId": "ckpt_sess1_1700000000000",
  "wouldResetTo": "a1b2c3d4...",
  "trackedFilesToRestore": ["app.ts"],
  "untrackedFilesToDelete": ["bad-temp.ts"],
  "untrackedFilesToRestore": [],
  "untrackedFilesPreserved": ["notes.txt"]
}
```

---

### `checkpoint prune`

Prune older checkpoints and delete their `refs/harni/checkpoints/*` Git refs.

- `--max <n>`: Number of newest checkpoints to retain (default: `5`).

**Example Response (`--json`)**:
```json
{
  "success": true,
  "deletedCount": 3
}
```

---

### `worktree create`

Create an isolated Git worktree with linked dependencies.

- `--session <id>` (**required**): Pure `[a-zA-Z0-9_-]{1,48}` IDs are preserved verbatim; IDs containing special characters or exceeding 48 chars are normalized with a collision-resistant 8-hex SHA-256 suffix (`<slug>-<hash>`), preventing collisions across e.g. `feature/a`, `feature:a`, `feature a`, and `feature_a`.
- `--base <ref>`: Base commit/branch (default: `HEAD`).
- `--timeout <ms>`: Git command timeout in milliseconds (default: `180000`).
- `--replace`: Allow overwriting an existing worktree/branch for the same session. Without `--replace`, `worktree create` fails if an active state record, worktree directory, or `refs/heads/harni/task-<safeSessionId>` branch already exists.

**Behavior**:
1. Checks whether `activeWorktrees[safeSessionId]`, the worktree directory, or `refs/heads/harni/task-<safeSessionId>` already exists; aborts unless `--replace` is set.
2. If `--replace` is set, cleans up the existing worktree and branch first.
3. Creates branch `harni/task-<safeSessionId>` at `<workspaceRoot>/.harni-worktrees/<safeSessionId>`.
4. Links `node_modules`, `.venv`, and `venv` using NTFS junctions (`'junction'` on Windows, `'dir'` symlink elsewhere) and copies `.env` **only** if `.env` passes `git check-ignore -q .env`.
5. Under exclusive state lock, verifies no concurrent race occurred and saves an `ActiveWorktreeRecord` (`schemaVersion: 1`) in `harni-sandbox-state.json`.

**Example Response (`--json`)**:
```json
{
  "success": true,
  "sessionId": "wt1",
  "worktreePath": "/path/to/repo/.harni-worktrees/wt1",
  "branch": "harni/task-wt1"
}
```

---

### `worktree list`

List active worktrees in `harni-sandbox-state.json`.

**Example Response (`--json`)**:
```json
{
  "worktrees": [
    {
      "schemaVersion": 1,
      "sessionId": "wt1",
      "safeSessionId": "wt1",
      "workspaceRoot": "/path/to/repo",
      "worktreePath": "/path/to/repo/.harni-worktrees/wt1",
      "branch": "harni/task-wt1",
      "createdAt": 1700000000000
    }
  ]
}
```

---

### `worktree merge`

Commit any uncommitted changes inside the worktree, merge into the main workspace branch, and clean up.

- `--session <id>` (**required**): Worktree session ID.
- `--message "<msg>"`: Custom commit message if worktree has uncommitted changes.

**Safety Guards**:
1. **Clean Main Workspace Required**: Before staging or merging, verifies the main workspace has no uncommitted changes. If dirty, aborts with exit `1`:
   ```json
   {
     "success": false,
     "error": "Main workspace must be clean before merge",
     "message": "Main workspace must be clean before merge",
     "modified": ["app.ts"],
     "untracked": ["notes.txt"]
   }
   ```
2. **Sensitive File Blocking**: Before staging worktree changes (batched via `git add -A -- <paths>`), rejects sensitive filenames (`.env`, `.env.*` other than `.env.example`/`.env.sample`/`.env.template`, `*.pem`, `*.key`, `credentials.json`, `secrets.*`):
   ```json
   {
     "success": false,
     "error": "Sensitive untracked files would be committed",
     "message": "Sensitive untracked files would be committed: .env, server.key",
     "files": [".env", "server.key"]
   }
   ```
3. **Conflict Auto-Abort**: If `git merge` fails (e.g., due to conflicts), automatically runs `git merge --abort` (with `git reset --merge` fallback) to restore the main workspace to a clean state, returns `{ "success": false, "error": "Merge failed", "message": "..." }`, and exits `1` **without** destroying the worktree.

**Example Response (`--json`)**:
```json
{
  "success": true,
  "sessionId": "wt1",
  "branch": "harni/task-wt1",
  "message": "Merged worktree branch (harni/task-wt1) into main workspace and cleaned up."
}
```

---

### `worktree discard`

Safely unlink dependency junctions, remove the worktree, delete `harni/task-<safeSessionId>`, and remove from state without modifying the main workspace.

- `--session <id>` (**required**): Worktree session ID.

**Example Response (`--json`)**:
```json
{
  "success": true,
  "sessionId": "wt1",
  "branch": "harni/task-wt1",
  "message": "Discarded worktree branch (harni/task-wt1); main workspace untouched."
}
```

---

### `worktree prune`

Remove orphaned `harni/task-*` branches not listed in `activeWorktrees` and clean up orphaned directories inside `.harni-worktrees` (unlinking any dependency junctions first).

**Example Response (`--json`)**:
```json
{
  "success": true,
  "prunedBranches": ["harni/task-orphan"],
  "removedDirs": ["orphan"]
}
```

---

## Internal Storage & Safety

- **Shared State File & Schema (`version: 1`)**: `<gitCommonDir>/harni-sandbox-state.json` (resolved via `git rev-parse --git-common-dir`, shared across main repository and all worktrees), carrying `{ "version": 1, "checkpoints": {...}, "activeWorktrees": {...} }`. Corrupted or unreadable existing state files cause an immediate error instead of being silently overwritten.
- **Exclusive State Lock & Atomic Writes**: State mutations acquire `<gitCommonDir>/harni-sandbox-state.json.lock` via exclusive file creation (`wx`) with PID/mtime stale-lock recovery (`30s` default) and jittered backoff (`15s` timeout). Writes go to a unique temporary file and atomically replace the state file via `fs.rename()` (with Windows `EPERM`/`EACCES`/`EBUSY` retry).
- **Shadow Refs**: `refs/harni/checkpoints/<id>` (never pollutes standard branch history).
- **Local Git Exclusions**: `<gitCommonDir>/info/exclude` includes `.harni-worktrees`, `.harni-worktrees/**`, and `.harni/snapshots` so `.gitignore` in the repository stays untouched.
- **NTFS Junction Safety**: Before removing any worktree directory, `lstat(target).isSymbolicLink()` is checked and dependency links (`node_modules`, `.venv`, `venv`) are removed via `fs.unlink()` (with `fs.rmdir()` fallback), never via recursive `fs.rm()`, and worktree/branch deletion exit codes and disk removal are strictly verified.
