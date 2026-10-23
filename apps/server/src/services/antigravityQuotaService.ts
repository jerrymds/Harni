import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgyBinaryResolver } from '@harni/agent-core';
import type { ModelQuotaItem, ModelQuotaPool, ModelQuotaResponse } from '@harni/types';

const execFileAsync = promisify(execFile);

interface QuotaCache {
  response: ModelQuotaResponse;
  cachedAt: number;
}

export class AntigravityQuotaService {
  private static instance: AntigravityQuotaService | null = null;
  private cache: QuotaCache | null = null;
  private readonly cacheTtlMs = 60_000; // 60 seconds TTL

  public static getInstance(): AntigravityQuotaService {
    if (!AntigravityQuotaService.instance) {
      AntigravityQuotaService.instance = new AntigravityQuotaService();
    }
    return AntigravityQuotaService.instance;
  }

  /**
   * Format ISO date string into human friendly localized string & relative time
   */
  public static formatResetTime(isoString?: string): string | undefined {
    if (!isoString) return undefined;
    try {
      const resetDate = new Date(isoString);
      if (isNaN(resetDate.getTime())) return isoString;

      const now = new Date();
      const diffMs = resetDate.getTime() - now.getTime();

      let relativeText = '';
      if (diffMs <= 0) {
        relativeText = '即將重置';
      } else {
        const diffMinutes = Math.floor(diffMs / 60_000);
        const hours = Math.floor(diffMinutes / 60);
        const minutes = diffMinutes % 60;
        const days = Math.floor(hours / 24);

        if (days > 0) {
          relativeText = `約 ${days} 天 ${hours % 24} 小時後`;
        } else if (hours > 0) {
          relativeText = `約 ${hours} 小時 ${minutes} 分後`;
        } else {
          relativeText = `約 ${minutes} 分鐘後`;
        }
      }

      // Format time: e.g. 10/23 14:29
      const month = String(resetDate.getMonth() + 1).padStart(2, '0');
      const date = String(resetDate.getDate()).padStart(2, '0');
      const hoursStr = String(resetDate.getHours()).padStart(2, '0');
      const minutesStr = String(resetDate.getMinutes()).padStart(2, '0');
      const formattedDate = `${month}/${date} ${hoursStr}:${minutesStr}`;

      return `${formattedDate} (${relativeText})`;
    } catch {
      return isoString;
    }
  }

  /**
   * Parse tab-separated or whitespace-separated lines output from `agy -p /usage`
   */
  public static parseAgyUsageOutput(rawText: string): ModelQuotaPool[] {
    const poolsMap = new Map<string, ModelQuotaPool>();

    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // Split by tab first, fallback to double space
      const parts = line.includes('\t')
        ? line.split('\t').map((p) => p.trim())
        : line.split(/\s{2,}/).map((p) => p.trim());

      if (parts.length < 3) continue;

      const rawPool = parts[0];
      const rawLimit = parts[1];
      const rawPercent = parts[2];
      const rawReset = parts[3] || undefined;

      const percent = parseInt(rawPercent.replace('%', ''), 10);
      if (isNaN(percent)) continue;

      let limitType: 'five_hour' | 'weekly' | 'custom' = 'custom';
      let friendlyLimitName = rawLimit;

      const lowerLimit = rawLimit.toLowerCase();
      if (lowerLimit.includes('five hour') || lowerLimit.includes('5 hour') || lowerLimit.includes('5-hour') || lowerLimit.includes('5hr')) {
        limitType = 'five_hour';
        friendlyLimitName = '5 小時滾動限制 (Five-Hour Limit)';
      } else if (lowerLimit.includes('weekly')) {
        limitType = 'weekly';
        friendlyLimitName = '每週累計上限 (Weekly Limit)';
      }

      const poolKey = rawPool.toLowerCase();
      let pool = poolsMap.get(poolKey);

      if (!pool) {
        let poolId = poolKey.replace(/\s+/g, '-');
        let poolName = rawPool;
        let poolDesc = '';
        let isShared = false;

        if (poolKey.includes('gemini') && !poolKey.includes('argon')) {
          poolId = 'gemini-models';
          poolName = 'Gemini 官方共享額度池 (Gemini Models)';
          poolDesc = 'Gemini 3.8 / 3.7 / 2.5 系列模型共享此運算配額，依任務複雜度折算';
          isShared = true;
        } else if (poolKey.includes('claude') || poolKey.includes('gpt')) {
          poolId = 'claude-gpt-models';
          poolName = 'Claude & GPT 第三方模型額度池';
          poolDesc = 'Anthropic Claude 與 OpenAI 模型外部配額';
          isShared = false;
        } else if (poolKey.includes('argon')) {
          poolId = 'gemini-4-argon';
          poolName = 'Gemini 4 Argon 專屬配額';
          poolDesc = '次世代旗艦推理模型獨立配額';
          isShared = false;
        }

        pool = {
          id: poolId,
          name: poolName,
          description: poolDesc,
          isShared,
          items: [],
        };
        poolsMap.set(poolKey, pool);
      }

      const item: ModelQuotaItem = {
        name: friendlyLimitName,
        limitType,
        remainingPercent: Math.max(0, Math.min(100, percent)),
        resetTime: rawReset,
        resetTimeFormatted: AntigravityQuotaService.formatResetTime(rawReset),
      };

      pool.items.push(item);
    }

