import type { Router } from './router.js';
import { readJsonBody, sendJsonError, sendJsonResponse } from '../utils/http.js';

export function registerPluginsRoutes(router: Router): void {
  // GET /api/plugins
  router.get('/api/plugins', ({ res, ctx }) => {
    try {
      const plugins = ctx.engine.getPluginManager().getPluginsMetadata();
      sendJsonResponse(res, 200, { plugins });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // POST /api/plugins/toggle
  router.post('/api/plugins/toggle', async ({ req, res, ctx }) => {
    try {
      const body = (await readJsonBody(req, ctx.readBodyOpts)) as Record<string, unknown>;
      const { id, enabled } = body || {};

      if (typeof id !== 'string' || !id.trim() || typeof enabled !== 'boolean') {
        sendJsonResponse(res, 400, { error: 'Invalid plugin id or enabled state' });
        return;
      }

      const trimmedId = id.trim();
      const pluginManager = ctx.engine.getPluginManager();
      if (!pluginManager.hasPlugin(trimmedId)) {
        sendJsonResponse(res, 404, { error: `Plugin '${trimmedId}' not found` });
        return;
      }

      ctx.engine.setPluginEnabled(trimmedId, enabled);
      ctx.dbService.saveSettings({ [`plugin_enabled_${trimmedId}`]: String(enabled) });

      const plugins = pluginManager.getPluginsMetadata();
      sendJsonResponse(res, 200, { success: true, plugins });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });
}
