import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { StaticFileService } from '../src/services/staticFileService.js';

function makeRequest(pathname: string, method = 'GET'): http.IncomingMessage {
  return {
    method,
    url: pathname,
    headers: { host: 'localhost' },
  } as unknown as http.IncomingMessage;
}

function makeResponse(): http.ServerResponse & { body: string; status: number; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    status: 200,
    writeHead(status: number, headers?: Record<string, string>) {
      res.status = status;
      Object.assign(res.headers, headers || {});
      return res;
    },
    end(data?: Buffer | string) {
      if (data) chunks.push(Buffer.from(data));
      res.body = Buffer.concat(chunks).toString('utf-8');
      res.writableEnded = true;
      return res;
    },
    write(chunk: Buffer | string) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    setHeader(_name: string, _value: string | number | string[]) {
      // no-op mock
    },
    getHeader(_name: string): undefined {
      return undefined;
    },
    removeHeader(_name: string) {
      // no-op mock
    },
    on() { return res; },
  };
  return res;
}

describe('StaticFileService', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'harni-static-'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<html>harni</html>');
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1);');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves index.html for the root path', async () => {
    const svc = new StaticFileService(root);
    const res = makeResponse();
    const handled = await svc.handle(makeRequest('/'), res);
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toBe('<html>harni</html>');
    expect(res.headers['Content-Type']).toContain('text/html');
  });

  it('serves nested assets with correct MIME type', async () => {
    const svc = new StaticFileService(root);
    const res = makeResponse();
    await svc.handle(makeRequest('/assets/app.js'), res);
    expect(res.status).toBe(200);
    expect(res.body).toBe('console.log(1);');
    expect(res.headers['Content-Type']).toContain('text/javascript');
  });

  it('blocks path traversal attempts', async () => {
    const svc = new StaticFileService(root);
    const res = makeResponse();
    await svc.handle(makeRequest('/../secret.txt'), res);
    expect(res.status).toBe(403);
  });

  it('blocks encoded path traversal attempts', async () => {
    const svc = new StaticFileService(root);
    const res = makeResponse();
    await svc.handle(makeRequest('/%2e%2e/secret.txt'), res);
    expect(res.status).toBe(403);
  });

  it('falls back to index.html for SPA routes', async () => {
    const svc = new StaticFileService(root);
    const res = makeResponse();
    await svc.handle(makeRequest('/settings/profile'), res);
    expect(res.status).toBe(200);
    expect(res.body).toBe('<html>harni</html>');
  });

  it('returns 404 for missing asset-like extensions', async () => {
    const svc = new StaticFileService(root);
    const res = makeResponse();
    await svc.handle(makeRequest('/missing.png'), res);
    expect(res.status).toBe(404);
  });

  it('rejects non-GET methods', async () => {
    const svc = new StaticFileService(root);
    const res = makeResponse();
    await svc.handle(makeRequest('/', 'POST'), res);
    expect(res.status).toBe(405);
  });

  it('resolveSafePath keeps paths inside root', () => {
    const svc = new StaticFileService(root);
    expect(svc.resolveSafePath('/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(svc.resolveSafePath('/..%2f..%2fetc')).toBeNull();
    expect(svc.resolveSafePath('/../../etc/passwd')).toBeNull();
  });

  it('serves index.html for the root path through the router fallback', async () => {
    const { Router } = await import('../src/routes/router.js');
    const router = new Router();
    const svc = new StaticFileService(root);
    const res = makeResponse();
    const req = makeRequest('/');
    const handled = await router.handle(req, res, {} as any, () => svc.handle(req, res));
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toBe('<html>harni</html>');
  });

  it('router without fallback still returns JSON 404', async () => {
    const { Router } = await import('../src/routes/router.js');
    const router = new Router();
    const res = makeResponse();
    const handled = await router.handle(makeRequest('/nope.png'), res, {} as any);
    expect(handled).toBe(false);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Not Found');
  });
});
