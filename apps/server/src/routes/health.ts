import type { Router } from './router.js';
import { sendJsonResponse } from '../utils/http.js';

export function registerHealthRoutes(router: Router): void {
  router.get('/health', ({ res, ctx }) => {
    sendJsonResponse(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      workspace: ctx.workspaceRoot,
      timestamp: Date.now(),
      authRequired: Boolean(ctx.authToken),
    });
  });
}
