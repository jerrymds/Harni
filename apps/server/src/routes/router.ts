import type * as http from 'node:http';
import type { RequestContext, RouteHandler, ServerContext } from '../types/server.js';
import { extractAuthTokenFromRequest, timingSafeCompare } from '../utils/security.js';
import { sendJsonResponse, setCorsHeaders } from '../utils/http.js';

interface RouteDefinition {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: RouteDefinition[] = [];

  public add(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexSource = path
      .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');

    const pattern = new RegExp(`^${regexSource}$`);
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      paramNames,
      handler,
    });
  }

  public get(path: string, handler: RouteHandler): void {
    this.add('GET', path, handler);
  }

  public post(path: string, handler: RouteHandler): void {
    this.add('POST', path, handler);
  }

  public delete(path: string, handler: RouteHandler): void {
    this.add('DELETE', path, handler);
  }

  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: ServerContext,
    onNotFound?: () => Promise<boolean>,
  ): Promise<boolean> {
    // 1. Enable basic CORS headers
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = (req.method || 'GET').toUpperCase();

    // 2. Public OAuth redirect callbacks from 3rd-party auth providers (Google OAuth callback browser redirect)
    const isPublicOAuthCallback =
      (url.pathname === '/auth/google/callback' || url.pathname === '/api/auth/google/callback') &&
      req.method === 'GET';

    // 3. When authToken is configured, enforce authentication for all protected /api/* and /auth/* routes
    if (ctx.authToken && !isPublicOAuthCallback) {
      const isProtected = url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');
      if (isProtected) {
        const providedToken = extractAuthTokenFromRequest(req, url);
        if (!providedToken || !timingSafeCompare(providedToken, ctx.authToken)) {
          sendJsonResponse(res, 401, {
            error: 'Unauthorized: Missing or invalid authentication token',
            code: 'UNAUTHORIZED',
          });
          return true;
        }
      }
    }

    // 4. Match and dispatch to route
    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') {
        continue;
      }
      const match = url.pathname.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1] || '');
        });

        const rc: RequestContext = {
          req,
          res,
          url,
          params,
          ctx,
        };

        try {
          await route.handler(rc);
        } catch (err: unknown) {
          if (!res.headersSent && !res.writableEnded) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            sendJsonResponse(res, 500, { error: errorMsg });
          }
        }
        return true;
      }
    }

    // 5. No route matched
    if (onNotFound) {
      return onNotFound();
    }
    if (!res.headersSent && !res.writableEnded) {
      sendJsonResponse(res, 404, { error: 'Not Found' });
    }
    return false;
  }
}
