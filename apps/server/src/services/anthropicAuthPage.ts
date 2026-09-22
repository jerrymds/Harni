import * as crypto from 'node:crypto';
import type { DBService } from './dbService.js';

/**
 * Claude Code–compatible OAuth flow for Claude Pro / Max subscriptions.
 *
 * Anthropic publishes a public OAuth client for Claude Code. After the user
 * approves on claude.ai they are redirected to
 * `https://console.anthropic.com/oauth/code/callback`, which shows an
 * `<code>#<state>` string to copy back into cline-web (a "paste code" flow — no
 * loopback listener needed).
 *
 * The resulting `sk-ant-oat…` access token works directly against
 * `https://api.anthropic.com/v1/messages` with `Authorization: Bearer …`,
 * `anthropic-beta: oauth-2025-04-20`, and a system prompt whose first block is
 * the Claude Code identity string.
 */

export const ANTHROPIC_OAUTH_CLIENT_ID =
  process.env.ANTHROPIC_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export const ANTHROPIC_OAUTH_AUTHORIZE_URL =
  process.env.ANTHROPIC_OAUTH_AUTHORIZE_URL || 'https://claude.ai/oauth/authorize';

export const ANTHROPIC_OAUTH_TOKEN_URL =
  process.env.ANTHROPIC_OAUTH_TOKEN_URL || 'https://console.anthropic.com/v1/oauth/token';

export const ANTHROPIC_OAUTH_REDIRECT_URI =
  process.env.ANTHROPIC_OAUTH_REDIRECT_URI ||
  'https://console.anthropic.com/oauth/code/callback';

export const ANTHROPIC_OAUTH_SCOPE =
  process.env.ANTHROPIC_OAUTH_SCOPE || 'org:create_api_key user:profile user:inference';

/** First system block required for Claude Code OAuth tokens. */
export const CLAUDE_CODE_SYSTEM_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

/** Beta header that unlocks OAuth-token access to the Messages API. */
export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';

/** Models offered when signed in with a Claude subscription (no /models call). */
export const CLAUDE_OAUTH_MODELS: Array<{ id: string; name: string; description?: string; contextWindow?: number; maxTokens?: number }> = [
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Claude 訂閱 - 最新旗艦編程模型 (預設)', contextWindow: 200000, maxTokens: 8192 },
  { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', description: 'Claude 訂閱 - 最強推理 (Max 方案)', contextWindow: 200000, maxTokens: 8192 },
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', description: 'Claude 訂閱 - 上一代主力', contextWindow: 200000, maxTokens: 8192 },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Claude 訂閱 - 高速輕量', contextWindow: 200000, maxTokens: 8192 },
];

const FETCH_TIMEOUT_MS = 20000;

export interface AnthropicPkcePair {
  verifier: string;
  challenge: string;
}

export interface AnthropicTokenSet {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  raw: Record<string, unknown>;
}

export class AnthropicAuthPage {
  public static generatePkce(): AnthropicPkcePair {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  public static generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  public static buildAuthorizeUrl(config: { state: string; codeChallenge: string }): string {
    const params = new URLSearchParams({
      code: 'true',
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      response_type: 'code',
      redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
      scope: ANTHROPIC_OAUTH_SCOPE,
      code_challenge: config.codeChallenge,
      code_challenge_method: 'S256',
      state: config.state,
    });
    return `${ANTHROPIC_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchanges the pasted authorization code for tokens. The value the user pastes
   * from the callback page is `<code>#<state>`; either form is accepted here.
   */
  public static async exchangeCodeForTokens(opts: {
    code: string;
    state: string;
    codeVerifier: string;
  }): Promise<AnthropicTokenSet> {
    let code = opts.code.trim();
    let state = opts.state;
    if (code.includes('#')) {
      const [c, s] = code.split('#');
      code = (c || '').trim();
      if (s) state = s.trim();
    }

    const res = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        state,
        client_id: ANTHROPIC_OAUTH_CLIENT_ID,
        redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
        code_verifier: opts.codeVerifier,
      }),
    });

    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `Anthropic token exchange failed (${res.status}): ${JSON.stringify(raw).slice(0, 300)}`,
      );
    }
    return this.toTokenSet(raw);
  }

  public static async refreshTokens(refreshToken: string): Promise<AnthropicTokenSet> {
    const res = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      }),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `Anthropic token refresh failed (${res.status}): ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }
    const set = this.toTokenSet(raw);
    if (!set.refreshToken) set.refreshToken = refreshToken;
    return set;
  }

  private static toTokenSet(raw: Record<string, unknown>): AnthropicTokenSet {
    const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : undefined;
    return {
      accessToken: typeof raw.access_token === 'string' ? raw.access_token : undefined,
      refreshToken: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
      raw,
    };
  }

  /**
   * Returns a fresh Claude access token for the `anthropic` provider, refreshing
   * via the stored refresh token when it is within 5 minutes of expiry. Returns
   * null when there is no Claude OAuth session.
   */
  public static async ensureSession(db: DBService): Promise<{ accessToken: string } | null> {
    const payload = db.getOAuthPayload('anthropic');
    const accessToken: string | undefined = payload?.accessToken || payload?.access_token;
    if (!payload || !accessToken) return null;

    const expiresAt: number | undefined = payload.expiresAt;
    const needsRefresh = typeof expiresAt === 'number' && Date.now() >= expiresAt - 5 * 60 * 1000;

    if (needsRefresh && payload.refreshToken) {
      try {
        const refreshed = await this.refreshTokens(payload.refreshToken);
        const merged = {
          ...payload,
          accessToken: refreshed.accessToken || accessToken,
          refreshToken: refreshed.refreshToken || payload.refreshToken,
          expiresAt: refreshed.expiresAt || payload.expiresAt,
          authenticatedAt: Date.now(),
        };
        db.setApiKey('anthropic-oauth', JSON.stringify(merged));
        return { accessToken: merged.accessToken };
      } catch (err) {
        console.warn('[Anthropic] Claude token refresh failed, using existing token:', err);
      }
    }

    return { accessToken };
  }

  /**
   * Best-effort account profile (email / org / plan) for display.
   */
  public static extractProfile(raw: Record<string, unknown>): {
    email?: string;
    organization?: string;
    plan?: string;
  } {
    const account = (raw.account as Record<string, any> | undefined) || {};
    const org = (raw.organization as Record<string, any> | undefined) || {};
    return {
      email: account.email_address || account.email || undefined,
      organization: org.name || undefined,
      plan:
        (raw.subscription_type as string | undefined) ||
        org.billing_type ||
        undefined,
    };
  }
}
