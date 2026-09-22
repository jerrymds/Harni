import type { Router } from './router.js';
import { readJsonBody, sendJsonError, sendJsonResponse } from '../utils/http.js';

export function registerCredentialsRoutes(router: Router): void {
  // --- Credentials REST Endpoints (Encrypted Vault) ---
  router.get('/api/credentials', ({ res, ctx }) => {
    try {
      const credentials = ctx.dbService.getAllCredentialsStatus();
      sendJsonResponse(res, 200, { credentials });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  router.post('/api/credentials', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{ provider?: string; apiKey?: string }>(req, ctx.readBodyOpts);
      if (!body || !body.provider) {
        sendJsonResponse(res, 400, { error: 'Provider is required' });
        return;
      }

      ctx.dbService.setApiKey(body.provider, body.apiKey || '');
      const credentials = ctx.dbService.getAllCredentialsStatus();
      sendJsonResponse(res, 200, { success: true, credentials });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  router.delete('/api/credentials/:provider', ({ res, params, ctx }) => {
    try {
      const provider = (params.provider || '').trim();
      if (provider) {
        ctx.dbService.deleteApiKey(provider);
      }
      const credentials = ctx.dbService.getAllCredentialsStatus();
      sendJsonResponse(res, 200, { success: true, credentials });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });
}