    // Sort items within each pool: five_hour first, then weekly, then custom
    for (const pool of poolsMap.values()) {
      pool.items.sort((a, b) => {
        const order = { five_hour: 0, weekly: 1, custom: 2 };
        return order[a.limitType] - order[b.limitType];
      });
    }

    // Ensure Gemini Models pool appears first
    return Array.from(poolsMap.values()).sort((a, b) => {
      if (a.id === 'gemini-models') return -1;
      if (b.id === 'gemini-models') return 1;
      return 0;
    });
  }

  /**
   * Return default baseline quota structure if CLI is unavailable
   */
  public static getDefaultFallbackPools(): ModelQuotaPool[] {
    return [
      {
        id: 'gemini-models',
        name: 'Gemini 官方共享額度池 (Gemini Models)',
        description: 'Gemini 3.8 / 3.7 / 2.5 系列模型共享此運算配額，依任務複雜度折算',
        isShared: true,
        items: [
          {
            name: '5 小時滾動限制 (Five-Hour Limit)',
            limitType: 'five_hour',
            remainingPercent: 100,
            resetTimeFormatted: '正常動態滑動重置',
          },
          {
            name: '每週累計上限 (Weekly Limit)',
            limitType: 'weekly',
            remainingPercent: 100,
            resetTimeFormatted: '每週週期循環',
          },
        ],
      },
    ];
  }

  /**
   * Fetch live quota status for Antigravity
   */
  public async getQuota(forceRefresh = false): Promise<ModelQuotaResponse> {
    const now = Date.now();

    // Check memory cache
    if (!forceRefresh && this.cache && now - this.cache.cachedAt < this.cacheTtlMs) {
      return this.cache.response;
    }

    try {
      const binary = await AgyBinaryResolver.resolve();
      const { stdout } = await execFileAsync(binary, ['-p', '/usage'], {
        timeout: 15_000,
        windowsHide: true,
      });

      const pools = AntigravityQuotaService.parseAgyUsageOutput(stdout);

      const response: ModelQuotaResponse = {
        provider: 'antigravity',
        updatedAt: now,
        pools: pools.length > 0 ? pools : AntigravityQuotaService.getDefaultFallbackPools(),
      };

      this.cache = { response, cachedAt: now };
      return response;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.warn('[AntigravityQuotaService] Failed to query agy /usage:', errorMsg);

      // If we have previous cache, return it with error note
      if (this.cache) {
        return {
          ...this.cache.response,
          error: `更新配額逾時或發生錯誤，顯示前次快取紀錄：${errorMsg}`,
        };
      }

      const fallbackResponse: ModelQuotaResponse = {
        provider: 'antigravity',
        updatedAt: now,
        pools: AntigravityQuotaService.getDefaultFallbackPools(),
        error: `無法透過 Antigravity CLI 讀取即時配額 (${errorMsg})，已切換至預估基準狀態。`,
      };

      return fallbackResponse;
    }
  }
}
