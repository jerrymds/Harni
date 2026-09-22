import type { Router } from './router.js';
import { sendJsonResponse } from '../utils/http.js';

export function registerSkillsRoutes(router: Router): void {
  // --- Skills REST Endpoints ---
  router.get('/api/skills', async ({ res, ctx }) => {
    try {
      const skillRegistry = ctx.engine.getSkillRegistry();
      await skillRegistry.discoverWorkspaceSkills(ctx.workspaceRoot);
      const skills = skillRegistry.getAllSkills();
      sendJsonResponse(res, 200, { skills });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg, skills: [] });
    }
  });

  router.post('/api/skills/refresh', async ({ res, ctx }) => {
    try {
      const skillRegistry = ctx.engine.getSkillRegistry();
      await skillRegistry.discoverWorkspaceSkills(ctx.workspaceRoot);
      const skills = skillRegistry.getAllSkills();
      sendJsonResponse(res, 200, { success: true, skills });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg, skills: [] });
    }
  });
}
