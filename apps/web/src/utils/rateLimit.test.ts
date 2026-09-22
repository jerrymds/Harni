import { describe, it, expect } from 'vitest';
import { isRateLimitError, parseClientRateLimit } from './rateLimit.js';

describe('Web RateLimit Utility', () => {
  it('identifies rate limit errors by error message or code', () => {
    expect(isRateLimitError('Some message', 'RATE_LIMIT_ERROR')).toBe(true);
    expect(isRateLimitError('Google Gemini API Error (429): Quota exceeded')).toBe(true);
    expect(isRateLimitError('SyntaxError: unexpected token')).toBe(false);
  });

  it('correctly parses TPM exceedance details', () => {
    const errorText =
      '觸發頻率配額限制：【TPM 超標 (每分鐘 Token 數)】Quota exceeded. 建議等待時間：30s';
    const parsed = parseClientRateLimit(errorText, 'gemini-3.8-flash');
    expect(parsed.isRateLimit).toBe(true);
    expect(parsed.limitType).toBe('TPM');
    expect(parsed.retryAfter).toBe('30s');
    expect(parsed.formattedContent).toContain('TPM 超標');
    expect(parsed.formattedContent).toContain('30s');
  });

  it('correctly parses RPM exceedance details', () => {
    const errorText = 'Requests per minute quota exceeded for Gemini. retryDelay: 12s';
    const parsed = parseClientRateLimit(errorText, 'gemini-3.7-flash');
    expect(parsed.isRateLimit).toBe(true);
    expect(parsed.limitType).toBe('RPM');
    expect(parsed.retryAfter).toBe('12s');
    expect(parsed.formattedContent).toContain('RPM 超標');
  });
});
