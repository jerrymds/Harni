import type { LLMProviderType } from '@harni/types';
import type { Router } from './router.js';
import { sendJsonResponse } from '../utils/http.js';
import { AntigravityBridgeManager } from '../services/antigravityBridgeManager.js';
import { OpenAIAuthPage } from '../services/openaiAuthPage.js';

export function registerModelRoutes(router: Router): void {
  router.get('/api/models', async ({ res, url, ctx }) => {
    try {
      const provider = (url.searchParams.get('provider') || 'cline') as LLMProviderType;
      const explicitApiKey = url.searchParams.get('apiKey');
      const dbKey = ctx.dbService.getApiKey(provider) || undefined;
      const apiKey =
        provider !== 'custom' && dbKey
          ? dbKey
          : (explicitApiKey && explicitApiKey.trim() ? explicitApiKey.trim() : dbKey);

      const explicitBaseURL = url.searchParams.get('baseURL');
      const dbBaseURL =
        ctx.dbService.getSetting(`base_url_${provider}`) ||
        (provider === 'custom' ? ctx.dbService.getSetting('custom_base_url') : null);
      const baseURL =
        explicitBaseURL && explicitBaseURL.trim()
          ? explicitBaseURL.trim()
          : (dbBaseURL || undefined);

      if (provider === 'antigravity') {
        const manager = AntigravityBridgeManager.getInstance();
        if (baseURL) {
          manager.setBaseURL(baseURL);
        }
      }

      // Claude subscription login: /v1/models doesn't accept OAuth tokens cleanly,
      // so serve the curated subscription model list.
      if (provider === 'anthropic') {
        const explicit = url.searchParams.get('apiKey');
        const oauth = ctx.dbService.getOAuthPayload('anthropic');
        if ((!explicit || !explicit.trim()) && oauth && (oauth.accessToken || oauth.access_token)) {
          const { CLAUDE_OAUTH_MODELS } = await import('../services/anthropicAuthPage.js');
          sendJsonResponse(res, 200, { models: CLAUDE_OAUTH_MODELS });
          return;
        }
      }

      if (provider === 'openai') {
        const explicit = url.searchParams.get('apiKey');
        const oauth = ctx.dbService.getOAuthPayload('openai');
        if ((!explicit || !explicit.trim()) && oauth?.accessToken) {
          const session = await OpenAIAuthPage.ensureSession(ctx.dbService);
          if (!session) throw new Error('OpenAI 訂閱登入已失效，請重新登入。');
          const models = await OpenAIAuthPage.fetchSubscriptionModels(session);
          sendJsonResponse(res, 200, { models });
          return;
        }
      }

      const { ModelService } = await import('../services/modelService.js');
      const models = await ModelService.fetchModels({ provider, apiKey, baseURL });

      sendJsonResponse(res, 200, { models });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg, models: [] });
    }
  });

  const handleQuotaRequest = async ({ res, url }: { res: any; url: URL }) => {
    try {
      const provider = (url.searchParams.get('provider') || 'antigravity') as LLMProviderType;
      const forceRefresh =
        url.searchParams.get('refresh') === 'true' || url.searchParams.get('force') === 'true';

      if (provider === 'antigravity') {
        const { AntigravityQuotaService } = await import('../services/antigravityQuotaService.js');
        const quotaService = AntigravityQuotaService.getInstance();
        const quota = await quotaService.getQuota(forceRefresh);
        sendJsonResponse(res, 200, quota);
        return;
      }

      // Default empty pool response for other providers
      sendJsonResponse(res, 200, {
        provider,
        updatedAt: Date.now(),
        pools: [],
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, {
        error: errorMsg,
        pools: [],
        provider: 'antigravity',
        updatedAt: Date.now(),
      });
    }
  };

  router.get('/api/models/quota', handleQuotaRequest);
  router.get('/api/antigravity/quota', handleQuotaRequest);
}
