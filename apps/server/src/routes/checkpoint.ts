import type { Router } from './router.js';
import { readJsonBody, sendJsonError, sendJsonResponse } from '../utils/http.js';
import { resolveContextWorkspaceRoot } from '../utils/workspaceSecurity.js';

export function registerCheckpointRoutes(router: Router): void {
  // GET /api/checkpoints - List all checkpoints for current workspace
  router.get('/api/checkpoints', ({ res, url, ctx }) => {
    try {
      const requestedRoot = url.searchParams.get('workspaceRoot') || undefined;
      const workspaceRoot = resolveContextWorkspaceRoot(ctx, requestedRoot);
      const checkpoints = ctx.engine.getCheckpoints(workspaceRoot);
      sendJsonResponse(res, 200, { checkpoints });
    } catch (err: unknown) {
      sendJsonError(res, err, 500, { checkpoints: [] });
    }
  });

  // POST /api/checkpoints/rollback - One-click rollback to checkpoint
  router.post('/api/checkpoints/rollback', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{ sessionId?: string; checkpointId?: string }>(
        req,
        ctx.readBodyOpts,
      );
      const result = await ctx.engine.rollbackCheckpoint(body?.sessionId, body?.checkpointId);
      sendJsonResponse(res, result.success ? 200 : 400, result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { success: false, message: errorMsg });
    }
  });

  // POST /api/checkpoints/prune - Prune old checkpoints and stale worktree branches
  router.post('/api/checkpoints/prune', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{ workspaceRoot?: string; maxRetained?: number }>(
        req,
        ctx.readBodyOpts,
      );
      const authorizedRoot = resolveContextWorkspaceRoot(ctx, body?.workspaceRoot);
      const result = await ctx.engine.pruneCheckpointsAndBranches(
        authorizedRoot,
        body?.maxRetained,
      );
      sendJsonResponse(res, 200, { success: true, ...result });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonError(res, err, 500, { success: false, message: errorMsg });
    }
  });

  // POST /api/worktrees/merge - Merge isolated worktree changes
  router.post('/api/worktrees/merge', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{ sessionId: string; commitMessage?: string }>(
        req,
        ctx.readBodyOpts,
      );
      if (!body?.sessionId) {
        sendJsonResponse(res, 400, { success: false, message: 'Missing sessionId' });
        return;
      }
      const result = await ctx.engine.mergeWorktree(body.sessionId, body.commitMessage);
      sendJsonResponse(res, result.success ? 200 : 400, result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { success: false, message: errorMsg });
    }
  });

  // POST /api/worktrees/discard - Discard isolated worktree
  router.post('/api/worktrees/discard', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{ sessionId: string }>(req, ctx.readBodyOpts);
      if (!body?.sessionId) {
        sendJsonResponse(res, 400, { success: false, message: 'Missing sessionId' });
        return;
      }
      const result = await ctx.engine.discardWorktree(body.sessionId);
      sendJsonResponse(res, result.success ? 200 : 400, result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { success: false, message: errorMsg });
    }
  });

  // GET /api/worktrees/:sessionId - Get active worktree info
  router.get('/api/worktrees/:sessionId', ({ res, params, ctx }) => {
    try {
      const info = ctx.engine.getActiveWorktree(params.sessionId);
      sendJsonResponse(res, 200, { worktree: info });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg });
    }
  });

  // GET /api/git/branches - List local Git branches
  router.get('/api/git/branches', async ({ res, url, ctx }) => {
    try {
      const requestedRoot = url.searchParams.get('workspaceRoot') || undefined;
      const workspaceRoot = resolveContextWorkspaceRoot(ctx, requestedRoot);
      const result = await ctx.engine.listBranches(workspaceRoot);
      sendJsonResponse(res, 200, result);
    } catch (err: unknown) {
      sendJsonError(res, err, 500, {
        isGitRepo: false,
        currentBranch: '',
        branches: [],
      });
    }
  });

  // POST /api/git/branches/switch - Switch or create Git branch
  router.post('/api/git/branches/switch', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{
        workspaceRoot?: string;
        branch?: string;
        create?: boolean;
      }>(req, ctx.readBodyOpts);
      if (!body?.branch?.trim()) {
        sendJsonResponse(res, 400, {
          success: false,
          currentBranch: '',
          message: 'Missing branch name',
        });
        return;
      }
      const targetRoot = resolveContextWorkspaceRoot(ctx, body.workspaceRoot);
      const result = await ctx.engine.switchBranch(body.branch, {
        workspaceRoot: targetRoot,
        create: body.create,
      });
      if (result.success) {
        ctx.fsService.invalidateCache(targetRoot);
        ctx.fsService.notifyTreeChange(targetRoot);
      }
      sendJsonResponse(res, result.success ? 200 : 400, result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonError(res, err, 500, {
        success: false,
        currentBranch: '',
        message: errorMsg,
      });
    }
  });
}
