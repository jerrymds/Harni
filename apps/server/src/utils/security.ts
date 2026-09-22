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
  return match ? decodeURIComponent(match[1]) : undefined;
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
      `To prevent unauthorized remote command execution (RCE) and credential leakage, you must configure AUTH_TOKEN or CLINE_AUTH_TOKEN in the environment or configuration. ` +
      `If you explicitly intend to allow unauthenticated remote access, set ALLOW_INSECURE_REMOTE_ACCESS=true.`
    );
  }
}

/** Short-lived PKCE verifier store, keyed by `state`, for paste-code OAuth flows. */
const pkceStore = new Map<string, { verifier: string; createdAt: number }>();

export function putPkce(state: string, verifier: string): void {
  const now = Date.now();
  for (const [k, v] of pkceStore) {
    if (now - v.createdAt > 15 * 60 * 1000) pkceStore.delete(k);
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
