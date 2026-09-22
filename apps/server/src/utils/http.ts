import type * as http from 'node:http';
import type { ReadBodyOptions } from '../types/server.js';

/** Default maximum request body size (10MB) to protect against DoS / OOM attacks */
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;

/** Error thrown when incoming request body exceeds the maximum permitted size */
export class PayloadTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = 'PAYLOAD_TOO_LARGE';
  constructor(message = 'Payload Too Large: Request body exceeds maximum allowed size') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Auth-Token');
}

export function sendJsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  data: any,
  contentType = 'application/json',
): void {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

export function sendJsonError(
  res: http.ServerResponse,
  err: unknown,
  defaultStatusCode = 500,
  extraPayload?: Record<string, any>,
): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  const statusCode =
    typeof (err as any)?.statusCode === 'number' ? (err as any).statusCode : defaultStatusCode;
  const errorCode =
    typeof (err as any)?.code === 'string' ? (err as any).code : undefined;
  const errorMsg = err instanceof Error ? err.message : String(err);

  if (statusCode === 413) {
    res.setHeader('Connection', 'close');
  }

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      error: errorMsg,
      ...(errorCode ? { code: errorCode } : {}),
      ...(extraPayload || {}),
    }),
  );

  if (statusCode === 413) {
    res.on('finish', () => {
      try {
        res.destroy();
      } catch {}
    });
  }
}

export function readRequestBody(
  req: http.IncomingMessage,
  options?: ReadBodyOptions,
): Promise<Record<string, string>> {
  const maxBytes = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  // Early check via Content-Length header if present
  const contentLengthHeader = req.headers['content-length'];
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > maxBytes) {
      req.pause();
      req.resume(); // Discard incoming stream without buffering
      return Promise.reject(new PayloadTooLargeError());
    }
  }

  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;
    let limitExceeded = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.on('error', () => {});
    };

    const onData = (chunk: Buffer | string) => {
      if (limitExceeded) return;
      const chunkLen = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      receivedBytes += chunkLen;
      if (receivedBytes > maxBytes) {
        limitExceeded = true;
        cleanup();
        req.pause();
        req.resume(); // Discard further incoming data without buffering to prevent DoS/OOM
        reject(new PayloadTooLargeError());
        return;
      }
      body += chunk.toString();
    };

    const onEnd = () => {
      if (limitExceeded) return;
      cleanup();
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        const params = new URLSearchParams(body);
        const res: Record<string, string> = {};
        for (const [k, v] of params.entries()) {
          res[k] = v;
        }
        resolve(res);
      }
    };

    const onError = (err: Error) => {
      if (limitExceeded) return;
      cleanup();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

export function readJsonBody<T = any>(
  req: http.IncomingMessage,
  options?: ReadBodyOptions,
): Promise<T> {
  const maxBytes = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  // Early check via Content-Length header if present
  const contentLengthHeader = req.headers['content-length'];
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > maxBytes) {
      req.pause();
      req.resume(); // Discard incoming stream without buffering
      return Promise.reject(new PayloadTooLargeError());
    }
  }

  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;
    let limitExceeded = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.on('error', () => {});
    };

    const onData = (chunk: Buffer | string) => {
      if (limitExceeded) return;
      const chunkLen = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      receivedBytes += chunkLen;
      if (receivedBytes > maxBytes) {
        limitExceeded = true;
        cleanup();
        req.pause();
        req.resume(); // Discard further incoming data without buffering to prevent DoS/OOM
        reject(new PayloadTooLargeError());
        return;
      }
      body += chunk.toString();
    };

    const onEnd = () => {
      if (limitExceeded) return;
      cleanup();
      if (!body.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(body) as T);
      } catch (err) {
        reject(err);
      }
    };

    const onError = (err: Error) => {
      if (limitExceeded) return;
      cleanup();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}
