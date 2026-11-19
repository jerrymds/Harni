/**
 * Sanitizes markdown link/image URLs against XSS schemes (javascript:, vbscript:, data:, etc.)
 * while permitting safe web/local schemes and relative or local filesystem paths.
 */
export function safeUrlTransform(url: string): string {
  if (!url) return '';
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Keep raw url if percent-encoding is malformed
  }
  const cleaned = decoded.replace(/[\u0000-\u0020\u007f]/g, '').trim();
  if (!cleaned) return '';
  if (
    cleaned.startsWith('#') ||
    cleaned.startsWith('/') ||
    cleaned.startsWith('./') ||
    cleaned.startsWith('../') ||
    /^[a-zA-Z]:[\\/]/.test(cleaned) ||
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)
  ) {
    return url;
  }
  if (/^(https?|mailto|file):/i.test(cleaned)) {
    return url;
  }
  return '';
}

/**
 * Redacts sensitive auth tokens (`token`, `auth_token`) from URLs before logging.
 */
export function redactUrlToken(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has('token')) {
      parsed.searchParams.set('token', '***');
    }
    if (parsed.searchParams.has('auth_token')) {
      parsed.searchParams.set('auth_token', '***');
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/([?&](?:token|auth_token)=)[^&]*/gi, '$1***');
  }
}
