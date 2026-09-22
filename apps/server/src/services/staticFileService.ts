import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * MIME type map for common static assets served by the desktop build.
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * Zero-dependency static file service for the packaged desktop build.
 *
 * Enabled by setting the `HARNI_STATIC_DIR` environment variable to the
 * built web frontend directory (e.g. apps/web/dist). Requests that do not
 * match any API route are served from that directory with an SPA fallback
 * to index.html.
 *
 * Security: all resolved paths are verified to stay inside the static root
 * to prevent path traversal attacks.
 */
export class StaticFileService {
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    if (!fs.existsSync(path.join(this.root, 'index.html'))) {
      console.warn(`[StaticFileService] index.html not found in static root: ${this.root}`);
    }
  }

  public isEnabled(): boolean {
    return fs.existsSync(path.join(this.root, 'index.html'));
  }

  /**
   * Resolve a request pathname to an absolute file path inside the root.
   * Returns null when the resolved path escapes the root (path traversal).
   */
  public resolveSafePath(pathname: string): string | null {
    // Strip query string and decode; ignore absolute URIs.
    let clean = pathname.split('?')[0];
    try {
      clean = decodeURIComponent(clean);
    } catch {
      return null;
    }
    const resolved = path.resolve(this.root, path.join(this.root, '.' + clean));
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      return null;
    }
    return resolved;
  }

  private sendFile(res: http.ServerResponse, filePath: string, status = 200): void {
    const ext = path.extname(filePath).toLowerCase();
    let data: Buffer;
    try {
      data = fs.readFileSync(filePath);
    } catch {
      sendJson(res, 500, { error: 'Internal Server Error' });
      return;
    }
    res.writeHead(status, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  }

  /**
   * Handle a request that no API route matched.
   * Returns true if a response was written.
   */
  public async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return true;
    }

    const pathname = req.url || '/';
    const resolved = this.resolveSafePath(pathname);
    if (!resolved) {
      sendJson(res, 403, { error: 'Forbidden' });
      return true;
    }

    let filePath = resolved;
    let stat: fs.Stats | null = null;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      stat = null;
    }

    if (stat?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        stat = null;
      }
    }

    if (!stat) {
      // SPA fallback: unknown non-asset paths serve index.html
      const ext = path.extname(pathname).toLowerCase();
      if (ext && ext !== '.html') {
        sendJson(res, 404, { error: 'Not Found' });
        return true;
      }
      const indexPath = this.resolveSafePath('/index.html');
      if (!indexPath || !fs.existsSync(indexPath)) {
        sendJson(res, 404, { error: 'Not Found' });
        return true;
      }
      this.sendFile(res, indexPath);
      return true;
    }

    this.sendFile(res, filePath);
    return true;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
