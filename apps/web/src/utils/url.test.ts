import { describe, it, expect } from 'vitest';
import { safeUrlTransform, redactUrlToken } from './url.js';

describe('url utilities', () => {
  it('redacts token and auth_token query parameters without altering host/path', () => {
    expect(redactUrlToken('ws://localhost:3001/ws?token=super_secret_123')).toBe(
      'ws://localhost:3001/ws?token=***',
    );
    expect(
      redactUrlToken('wss://example.com:3001/ws?foo=bar&auth_token=abc-xyz&baz=1'),
    ).toBe('wss://example.com:3001/ws?foo=bar&auth_token=***&baz=1');
    expect(redactUrlToken('ws://localhost:3001/ws')).toBe('ws://localhost:3001/ws');
  });

  it('sanitizes dangerous URI schemes including percent-encoded control chars', () => {
    expect(safeUrlTransform('javascript:alert(1)')).toBe('');
    expect(safeUrlTransform('java%09script:alert(1)')).toBe('');
    expect(safeUrlTransform('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrlTransform('https://example.com/docs?q=a%20b')).toBe(
      'https://example.com/docs?q=a%20b',
    );
  });
});
