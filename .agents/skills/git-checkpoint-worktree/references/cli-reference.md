# `git-sandbox.mjs` CLI Reference

Standalone ESM Node.js CLI (`node:fs/promises`, `node:path`, `node:child_process`, `node:util`) with zero external dependencies.

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
2. Records `HEAD` commit hash, `dirtyFilesBefore`, and `untrackedFilesBefore`.
3. If working tree is dirty, creates a dangling stash commit via `git stash create harni-checkpoint-<id>` (without modifying the working tree) and stores `refs/harni/checkpoints/<id>`. If clean, points the ref to `HEAD`.
4. Persists the record in `<gitCommonDir>/harni-sandbox-state.json` and prunes excess checkpoints.

**Example Response (`--json`)**:
```json
{
  "success": true,
  "checkpoint": {
    "id": "ckpt_sess1_1700000000000",
    "sessionId": "sess1",
    "createdAt": 1700000000000,
    "description": "before refactor",
    "commitHash": "a1b2c3d4...",
    "isWorktree": false,
    "stashRef": "e5f6a7b8...",
    "workspaceRoot": "/path/to/repo",
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
- `--session <id>`: Use the newest checkpoint for the given session (if `--id` is omitted).

**Behavior**:
1. If the checkpoint belongs to a worktree (`isWorktree && worktreePath`), safely discards the worktree and removes it from state.
2. Otherwise:
   - Runs `git reset --hard <commitHash>`.
   - Deletes untracked files created *after* the checkpoint while preserving any files listed in `untrackedFilesBefore`.
   - Restores pre-checkpoint dirty tracked files from `stashRef` via `git checkout <stashRef> -- .` (falling back to `git stash apply <stashRef>`).

**Example Response (`--json`)**:
```json
{
  "success": true,
  "checkpointId": "ckpt_sess1_1700000000000",
  "message": "Workspace restored to checkpoint ckpt_sess1_1700000000000"
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

- `--session <id>` (**required**): Sanitized with `replace(/[^a-zA-Z0-9_-]/g, '_')`.
- `--base <ref>`: Base commit/branch (default: `HEAD`).
- `--timeout <ms>`: Git command timeout in milliseconds (default: `180000`).

**Behavior**:
1. Cleans up any stale worktree/branch for `harni/task-<safeSessionId>`.
2. Creates branch `harni/task-<safeSessionId>` at `<workspaceRoot>/.harni-worktrees/<safeSessionId>`.
3. Links `node_modules`, `.venv`, and `venv` using NTFS junctions (`'junction'` on Windows, `'dir'` symlink elsewhere) and copies `.env` if present.
4. Saves an `ActiveWorktreeRecord` in `harni-sandbox-state.json`.

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

If `git merge` fails (e.g., due to conflicts), returns `{ "success": false, "message": "..." }` and exits `1` **without** destroying the worktree.

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

- **Shared State File**: `<gitCommonDir>/harni-sandbox-state.json` (resolved via `git rev-parse --git-common-dir`, shared across main repository and all worktrees).
- **Shadow Refs**: `refs/harni/checkpoints/<id>` (never pollutes standard branch history).
- **Local Git Exclusions**: `<gitCommonDir>/info/exclude` includes `.harni-worktrees`, `.harni-worktrees/**`, and `.harni/snapshots` so `.gitignore` in the repository stays untouched.
- **NTFS Junction Safety**: Before removing any worktree directory, `lstat(target).isSymbolicLink()` is checked and dependency links (`node_modules`, `.venv`, `venv`) are removed via `fs.unlink()` (with `fs.rmdir()` fallback), never via recursive `fs.rm()`.
