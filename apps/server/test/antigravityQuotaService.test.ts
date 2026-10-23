import { describe, it, expect } from 'vitest';
import { AntigravityQuotaService } from '../src/services/antigravityQuotaService.js';

describe('AntigravityQuotaService', () => {
  it('parses real agy /usage tab-separated output correctly', () => {
    const rawOutput = `
Gemini Models\tWeekly Limit Remaining\t72%\t2026-10-24T01:15:12Z
Gemini Models\tFive Hour Limit Remaining\t97%\t2026-10-23T06:29:30Z
Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-30T01:33:24Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-10-23T06:33:24Z
Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t46%\t2026-10-24T01:37:03Z
`;

    const pools = AntigravityQuotaService.parseAgyUsageOutput(rawOutput);

    expect(pools).toHaveLength(3);

    // Gemini Models should be first
    const geminiPool = pools.find((p) => p.id === 'gemini-models');
    expect(geminiPool).toBeDefined();
    expect(geminiPool?.isShared).toBe(true);
    expect(geminiPool?.name).toContain('Gemini 官方共享額度池');
    expect(geminiPool?.items).toHaveLength(2);

    const fiveHourItem = geminiPool?.items.find((i) => i.limitType === 'five_hour');
    expect(fiveHourItem?.remainingPercent).toBe(97);
    expect(fiveHourItem?.resetTimeFormatted).toBeDefined();

    const weeklyItem = geminiPool?.items.find((i) => i.limitType === 'weekly');
    expect(weeklyItem?.remainingPercent).toBe(72);

    // Claude and GPT models
    const claudePool = pools.find((p) => p.id === 'claude-gpt-models');
    expect(claudePool).toBeDefined();
    expect(claudePool?.items[0].remainingPercent).toBe(100);

    // Argon pool
    const argonPool = pools.find((p) => p.id === 'gemini-4-argon');
    expect(argonPool).toBeDefined();
    expect(argonPool?.items[0].remainingPercent).toBe(46);
  });

  it('formats reset times into human readable strings with relative countdown', () => {
    const futureDate = new Date(Date.now() + 2 * 3600 * 1000 + 15 * 60 * 1000).toISOString();
    const formatted = AntigravityQuotaService.formatResetTime(futureDate);
    expect(formatted).toBeDefined();
    expect(formatted).toContain('小時');
  });

  it('provides sensible fallback pools when offline', () => {
    const fallback = AntigravityQuotaService.getDefaultFallbackPools();
    expect(fallback).toHaveLength(1);
    expect(fallback[0].id).toBe('gemini-models');
    expect(fallback[0].items[0].remainingPercent).toBe(100);
  });
});
