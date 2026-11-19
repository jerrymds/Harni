import * as crypto from 'node:crypto';
import type * as http from 'node:http';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extract specific cookie value by key name from Cookie header.
 */
export function extractCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * Extract auth token from incoming HTTP / WebSocket handshake request.
 * Priority: Authorization header -> X-API-Key/X-Auth-Token header -> Query param ?token=?auth_token -> Cookie
 */
export function extractAuthTokenFromRequest(req: http.IncomingMessage, url: URL): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }
  const xApiKey = req.headers['x-api-key'] || req.headers['x-auth-token'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }
  const queryToken = url.searchParams.get('token') || url.searchParams.get('auth_token');
  if (queryToken && queryToken.trim()) {
    return queryToken.trim();
  }
  const cookieToken =
    extractCookie(req.headers.cookie, 'auth_token') || extractCookie(req.headers.cookie, 'authToken');
  if (cookieToken && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return undefined;
}

/**
 * Validates whether the host binding requires authentication to prevent RCE vulnerabilities.
 */
export function validateHostBindingSecurity(
  host: string,
  authToken?: string,
  allowInsecureRemote = false,
): void {
  const isLocalhost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLocalhost && !authToken && !allowInsecureRemote) {
    throw new Error(
      `[Security Prohibited] Server host is configured to bind to '${host}' (non-localhost) without AUTH_TOKEN. ` +
      `To prevent unauthorized remote command execution (RCE) and credential leakage, you must configure AUTH_TOKEN or HARNI_AUTH_TOKEN in the environment or configuration. ` +
      `If you explicitly intend to allow unauthenticated remote access, set ALLOW_INSECURE_REMOTE_ACCESS=true.`
    );
  }
}

const MAX_AUTH_STATE_ENTRIES = 256;

/** Short-lived PKCE verifier store, keyed by `state`, for paste-code OAuth flows. */
const pkceStore = new Map<string, { verifier: string; createdAt: number }>();

export function putPkce(state: string, verifier: string): void {
  const now = Date.now();
  for (const [k, v] of pkceStore) {
    if (now - v.createdAt > 15 * 60 * 1000) pkceStore.delete(k);
  }
  while (pkceStore.size >= MAX_AUTH_STATE_ENTRIES) {
    const oldest = pkceStore.keys().next().value;
    if (oldest !== undefined) pkceStore.delete(oldest);
    else break;
  }
  pkceStore.set(state, { verifier, createdAt: now });
}

export function takePkce(state: string | null | undefined): string | undefined {
  if (!state) return undefined;
  const entry = pkceStore.get(state);
  if (!entry) return undefined;
  pkceStore.delete(state);
  return Date.now() - entry.createdAt > 15 * 60 * 1000 ? undefined : entry.verifier;
}

/** Short-lived CSRF state store for Google OAuth callbacks. */
const oauthStateStore = new Map<string, number>();
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function putOAuthState(state: string): void {
  const now = Date.now();
  for (const [k, createdAt] of oauthStateStore) {
    if (now - createdAt > OAUTH_STATE_TTL_MS) {
      oauthStateStore.delete(k);
    }
  }
  while (oauthStateStore.size >= MAX_AUTH_STATE_ENTRIES) {
    const oldest = oauthStateStore.keys().next().value;
    if (oldest !== undefined) oauthStateStore.delete(oldest);
    else break;
  }
  oauthStateStore.set(state, now);
}

export function takeOAuthState(state: string | null | undefined): boolean {
  if (!state) return false;
  const createdAt = oauthStateStore.get(state);
  if (createdAt === undefined) return false;
  oauthStateStore.delete(state);
  return Date.now() - createdAt <= OAUTH_STATE_TTL_MS;
}

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Validates whether an HTTP/WebSocket Origin header belongs to a trusted local
 * desktop/browser origin or an explicitly configured allowlist.
 */
export function isAllowedOrigin(origin: string | undefined, requestHost?: string): boolean {
  if (!origin) return false;
  const trimmed = origin.trim();
  if (!trimmed || trimmed === 'null') return false;

  if (LOCAL_ORIGIN_PATTERN.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('file://') || trimmed.startsWith('app://')) {
    return true;
  }

  if (requestHost) {
    try {
      const parsed = new URL(trimmed);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.host.toLowerCase() === requestHost.toLowerCase()
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  const extra = [
    process.env.HARNI_ALLOWED_ORIGINS,
    process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS,
  ]
    .filter(Boolean)
    .join(',');
  if (extra) {
    const allowed = extra
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes(trimmed)) {
      return true;
    }
  }

  return false;
}
