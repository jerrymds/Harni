import { describe, it, expect } from 'vitest';
import { isRateLimitError, parseRateLimitError } from '../src/utils/rateLimit.js';

describe('RateLimit Utility (agent-core)', () => {
  it('detects standard HTTP 429 and RESOURCE_EXHAUSTED errors', () => {
    expect(isRateLimitError('Antigravity Bridge Error (429): Resource exhausted')).toBe(true);
    expect(isRateLimitError('[Vertex AI Error 429]: Quota exceeded for model')).toBe(true);
    expect(isRateLimitError('RESOURCE_EXHAUSTED: rate limit exceeded')).toBe(true);
    expect(isRateLimitError('random file not found error')).toBe(false);
  });

  it('detects and parses TPM (Tokens per minute) quota exceedance', () => {
    const errorText =
      'Quota exceeded for quota metric Generative Language API - Tokens per minute and limit TokensPerMinutePerProjectPerUser. retryDelay: 25s';
    expect(isRateLimitError(errorText)).toBe(true);

    const parsed = parseRateLimitError(errorText, 'gemini-3.8-pro', 'Google Gemini');
    expect(parsed.isRateLimit).toBe(true);
    expect(parsed.limitType).toBe('TPM');
    expect(parsed.retryAfter).toBe('25s');
    expect(parsed.model).toBe('gemini-3.8-pro');
    expect(parsed.formattedMessage).toContain('TPM 超標');
    expect(parsed.formattedMessage).toContain('gemini-3.8-flash');
    expect(parsed.formattedMessage).toContain('25s');
  });

  it('detects and parses RPM (Requests per minute) quota exceedance', () => {
    const errorText =
      '[Google Gemini Rate Limit 429] 模型 gemini-3.7-flash 觸發頻率配額限制：【RPM 超標 (每分鐘請求數)】Quota exceeded for Requests per minute. 建議等待時間：15s';
    expect(isRateLimitError(errorText)).toBe(true);

    const parsed = parseRateLimitError(errorText, 'gemini-3.7-flash', 'antigravity');
    expect(parsed.isRateLimit).toBe(true);
    expect(parsed.limitType).toBe('RPM');
    expect(parsed.retryAfter).toBe('15s');
    expect(parsed.formattedMessage).toContain('RPM 超標');
  });

  it('detects and parses 5-hour rolling quota exhaust', () => {
    const errorText = 'API 額度已達 5 小時上限 (5 hours rolling window limit reached). Please wait.';
    expect(isRateLimitError(errorText)).toBe(true);

    const parsed = parseRateLimitError(errorText, 'gemini-3.8-flash');
    expect(parsed.isRateLimit).toBe(true);
    expect(parsed.limitType).toBe('QUOTA');
    expect(parsed.formattedMessage).toContain('5 小時動態滾動額度用罄');
  });
});
