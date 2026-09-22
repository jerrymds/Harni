import type { Router } from './router.js';
import { readJsonBody, sendJsonError, sendJsonResponse } from '../utils/http.js';

export function registerDbRoutes(router: Router): void {
  // --- SQLite Database REST Endpoints ---

  // 1. Initial full state (folders, sessions with messages, settings)
  router.get('/api/db/init', ({ res, ctx }) => {
    try {
      const state = ctx.dbService.getInitialState();
      sendJsonResponse(res, 200, state);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg });
    }
  });

  // 2. Sessions list
  router.get('/api/db/sessions', ({ res, url, ctx }) => {
    try {
      const includeMessages = url.searchParams.get('includeMessages') === 'true';
      const sessions = ctx.dbService.getSessions({ includeMessages });
      sendJsonResponse(res, 200, { sessions });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg });
    }
  });

  // 3. Save/update session(s)
  router.post('/api/db/sessions', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody(req, ctx.readBodyOpts);
      if (Array.isArray(body)) {
        ctx.dbService.saveSessions(body);
      } else if (body && body.id) {
        ctx.dbService.saveSession(body, true);
      }
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 4. Save or append messages to session
  router.post('/api/db/sessions/:id/messages', async ({ req, res, params, ctx }) => {
    try {
      const sessionId = params.id;
      const body = await readJsonBody(req, ctx.readBodyOpts);
      if (Array.isArray(body)) {
        ctx.dbService.saveMessages(sessionId, body);
      } else if (body && body.id) {
        ctx.dbService.appendMessage(sessionId, body);
      }
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 5. Clear messages for session
  router.delete('/api/db/sessions/:id/messages', ({ res, params, ctx }) => {
    try {
      const sessionId = params.id;
      ctx.dbService.clearSessionMessages(sessionId);
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 6. Single session details (with messages)
  router.get('/api/db/sessions/:id', ({ res, params, ctx }) => {
    try {
      const sessionId = params.id;
      const session = ctx.dbService.getSession(sessionId);
      if (session) {
        sendJsonResponse(res, 200, session);
      } else {
        sendJsonResponse(res, 404, { error: 'Session not found' });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg });
    }
  });

  // 7. Delete session
  router.delete('/api/db/sessions/:id', async ({ res, params, ctx }) => {
    try {
      const sessionId = params.id;
      ctx.dbService.deleteSession(sessionId);
      await ctx.engine.deleteSessionGitArtifacts(sessionId);
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 8. Folders list
  router.get('/api/db/folders', ({ res, ctx }) => {
    try {
      const folders = ctx.dbService.getFolders();
      sendJsonResponse(res, 200, { folders });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 9. Save folder(s)
  router.post('/api/db/folders', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody(req, ctx.readBodyOpts);
      if (Array.isArray(body)) {
        ctx.dbService.saveFolders(body);
      } else if (body && body.id) {
        ctx.dbService.saveFolder(body);
      }
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 10. Delete folder
  router.delete('/api/db/folders/:id', ({ res, params, ctx }) => {
    try {
      const folderId = params.id;
      ctx.dbService.deleteFolder(folderId);
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 11. Settings get & set
  router.get('/api/db/settings', ({ res, ctx }) => {
    try {
      const settings = ctx.dbService.getSettings();
      sendJsonResponse(res, 200, { settings });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  router.post('/api/db/settings', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody(req, ctx.readBodyOpts);
      if (body && typeof body === 'object') {
        ctx.dbService.saveSettings(body);

        // Hot-reload MCP configuration if mcp_enabled or mcp_config changed
        if (body.mcp_enabled !== undefined || body.mcp_config !== undefined) {
          const effectiveEnabled =
            (body.mcp_enabled !== undefined
              ? body.mcp_enabled
              : ctx.dbService.getSetting('mcp_enabled')) === 'true';

          const rawConfig =
            body.mcp_config !== undefined
              ? body.mcp_config
              : ctx.dbService.getSetting('mcp_config');

          let mcpServers = {};
          if (rawConfig) {
            try {
              const parsed = JSON.parse(rawConfig);
              if (parsed && typeof parsed === 'object') {
                mcpServers = parsed.mcpServers || parsed;
              }
            } catch (e) {
              console.warn('[DB Route] Failed to parse mcp_config for hot-reload:', e);
            }
          }

          ctx.engine
            .updateMcpServers({
              mcpEnabled: effectiveEnabled,
              mcpServers,
              workspaceRoot: ctx.workspaceRoot,
            })
            .catch((err) => {
              console.error('[DB Route] Failed to hot-reload MCP servers:', err);
            });
        }
      }
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // 12. Legacy Data Import (e.g. from localStorage)
  router.post('/api/db/import', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody(req, ctx.readBodyOpts);
      const result = ctx.dbService.importLegacyData(body || {});
      sendJsonResponse(res, 200, { success: true, ...result });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });
}
