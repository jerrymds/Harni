export interface GoogleOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  scope?: string;
  state?: string;
}

export interface OAuthCallbackOptions {
  /** Explicit target origin for postMessage (NEVER '*'). Restricts delivery to prevent credential leakage. */
  targetOrigin?: string;
}

/** Default fallback opener origin (never wildcard). */
export const DEFAULT_OAUTH_OPENER_ORIGIN = 'http://localhost:3000';

/** Known-legitimate opener origins for local development. Extend via GOOGLE_OAUTH_ALLOWED_ORIGINS env var. */
export const ALLOWED_OAUTH_OPENER_ORIGINS: string[] = [
  'http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000',
  'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001',
  'http://localhost:8123', 'http://127.0.0.1:8123', 'http://[::1]:8123',
];

/** Validate an origin against the allowlist plus env extension. */
export function isAllowedOAuthOpenerOrigin(origin: string): boolean {
  if (!origin || !/^https?:\/\//.test(origin)) return false;
  const envOrigins = process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS;
  if (envOrigins) {
    const extras = envOrigins.split(',').map((s) => s.trim()).filter(Boolean);
    if (extras.includes(origin)) return true;
  }
  return ALLOWED_OAUTH_OPENER_ORIGINS.includes(origin);
}

/** Resolve expected opener origin from request headers, validated against the allowlist. */
export function resolveOAuthOpenerOrigin(
  headerOrigin?: string | string[] | undefined,
  referer?: string | string[] | undefined,
): string {
  const candidates: string[] = [];
  if (typeof headerOrigin === 'string') candidates.push(headerOrigin);
  if (typeof referer === 'string') {
    try { const u = new URL(referer); if (u.origin) candidates.push(u.origin); } catch { /* ignore */ }
  }
  for (const c of candidates) {
    if (isAllowedOAuthOpenerOrigin(c)) return c;
  }
  return DEFAULT_OAUTH_OPENER_ORIGIN;
}

/** Escape HTML special characters to prevent XSS injection. */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] || c));
}

/**
 * Escapes serialized JSON string to be safely embedded inside an inline `<script>` tag.
 * Prevents HTML parser break-out attacks such as `</script><script>alert(1)//`.
 */
export function serializeJsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export class GoogleAuthPage {
  public static buildGoogleOAuthUrl(config: GoogleOAuthConfig): string {
    const clientId =
      config.clientId ||
      process.env.GOOGLE_CLIENT_ID ||
      '407408718192.apps.googleusercontent.com'; // Standard Google OAuth Client ID
    const scope =
      config.scope ||
      'openid email profile https://www.googleapis.com/auth/cloud-platform';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'select_account consent',
    });

    if (config.state) {
      params.set('state', config.state);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  public static renderOAuthRedirectPage(googleAuthUrl: string): string {
    const safeUrl = escapeHtml(googleAuthUrl);
    const safeUrlJson = serializeJsonForScript(googleAuthUrl);
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${safeUrl}">
  <title>正在導向 Google 官方登入頁面...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f8fafc;
      color: #1e293b;
      margin: 0;
      padding: 20px;
      text-align: center;
    }
    .card {
      background: white;
      border-radius: 24px;
      padding: 36px 32px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      max-width: 420px;
      width: 100%;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #e2e8f0;
      border-top-color: #1a73e8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { font-size: 18px; margin-bottom: 8px; color: #0f172a; }
    p { font-size: 13px; color: #64748b; margin-bottom: 20px; line-height: 1.5; }
    a.btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #1a73e8;
      color: white;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      padding: 10px 20px;
      border-radius: 100px;
      transition: background 0.15s;
    }
    a.btn:hover { background: #1557b0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>正在開啟 Google 官方登入頁面</h2>
    <p>系統正在為您導向 Google 帳號授權頁面（accounts.google.com）以選擇登入帳號...</p>
    <a href="${safeUrl}" class="btn">若未自動跳轉，請點此前往</a>
  </div>
  <script>
    window.location.href = ${safeUrlJson};
  </script>
</body>
</html>`;
  }

  public static renderCallbackPage(
    authData: {
      email: string;
      name: string;
      picture?: string;
      authenticatedAt: number;
      clientId?: string;
    },
    options: OAuthCallbackOptions = {},
  ): string {
    const safeData = {
      email: authData.email,
      name: authData.name,
      picture: authData.picture,
      authenticatedAt: authData.authenticatedAt,
      clientId: authData.clientId,
    };
    const jsonStr = serializeJsonForScript({
      type: 'GOOGLE_AUTH_SUCCESS',
      data: safeData,
    });

    // Use validated target origin — NEVER '*' which would let any malicious
    // opener page (e.g. via tabnabbing) intercept auth credentials.
    const targetOrigin =
      options.targetOrigin && isAllowedOAuthOpenerOrigin(options.targetOrigin)
        ? options.targetOrigin
        : DEFAULT_OAUTH_OPENER_ORIGIN;

    const safeTargetOrigin = serializeJsonForScript(targetOrigin);

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>Google 認證完成</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f0fdf4;
      color: #166534;
      margin: 0;
      text-align: center;
    }
    .box {
      background: white;
      padding: 36px 32px;
      border-radius: 24px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.05);
      max-width: 420px;
      width: 90%;
    }
    .icon { font-size: 48px; margin-bottom: 12px; }
    h2 { font-size: 20px; margin-bottom: 8px; color: #15803d; }
    p { font-size: 14px; color: #4b5563; }
    .email-badge {
      display: inline-block;
      margin-top: 8px;
      background: #e0f2fe;
      color: #0369a1;
      padding: 6px 14px;
      border-radius: 12px;
      font-family: monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">✅</div>
    <h2>Google 官方帳號認證成功！</h2>
    <div class="email-badge">${escapeHtml(authData.email)}</div>
    <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">憑證已加密儲存，視窗將自動關閉並同步至 cline-web...</p>
  </div>

  <script>
    const payload = ${jsonStr};
    // Deliver ONLY to the explicitly-approved opener origin (never '*').
    const targetOrigin = ${safeTargetOrigin};
    try {
      if (window.opener) {
        window.opener.postMessage(payload, targetOrigin);
      }
    } catch(e) {}
    setTimeout(() => {
      window.close();
    }, 800);
  </script>
</body>
</html>`;
  }
}

