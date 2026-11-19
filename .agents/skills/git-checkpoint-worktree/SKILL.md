---
name: git-checkpoint-worktree
description: Use this skill before risky multi-file edits, complex refactors, or parallel subagent tasks to create shadow Git checkpoints (preserving uncommitted dirty state) or zero-overhead isolated Git worktrees with linked node_modules/.venv, and to rollback, merge, or discard changes safely.
category: git
tools: run_command, read_file
---

# Git Checkpoint & Worktree Isolation

Standalone, zero-dependency Git safety CLI (`git-sandbox.mjs`) that works identically across Harni, Antigravity, Claude Code, and subagents via shared `.git/harni-sandbox-state.json` persistence.

## When to Use Which Mode

- **Shadow Checkpoint (`checkpoint`)**: Use before risky multi-file edits or refactors in the current working tree. Preserves `HEAD` and dirty tracked edits (via `refs/harni/checkpoints/*`). Pre-existing untracked file paths are recorded and excluded from rollback cleanup, but their contents are not snapshotted or restored.
- **Isolated Worktree (`worktree`)**: Use for parallel subagent tasks, experimental features, or isolated test runs. Creates `.harni-worktrees/<session>` on branch `harni/task-<session>`, symlinks/junctions `node_modules`, `.venv`, `venv`, and copies `.env` only if `.env` is already Git-ignored (via `git check-ignore`) so tests run immediately without reinstalling dependencies or leaking unignored secrets.

## Locating the Script

- Project-local installation: `.agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs`
- Skill-relative script: [git-sandbox.mjs](./scripts/git-sandbox.mjs)

Always pass `--json` for machine-readable output and `--workspace <dir>` when running outside the target repository root.

## Quick Command Cheatsheet

```bash
# Inspect repository status, checkpoints, and active worktrees
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs status --workspace . --json

# Create a shadow checkpoint before risky edits
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs checkpoint create --session task1 --desc "before refactor" --json

# Preview what a rollback would restore/delete without modifying files
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs checkpoint rollback --session task1 --dry-run --json

# Rollback workspace to a checkpoint (or latest for session)
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs checkpoint rollback --session task1 --json

# Prune old checkpoints (default keeps newest 5)
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs checkpoint prune --max 5 --json

# Create an isolated worktree with linked dependencies (fails if session already exists; pass --replace to overwrite)
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs worktree create --session wt1 --json
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs worktree create --session wt1 --replace --json

# Commit worktree changes, merge into main branch, and safely clean up
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs worktree merge --session wt1 --message "feat: implement task" --json

# Discard an isolated worktree without touching main workspace
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs worktree discard --session wt1 --json

# Clean up orphaned harni/task-* branches and stale worktree directories
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs worktree prune --json
```

## Detailed Reference

For full flags, JSON schemas, and internal storage layout, read [cli-reference.md](./references/cli-reference.md).

## Safety Guardrails

1. **Always prefer `--json`** so callers can reliably parse IDs, paths, and `success` flags.
2. **Preview destructive rollbacks with `--dry-run`**: Run `checkpoint rollback --dry-run` before rolling back to inspect which tracked files will be restored and which post-checkpoint untracked files will be deleted.
3. **Avoid accidental worktree overwrites**: `worktree create` refuses to overwrite an existing worktree or branch unless `--replace` is explicitly passed.
4. **Never manually `rm -rf` a worktree directory** that contains a `node_modules`, `.venv`, or `venv` junction/symlink—recursive deletion on improperly handled links can threaten the main repository's dependencies. Always use `worktree discard`, `worktree merge`, or `worktree prune`, which unlink junctions safely first.
5. **Verify merge results**: `worktree merge` requires a clean main workspace and blocks committing sensitive files (`.env`, `.env.*` except examples/templates, `*.pem`, `*.key`, `credentials.json`, `secrets.*`). If `worktree merge` reports `success: false` (e.g., merge conflict), it automatically runs `git merge --abort` to keep the main workspace clean while preserving the worktree for inspection.
