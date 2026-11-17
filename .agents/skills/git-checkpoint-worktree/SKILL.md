---
name: git-checkpoint-worktree
description: Use this skill before risky multi-file edits, complex refactors, or parallel subagent tasks to create shadow Git checkpoints (preserving uncommitted dirty state) or zero-overhead isolated Git worktrees with linked node_modules/.venv, and to rollback, merge, or discard changes safely.
category: git
tools: run_command, read_file
---

# Git Checkpoint & Worktree Isolation

Standalone, zero-dependency Git safety CLI (`git-sandbox.mjs`) that works identically across Harni, Antigravity, Claude Code, and subagents via shared `.git/harni-sandbox-state.json` persistence.

## When to Use Which Mode

- **Shadow Checkpoint (`checkpoint`)**: Use before risky multi-file edits or refactors in the current working tree. Preserves both `HEAD` and any pre-existing uncommitted dirty tracked edits (via `refs/harni/checkpoints/*`) plus pre-existing untracked files, allowing one-command rollback.
- **Isolated Worktree (`worktree`)**: Use for parallel subagent tasks, experimental features, or isolated test runs. Creates `.harni-worktrees/<session>` on branch `harni/task-<session>`, symlinks/junctions `node_modules`, `.venv`, `venv`, and copies `.env` so tests run immediately without reinstalling dependencies.

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

# Rollback workspace to a checkpoint (or latest for session)
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs checkpoint rollback --session task1 --json

# Prune old checkpoints (default keeps newest 5)
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs checkpoint prune --max 5 --json

# Create an isolated worktree with linked dependencies
node .agents/skills/git-checkpoint-worktree/scripts/git-sandbox.mjs worktree create --session wt1 --json

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
2. **Never manually `rm -rf` a worktree directory** that contains a `node_modules`, `.venv`, or `venv` junction/symlink—recursive deletion on improperly handled links can threaten the main repository's dependencies. Always use `worktree discard`, `worktree merge`, or `worktree prune`, which unlink junctions safely first.
3. **Verify merge results**: If `worktree merge` reports `success: false` (e.g., merge conflict), the worktree is preserved so you can inspect or resolve conflicts before retrying or discarding.
