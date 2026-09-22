import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/server.js';
import { SecurityService, LEGACY_DEFAULT_SALT } from '../src/services/securityService.js';
import { GoogleAuthPage, escapeHtml, serializeJsonForScript } from '../src/services/googleAuthPage.js';

describe('SecurityService, Vault & Authentication', () => {
  const tempDir = path.resolve('temp_server_test_security');
  let app: any;
  let port: number;

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    app = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath: path.join(tempDir, 'cline-test.db'),
    });
    port = await app.start();
  });

  afterAll(async () => {
    if (app) await app.stop();
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Ignore EBUSY on Windows if file handle release is asynchronous
    }
  });

  it('encrypts, decrypts, masks keys and detects tampering', () => {
    const security = new SecurityService();
    const sampleKey = 'sk-cline-sec-key-test-1234567890abcdef';
    const encrypted = security.encrypt(sampleKey);

    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(encrypted.includes('1234567890abcdef')).toBe(false);

    const decrypted = security.decrypt(encrypted);
    expect(decrypted).toBe(sampleKey);

    const masked = security.maskApiKey(sampleKey);
    expect(masked).toBe('sk-••••••••cdef');

    // Tamper detection
    const parts = encrypted.split(':');
    parts[4] = (parts[4] || '').slice(0, -2) + 'ff';
    expect(() => security.decrypt(parts.join(':'))).toThrow();
  });

  it('generates random salt and key file in keyDir with persistence', async () => {
    const testKeyDir = path.join(tempDir, 'sec_test_keys');
    await fs.mkdir(testKeyDir, { recursive: true });
    const secWithCustomDir = new SecurityService({ keyDir: testKeyDir });
    const keyFilePath = path.join(testKeyDir, '.master.key');

    const keyFileExists = await fs.access(keyFilePath).then(() => true).catch(() => false);
    expect(keyFileExists).toBe(true);

    const keyFileContent = await fs.readFile(keyFilePath, 'utf8');
    const parsedKeyFile = JSON.parse(keyFileContent);

    expect(typeof parsedKeyFile.key).toBe('string');
    expect(parsedKeyFile.key.length).toBe(64);
    expect(typeof parsedKeyFile.salt).toBe('string');
    expect(parsedKeyFile.salt.length).toBe(32);
    expect(parsedKeyFile.version).toBe(1);

    const secWithSameDir = new SecurityService({ keyDir: testKeyDir });
    const encryptedWithCustomDir = secWithCustomDir.encrypt('test-secret-payload-abc');
    const decryptedWithSameDir = secWithSameDir.decrypt(encryptedWithCustomDir);
    expect(decryptedWithSameDir).toBe('test-secret-payload-abc');
  });

  it('isolates keys with different salts', () => {
    const secWithSalt1 = new SecurityService({ masterKey: 'same-master-secret', salt: '11112222333344445555666677778888' });
    const secWithSalt2 = new SecurityService({ masterKey: 'same-master-secret', salt: 'aaaabbbbccccddddeeeeffff00001111' });
    const enc1 = secWithSalt1.encrypt('secret');

    expect(() => secWithSalt2.decrypt(enc1)).toThrow();
  });

  it('supports legacy plain text .master.key with LEGACY_DEFAULT_SALT', async () => {
    const legacyKeyDir = path.join(tempDir, 'legacy_sec_keys');
    await fs.mkdir(legacyKeyDir, { recursive: true });
    const legacyRawKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    await fs.writeFile(path.join(legacyKeyDir, '.master.key'), legacyRawKey, 'utf8');

    const secLegacy = new SecurityService({ keyDir: legacyKeyDir });
    const legacyResolved = secLegacy.resolveMasterKeyAndSalt(legacyKeyDir);
    expect(legacyResolved.key).toBe(legacyRawKey);
    expect(legacyResolved.salt.equals(LEGACY_DEFAULT_SALT)).toBe(true);
  });

  it('manages Google OAuth credentials and callback flow', async () => {
    const customClientId = '123456789-test.apps.googleusercontent.com';
    const customClientSecret = 'GOCSPX-secret123';

    const configRes = await fetch(`http://localhost:${port}/api/auth/google/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: customClientId, clientSecret: customClientSecret }),
    });
    const configJson = (await configRes.json()) as any;
    expect(configRes.ok).toBe(true);
    expect(configJson.success).toBe(true);

    const googleLoginRes = await fetch(`http://localhost:${port}/auth/google/login`, { redirect: 'manual' });
    const location = googleLoginRes.headers.get('location') || '';
    expect(googleLoginRes.status).toBe(302);
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(location.includes(encodeURIComponent(customClientId))).toBe(true);
    expect(location.includes(customClientSecret)).toBe(false);

    const googleCallbackRes = await fetch(`http://localhost:${port}/auth/google/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=developer%40google.com&name=Google+Antigravity+Developer',
    });
    const googleCallbackHtml = await googleCallbackRes.text();
    expect(googleCallbackRes.ok).toBe(true);
    expect(googleCallbackHtml).toContain('Google 官方帳號認證成功');
    expect(googleCallbackHtml).not.toContain(customClientSecret);

    const googleStatusRes = await fetch(`http://localhost:${port}/api/auth/google/status`);
    const googleStatusJson = (await googleStatusRes.json()) as any;
    expect(googleStatusRes.ok).toBe(true);
    expect(googleStatusJson.authenticated).toBe(true);
    expect(googleStatusJson.email).toBe('developer@google.com');

    const deleteAuthRes = await fetch(`http://localhost:${port}/api/auth/google`, { method: 'DELETE' });
    const deleteAuthJson = (await deleteAuthRes.json()) as any;
    expect(deleteAuthRes.ok).toBe(true);
    expect(deleteAuthJson.authenticated).toBe(false);
  });

  it('protects against XSS injection in GoogleAuthPage and callback endpoints', async () => {
    // 1. Test escapeHtml
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml('"hello" & \'world\' <script>')).toBe('&quot;hello&quot; &amp; &#39;world&#39; &lt;script&gt;');
    expect(escapeHtml('')).toBe('');

    // 2. Test serializeJsonForScript
    const maliciousObject = {
      name: '</script><script>alert("pwned")//',
      email: '<b onmouseover=alert(1)>test@evil.com</b>',
      origin: 'http://localhost:3000',
    };
    const serialized = serializeJsonForScript(maliciousObject);
    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<script>');
    expect(serialized).toContain('\\u003c/script\\u003e');
    expect(serialized).toContain('\\u003cscript\\u003e');
    // Verify it deserializes back to original values in JS
    expect(JSON.parse(serialized)).toEqual(maliciousObject);

    // 3. Test renderCallbackPage with XSS injection payload
    const callbackHtml = GoogleAuthPage.renderCallbackPage({
      email: '<img src=x onerror=alert("xss")>',
      name: '</script><script>alert("xss2")//',
      authenticatedAt: 1234567890,
    });
    // In HTML body:
    expect(callbackHtml).not.toContain('<img src=x onerror=alert("xss")>');
    expect(callbackHtml).toContain('&lt;img src=x onerror=alert(&quot;xss&quot;)&gt;');
    // In <script> tag:
    expect(callbackHtml).not.toContain('</script><script>alert("xss2")//');
    expect(callbackHtml).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(\\"xss2\\")//');

    // 4. Test renderOAuthRedirectPage
    const redirectHtml = GoogleAuthPage.renderOAuthRedirectPage('https://accounts.google.com/oauth?"onload="alert(1)');
    expect(redirectHtml).not.toContain('"onload="alert(1)"');
    expect(redirectHtml).toContain('&quot;onload=&quot;alert(1)');

    // 5. Test HTTP callback endpoint with malicious params
    const maliciousCallbackRes = await fetch(`http://localhost:${port}/auth/google/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=%3Cimg+onerror%3Dalert(1)%3E&name=%3C%2Fscript%3E%3Cscript%3Ealert(2)%3C%2Fscript%3E',
    });
    const maliciousHtml = await maliciousCallbackRes.text();
    expect(maliciousCallbackRes.ok).toBe(true);
    expect(maliciousHtml).not.toContain('<img onerror=alert(1)>');
    expect(maliciousHtml).toContain('&lt;img onerror=alert(1)&gt;');
    expect(maliciousHtml).not.toContain('</script><script>alert(2)');
  });

  it('validates Claude and OpenAI OAuth endpoints', async () => {
    const claudeLoginRes = await fetch(`http://localhost:${port}/auth/anthropic/login?format=json`);
    const claudeLoginJson = (await claudeLoginRes.json()) as any;
    expect(claudeLoginRes.ok).toBe(true);
    expect(claudeLoginJson.url).toContain('https://claude.ai/oauth/authorize');

    const claudeBadExchangeRes = await fetch(`http://localhost:${port}/api/auth/anthropic/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'bogus#nostate' }),
    });
    expect(claudeBadExchangeRes.status).toBe(400);

    const openaiStatusBefore = await fetch(`http://localhost:${port}/api/auth/openai/status`);
    const openaiStatusBeforeJson = (await openaiStatusBefore.json()) as any;
    expect(openaiStatusBeforeJson.authenticated).toBe(false);
  });

  it('enforces 127.0.0.1 binding security and auth token protections', async () => {
    expect(() => {
      createApp({
        port: 0,
        host: '0.0.0.0',
        workspaceRoot: tempDir,
        dbPath: path.join(tempDir, 'cline-sec-test.db'),
      });
    }).toThrow(/Security Prohibited.*AUTH_TOKEN/);

    const secureToken = 'test-secret-auth-token-987654321';
    const authApp = createApp({
      port: 0,
      host: '0.0.0.0',
      authToken: secureToken,
      workspaceRoot: tempDir,
      dbPath: path.join(tempDir, 'cline-sec-auth.db'),
    });
    const authPort = await authApp.start();

    try {
      const authHealthRes = await fetch(`http://127.0.0.1:${authPort}/health`);
      const authHealthJson = (await authHealthRes.json()) as any;
      expect(authHealthJson.authRequired).toBe(true);

      const unauthRes = await fetch(`http://127.0.0.1:${authPort}/api/workspace`);
      expect(unauthRes.status).toBe(401);

      const bearerRes = await fetch(`http://127.0.0.1:${authPort}/api/workspace`, {
        headers: { Authorization: `Bearer ${secureToken}` },
      });
      expect(bearerRes.ok).toBe(true);

      const xApiKeyRes = await fetch(`http://127.0.0.1:${authPort}/api/workspace`, {
        headers: { 'X-API-Key': secureToken },
      });
      expect(xApiKeyRes.ok).toBe(true);

      let wsAuthSuccess = false;
      const authWs = new WebSocket(`ws://127.0.0.1:${authPort}/ws?token=${secureToken}`);
      await new Promise<void>((resolve, reject) => {
        authWs.on('open', () => {
          wsAuthSuccess = true;
          resolve();
        });
        authWs.on('error', (err) => reject(err));
      });
      expect(wsAuthSuccess).toBe(true);
      authWs.close();
    } finally {
      await authApp.stop();
    }
  });
});
