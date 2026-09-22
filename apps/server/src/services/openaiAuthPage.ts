import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { DBService } from './dbService.js';

export const OPENAI_OAUTH_CLIENT_ID =
  process.env.OPENAI_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_OAUTH_ISSUER =
  process.env.OPENAI_OAUTH_ISSUER || 'https://auth.openai.com';
export const OPENAI_OAUTH_REDIRECT_URI =
  process.env.OPENAI_OAUTH_REDIRECT_URI || 'http://localhost:1455/auth/callback';
export const OPENAI_OAUTH_MODELS = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', description: 'ChatGPT 訂閱 - Codex 模型' },
];

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function decodeJwt(token?: string): Record<string, any> {
  if (!token) return {};
  try {
    const part = token.split('.')[1];
    return part ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) : {};
  } catch {
    return {};
  }
}

function html(message: string, ok: boolean): string {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>OpenAI 登入</title><body style="font-family:system-ui;padding:48px;text-align:center;background:#f8fafc;color:#0f172a"><h2>${ok ? 'OpenAI 登入完成' : 'OpenAI 登入失敗'}</h2><p>${message.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)}</p><p>現在可以關閉此視窗。</p><script>setTimeout(()=>window.close(),1200)</script></body></html>`;
}

export class OpenAIAuthPage {
  private static callbackServer: http.Server | null = null;
  private static modelCache = new Map<string, { expiresAt: number; models: Array<{ id: string; name: string; description?: string }> }>();

  public static generatePkce(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString('base64url');
    return {
      verifier,
      challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    };
  }

  public static generateState(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  public static buildAuthorizeUrl(state: string, challenge: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_OAUTH_CLIENT_ID,
      redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
      scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: 'codex_cli_rs',
    });
    return `${OPENAI_OAUTH_ISSUER}/oauth/authorize?${params.toString()}`;
  }

  public static async beginLogin(db: DBService): Promise<string> {
    if (this.callbackServer) {
      await new Promise<void>((resolve) => this.callbackServer!.close(() => resolve()));
      this.callbackServer = null;
    }
    const { verifier, challenge } = this.generatePkce();
    const state = this.generateState();
    const callbackUrl = new URL(OPENAI_OAUTH_REDIRECT_URI);
    const port = Number(callbackUrl.port || 1455);

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', OPENAI_OAUTH_REDIRECT_URI);
      if (url.pathname !== callbackUrl.pathname) {
        res.writeHead(404).end('Not found');
        return;
      }
      try {
        if (url.searchParams.get('state') !== state) throw new Error('OAuth state 不符，請重新登入。');
        const code = url.searchParams.get('code');
        if (!code) throw new Error(url.searchParams.get('error_description') || '未收到授權碼。');
        const tokens = await this.exchangeCode(code, verifier);
        this.storeTokens(db, tokens);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html('已連結 ChatGPT 訂閱帳號。', true));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html(err instanceof Error ? err.message : String(err), false));
      } finally {
        setTimeout(() => server.close(), 250);
        this.callbackServer = null;
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => resolve());
    });
    this.callbackServer = server;
    return this.buildAuthorizeUrl(state, challenge);
  }

  private static async exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code_verifier: verifier,
    });
    const res = await fetch(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body, signal: AbortSignal.timeout(20_000),
    });
    const raw = await res.json().catch(() => ({})) as TokenResponse;
    if (!res.ok || !raw.access_token) {
      throw new Error(raw.error_description || raw.error || `Token 交換失敗 (${res.status})`);
    }
    return raw;
  }

  private static storeTokens(db: DBService, tokens: TokenResponse, existing: Record<string, any> = {}): void {
    const claims = decodeJwt(tokens.id_token || existing.idToken);
    const authClaims = claims['https://api.openai.com/auth'] || {};
    db.setApiKey('openai-oauth', JSON.stringify({
      ...existing,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || existing.refreshToken,
      idToken: tokens.id_token || existing.idToken,
      expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      email: claims.email || existing.email,
      plan: authClaims.chatgpt_plan_type || existing.plan,
      accountId: authClaims.chatgpt_account_id || existing.accountId,
      authenticatedAt: Date.now(),
    }));
  }

  public static async ensureSession(db: DBService): Promise<{ accessToken: string; accountId?: string } | null> {
    const payload = db.getOAuthPayload('openai');
    if (!payload?.accessToken) return null;
    if (payload.expiresAt && Date.now() >= payload.expiresAt - 5 * 60 * 1000 && payload.refreshToken) {
      const res = await fetch(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: OPENAI_OAUTH_CLIENT_ID, grant_type: 'refresh_token', refresh_token: payload.refreshToken }),
        signal: AbortSignal.timeout(20_000),
      });
      const tokens = await res.json().catch(() => ({})) as TokenResponse;
      if (!res.ok || !tokens.access_token) throw new Error(tokens.error_description || 'OpenAI 登入已過期，請重新登入。');
      this.storeTokens(db, tokens, payload);
      const updated = db.getOAuthPayload('openai')!;
      return { accessToken: updated.accessToken, accountId: updated.accountId };
    }
    return { accessToken: payload.accessToken, accountId: payload.accountId };
  }

  /** Fetch the model catalog that is actually enabled for this ChatGPT account. */
  public static async fetchSubscriptionModels(
    session: { accessToken: string; accountId?: string },
  ): Promise<Array<{ id: string; name: string; description?: string; contextWindow?: number; maxTokens?: number }>> {
    const cacheKey = session.accountId || 'default';
    const cached = this.modelCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.models;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'codex-cli',
      originator: 'codex_cli_rs',
      'x-client-request-id': crypto.randomUUID(),
    };
    if (session.accountId) headers['ChatGPT-Account-ID'] = session.accountId;
    const res = await fetch('https://chatgpt.com/backend-api/codex/models?client_version=0.149.0', {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await res.json().catch(() => ({})) as { models?: Array<Record<string, any>>; detail?: string };
    if (!res.ok) throw new Error(raw.detail || `OpenAI 模型清單讀取失敗 (${res.status})`);
    const models = (raw.models || [])
      .filter((model) => model.visibility !== 'hide' && typeof model.slug === 'string')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((model) => {
        const slug = (model.slug as string).toLowerCase();
        let contextWindow = 128000;
        if (slug.startsWith('o1') || slug.startsWith('o3') || slug.includes('o3-mini')) {
          contextWindow = 200000;
        }
        return {
          id: model.slug as string,
          name: (model.display_name || model.slug) as string,
          description: model.description as string | undefined,
          contextWindow,
          maxTokens: 8192,
        };
      });
    if (!models.length) throw new Error('此 ChatGPT 帳號目前沒有可用的 Codex 模型。');
    this.modelCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, models });
    return models;
  }
}
