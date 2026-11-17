import {
  PluginPriority,
  type WorkflowPlugin,
  type WorkflowPluginCategory,
  type WorkflowPluginContext,
} from '@harni/types';
import type { GitCheckpointService } from '../git/gitCheckpointService.js';

export interface GitWorkspacePluginOptions {
  gitCheckpointService: GitCheckpointService;
  getDefaultWorktreeEnabled: () => boolean;
  getDefaultCheckpointEnabled: () => boolean;
  getWorktreeTimeoutMs: () => number;
}

interface GitWorkspacePluginState {
  checkpointId?: string;
  isWorktree?: boolean;
  worktreeBranch?: string;
}

export class GitWorkspacePlugin implements WorkflowPlugin {
  public readonly id = 'harni.git-workspace';
  public readonly name = 'Git Workspace & Checkpoint Plugin';
  public readonly description =
    'Manages Git worktree isolation, task checkpoints, and snapshot recovery.';
  public readonly priority = PluginPriority.ENVIRONMENT;
  public readonly category: WorkflowPluginCategory = 'environment';
  public readonly isBuiltin = true;
  public enabled = true;
  public applyToSubagents = false;

  constructor(private options: GitWorkspacePluginOptions) {}

  public async onTaskStart(
    ctx: WorkflowPluginContext,
    options: Record<string, unknown>,
  ): Promise<void> {
    const mainWorkspaceRoot = ctx.getMainWorkspaceRoot();
    const state = ctx.getPluginState<GitWorkspacePluginState>(this.id, () => ({}));

    // 1. Worktree Isolation Setup
    const shouldEnableWorktree =
      options.enableWorktree !== undefined
        ? Boolean(options.enableWorktree)
        : this.options.getDefaultWorktreeEnabled();

    if (shouldEnableWorktree) {
      try {
        const isGit = await this.options.gitCheckpointService.isGitRepo(mainWorkspaceRoot);
        if (isGit) {
          const timeoutMs =
            typeof options.worktreeTimeoutMs === 'number'
              ? options.worktreeTimeoutMs
              : this.options.getWorktreeTimeoutMs();

          const wt = await this.options.gitCheckpointService.createWorktree(
            mainWorkspaceRoot,
            ctx.sessionId,
            undefined,
            { timeoutMs },
          );

          state.isWorktree = true;
          state.worktreeBranch = wt.branch;

          ctx.setWorkspaceRoot(wt.worktreePath, {
            isWorktree: true,
            branch: wt.branch,
          });

          ctx.emitEvent('worktree:status', {
            sessionId: ctx.sessionId,
            isWorktree: true,
            worktreePath: wt.worktreePath,
            branch: wt.branch,
          });
        }
      } catch (wtErr) {
        console.warn(
          '[GitWorkspacePlugin] Failed to create worktree, falling back to main workspace:',
          wtErr,
        );
      }
    }

    // 2. Git Checkpoint Setup
    const shouldEnableCheckpoint =
      options.enableCheckpoint !== undefined
        ? Boolean(options.enableCheckpoint)
        : this.options.getDefaultCheckpointEnabled();

    if (shouldEnableCheckpoint) {
      try {
        const promptText =
          typeof options.prompt === 'string'
            ? options.prompt
            : ctx.taskState?.prompt || '';
        const ckpt = await this.options.gitCheckpointService.createCheckpoint(
          mainWorkspaceRoot,
          {
            sessionId: ctx.sessionId,
            taskId: ctx.taskId,
            description: promptText.slice(0, 60),
            isWorktree: Boolean(state.isWorktree),
            worktreeBranch: state.worktreeBranch,
            worktreePath: state.isWorktree ? ctx.getWorkspaceRoot() : undefined,
          },
        );

        state.checkpointId = ckpt.id;
        if (ctx.taskState) {
          ctx.taskState.checkpointId = ckpt.id;
          ctx.syncTaskState();
        }

        ctx.emitEvent('checkpoint:created', {
          checkpoint: ckpt,
          sessionId: ctx.sessionId,
        });
      } catch (ckptErr) {
        console.warn('[GitWorkspacePlugin] Failed to create checkpoint:', ckptErr);
      }
    }
  }

  public async onTaskCompleted(ctx: WorkflowPluginContext): Promise<void> {
    const state = ctx.getPluginState<GitWorkspacePluginState>(this.id, () => ({}));

    if (state.isWorktree) {
      ctx.emitEvent('worktree:status', {
        sessionId: ctx.sessionId,
        isWorktree: true,
        worktreePath: ctx.getWorkspaceRoot(),
        branch: state.worktreeBranch,
      });
    }

    if (this.options.getDefaultCheckpointEnabled()) {
      const targetRoot = ctx.getMainWorkspaceRoot() || ctx.getWorkspaceRoot();
      this.options.gitCheckpointService
        .pruneCheckpoints(targetRoot)
        .catch(() => {});
    }
  }
}
