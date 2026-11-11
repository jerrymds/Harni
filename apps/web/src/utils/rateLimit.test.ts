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

  it('dynamically formats custom model and provider without hardcoded Gemini mentions', () => {
    const errorText = 'API Rate limit exceeded: 429 Too Many Requests';
    const parsed = parseClientRateLimit(errorText, 'gpt-4o', 'OpenAI');
    expect(parsed.isRateLimit).toBe(true);
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.provider).toBe('OpenAI');
    expect(parsed.formattedContent).toContain('串接模型 **gpt-4o** (OpenAI)');
    expect(parsed.formattedContent).not.toContain('Gemini');
    expect(parsed.formattedContent).not.toContain('Google AI Studio');
  });

  it('falls back to neutral model and provider names when not provided', () => {
    const errorText = '429 Too Many Requests';
    const parsed = parseClientRateLimit(errorText);
    expect(parsed.isRateLimit).toBe(true);
    expect(parsed.model).toBe('呼叫模型');
    expect(parsed.provider).toBe('AI 服務');
    expect(parsed.formattedContent).toContain('串接模型 **呼叫模型** (AI 服務)');
    expect(parsed.formattedContent).not.toContain('Gemini');
  });
});
