import type { Router } from './router.js';
import { readJsonBody, readRequestBody, sendJsonError, sendJsonResponse } from '../utils/http.js';
import { putPkce, takePkce } from '../utils/security.js';
import { GoogleAuthPage, escapeHtml } from '../services/googleAuthPage.js';
import { AnthropicAuthPage } from '../services/anthropicAuthPage.js';
import { OpenAIAuthPage } from '../services/openaiAuthPage.js';

export function registerAuthRoutes(router: Router): void {
  // --- Google OAuth Config Endpoint ---
  router.post('/api/auth/google/config', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{ clientId?: string; clientSecret?: string }>(req, ctx.readBodyOpts);
      if (body.clientId) {
        ctx.dbService.setSetting('google_client_id', body.clientId);
      }
      if (body.clientSecret) {
        ctx.dbService.setApiKey('google_client_secret', body.clientSecret);
      }
      sendJsonResponse(res, 200, { success: true });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // --- Official Google OAuth2 Login & Account Chooser Redirection ---
  const handleGoogleLogin = ({ req, res, url, ctx }: any) => {
    const customClientId = ctx.dbService.getSetting('google_client_id') || undefined;
    const customClientSecret = ctx.dbService.getApiKey('google_client_secret') || undefined;
    const redirectUri = `http://${req.headers.host || 'localhost:3001'}/auth/google/callback`;
    const googleAuthUrl = GoogleAuthPage.buildGoogleOAuthUrl({
      clientId: customClientId,
      clientSecret: customClientSecret,
      redirectUri,
    });

    // If requested as raw URL or redirect helper
    if (url.searchParams.get('format') === 'json') {
      sendJsonResponse(res, 200, { url: googleAuthUrl });
      return;
    }

    // Direct HTTP 302 Redirect to Google's official accounts.google.com login page
    res.writeHead(302, { Location: googleAuthUrl });
    res.end();
  };

  router.get('/auth/google/login', handleGoogleLogin);
  router.get('/api/auth/google/login', handleGoogleLogin);

  const handleGoogleCallback = async ({ req, res, url, ctx }: any) => {
    try {
      let email = 'user@example.com';
      let name = 'Google Antigravity User';
      let picture = 'https://lh3.googleusercontent.com/a/default-user';
      let accessToken: string | undefined;
      let refreshToken: string | undefined;

      let code: string | null = null;
      if (req.method === 'GET') {
        code = url.searchParams.get('code');
        const queryEmail = url.searchParams.get('email');
        const queryName = url.searchParams.get('name');
        if (queryEmail) email = queryEmail.trim();
        if (queryName) name = queryName.trim();
      } else if (req.method === 'POST') {
        const body = await readRequestBody(req, ctx.readBodyOpts);
        code = body.code || null;
        if (body.email) email = body.email.trim();
        if (body.name) name = body.name.trim();
      }

      const clientId =
        ctx.dbService.getSetting('google_client_id') ||
        process.env.GOOGLE_CLIENT_ID ||
        '407408718192.apps.googleusercontent.com';
      const clientSecret =
        ctx.dbService.getApiKey('google_client_secret') ||
        process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = `http://${req.headers.host || 'localhost:3001'}/auth/google/callback`;

      // If authorization code was returned from accounts.google.com, attempt token exchange
      if (code && clientSecret) {
        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code',
            }),
          });
          if (tokenRes.ok) {
            const tokenData = (await tokenRes.json()) as any;
            accessToken = tokenData.access_token;
            refreshToken = tokenData.refresh_token;

            // Fetch Google user profile
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (userRes.ok) {
              const userData = (await userRes.json()) as any;
              if (userData.email) email = userData.email;
              if (userData.name) name = userData.name;
              if (userData.picture) picture = userData.picture;
            }
          }
        } catch (tokenErr) {
          console.warn('[Server] Google OAuth token exchange warning:', tokenErr);
        }
      }

      const authPayload = {

        email,
        name,
        picture,
        accessToken,
        refreshToken,
        authenticatedAt: Date.now(),
      };

      // Encrypt with AES-256-GCM and store in SQLite
      ctx.dbService.setApiKey('antigravity', JSON.stringify(authPayload));

      const callbackHtml = GoogleAuthPage.renderCallbackPage(authPayload);
      sendJsonResponse(res, 200, callbackHtml, 'text/html; charset=utf-8');
    } catch (err: unknown) {
      const statusCode = typeof (err as any)?.statusCode === 'number' ? (err as any).statusCode : 500;
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent && !res.writableEnded) {
        sendJsonResponse(res, statusCode, `<h3>Google 官方認證發生錯誤: ${escapeHtml(errorMsg)}</h3>`, 'text/html; charset=utf-8');
      }
    }
  };

  router.get('/auth/google/callback', handleGoogleCallback);
  router.post('/auth/google/callback', handleGoogleCallback);
  router.get('/api/auth/google/callback', handleGoogleCallback);
  router.post('/api/auth/google/callback', handleGoogleCallback);

  router.get('/api/auth/google/status', ({ res, ctx }) => {
    try {
      const encryptedKey = ctx.dbService.getApiKey('antigravity');
      const customClientId = ctx.dbService.getSetting('google_client_id') || undefined;
      const customClientSecret = ctx.dbService.getApiKey('google_client_secret') || undefined;
      if (encryptedKey && encryptedKey.trim()) {
        let authInfo: any = {
          authenticated: true,
          email: 'user@gmail.com',
          name: 'Google User',
          authenticatedAt: Date.now(),
        };
        try {
          const parsed = JSON.parse(encryptedKey);
          authInfo = { ...authInfo, ...parsed, authenticated: true };
        } catch {}
        if (customClientId) authInfo.clientId = customClientId;
        if (customClientSecret) authInfo.clientSecret = customClientSecret;
        sendJsonResponse(res, 200, authInfo);
      } else {
        sendJsonResponse(res, 200, { authenticated: false, clientId: customClientId, clientSecret: customClientSecret });
      }
    } catch (err: unknown) {
      sendJsonError(res, err, 500, { authenticated: false });
    }
  });

  router.post('/api/auth/google', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{
        email?: string;
        name?: string;
        picture?: string;
        code?: string;
      }>(req, ctx.readBodyOpts);

      const authPayload = {

        email: body?.email || 'user@example.com',
        name: body?.name || 'Google Antigravity User',
        picture: body?.picture || 'https://lh3.googleusercontent.com/a/default-user',
        authenticatedAt: Date.now(),
      };

      // Encrypt with AES-256-GCM and store in SQLite
      ctx.dbService.setApiKey('antigravity', JSON.stringify(authPayload));

      const credentials = ctx.dbService.getAllCredentialsStatus();
      sendJsonResponse(res, 200, {
        success: true,
        authenticated: true,
        ...authPayload,
        credentials,
      });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  router.delete('/api/auth/google', ({ res, ctx }) => {
    try {
      ctx.dbService.deleteApiKey('antigravity');
      ctx.dbService.deleteApiKey('google_client_secret');
      const credentials = ctx.dbService.getAllCredentialsStatus();
      sendJsonResponse(res, 200, { success: true, authenticated: false, credentials });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // --- Claude (Pro/Max subscription) OAuth — Claude Code compatible, paste-code flow ---
  const handleAnthropicLogin = ({ res, url }: any) => {
    const { verifier, challenge } = AnthropicAuthPage.generatePkce();
    const state = AnthropicAuthPage.generateState();
    putPkce(state, verifier);
    const authUrl = AnthropicAuthPage.buildAuthorizeUrl({ state, codeChallenge: challenge });

    if (url.searchParams.get('format') === 'json') {
      sendJsonResponse(res, 200, { url: authUrl, state });
      return;
    }
    res.writeHead(302, { Location: authUrl });
    res.end();
  };

  router.get('/auth/anthropic/login', handleAnthropicLogin);
  router.get('/api/auth/anthropic/login', handleAnthropicLogin);

  router.post('/api/auth/anthropic/exchange', async ({ req, res, ctx }) => {
    try {
      const body = await readJsonBody<{ code?: string; state?: string }>(req, ctx.readBodyOpts);
      const rawCode = (body.code || '').trim();
      if (!rawCode) {
        sendJsonResponse(res, 400, { error: '缺少授權碼' });
        return;
      }
      const state = body.state || (rawCode.includes('#') ? rawCode.split('#')[1] : '') || '';
      const verifier = takePkce(state);
      if (!verifier) {
        sendJsonResponse(res, 400, { error: '登入階段已逾時或 state 不符，請重新點「使用 Claude 登入」。' });
        return;
      }

      const tokens = await AnthropicAuthPage.exchangeCodeForTokens({
        code: rawCode,
        state,
        codeVerifier: verifier,
      });
      const profile = AnthropicAuthPage.extractProfile(tokens.raw);

      const authPayload = {
        email: profile.email,
        organization: profile.organization,
        plan: profile.plan,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        authenticatedAt: Date.now(),
      };
      ctx.dbService.setApiKey('anthropic-oauth', JSON.stringify(authPayload));
      console.log(
        `[Server] Claude OAuth login stored for ${profile.email || 'unknown'} (${profile.plan || 'subscription'})`,
      );

      const credentials = ctx.dbService.getAllCredentialsStatus();
      sendJsonResponse(res, 200, {
        success: true,
        authenticated: true,
        email: profile.email,
        organization: profile.organization,
        plan: profile.plan,
        authenticatedAt: authPayload.authenticatedAt,
        credentials,
      });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  router.get('/api/auth/anthropic/status', ({ res, ctx }) => {
    try {
      const payload = ctx.dbService.getOAuthPayload('anthropic');
      if (payload && payload.accessToken) {
        sendJsonResponse(res, 200, {
          authenticated: true,
          email: payload.email,
          organization: payload.organization,
          plan: payload.plan,
          authenticatedAt: payload.authenticatedAt || Date.now(),
        });
      } else {
        sendJsonResponse(res, 200, { authenticated: false });
      }
    } catch (err: unknown) {
      sendJsonError(res, err, 500, { authenticated: false });
    }
  });

  router.delete('/api/auth/anthropic', ({ res, ctx }) => {
    try {
      ctx.dbService.deleteApiKey('anthropic-oauth');
      const credentials = ctx.dbService.getAllCredentialsStatus();
      sendJsonResponse(res, 200, { success: true, authenticated: false, credentials });
    } catch (err: unknown) {
      sendJsonError(res, err);
    }
  });

  // --- OpenAI ChatGPT Plus/Pro OAuth — Codex compatible loopback flow ---
  router.get('/api/auth/openai/login', async ({ res, ctx }) => {
    try {
      const authUrl = await OpenAIAuthPage.beginLogin(ctx.dbService);
      sendJsonResponse(res, 200, { url: authUrl });
    } catch (err) {
      sendJsonError(res, err);
    }
  });

  router.get('/api/auth/openai/status', ({ res, ctx }) => {
    const payload = ctx.dbService.getOAuthPayload('openai');
    sendJsonResponse(res, 200, payload?.accessToken ? {
      authenticated: true, email: payload.email, plan: payload.plan,
      authenticatedAt: payload.authenticatedAt,
    } : { authenticated: false });
  });

  router.delete('/api/auth/openai', ({ res, ctx }) => {
    ctx.dbService.deleteApiKey('openai-oauth');
    sendJsonResponse(res, 200, { success: true, authenticated: false, credentials: ctx.dbService.getAllCredentialsStatus() });
  });
}
