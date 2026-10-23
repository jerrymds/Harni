import React, { useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { ModelQuotaItem, ModelQuotaPool } from '@harni/types';
import { useAgentStore, useShallow } from '../../../store/useAgentStore.js';

export const AntigravityQuotaPool: React.FC = () => {
  const { quotaInfo, isLoadingQuota, fetchModelQuota } = useAgentStore(
    useShallow((s) => ({
      quotaInfo: s.quotaInfo,
      isLoadingQuota: s.isLoadingQuota,
      fetchModelQuota: s.fetchModelQuota,
    })),
  );

  useEffect(() => {
    // Automatically load quota if not already fetched
    if (!quotaInfo && !isLoadingQuota) {
      fetchModelQuota('antigravity');
    }
  }, [quotaInfo, isLoadingQuota, fetchModelQuota]);

  const handleRefresh = (e: React.MouseEvent) => {
    e.preventDefault();
    fetchModelQuota('antigravity', true);
  };

  const pools: ModelQuotaPool[] = quotaInfo?.pools || [];
  const geminiPool = pools.find((p) => p.id === 'gemini-models' || p.isShared) || pools[0];
  const otherPools = pools.filter((p) => p !== geminiPool);

  // Compute overall health status from the primary pool
  const minPercent = geminiPool?.items?.length
    ? Math.min(...geminiPool.items.map((i) => i.remainingPercent))
    : 100;

  const getStatusBadge = () => {
    if (minPercent <= 15) {
      return (
        <span className="inline-flex items-center space-x-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">
          <AlertCircle className="h-3 w-3 text-rose-500" />
          <span>額度即將耗盡</span>
        </span>
      );
    }
    if (minPercent <= 50) {
      return (
        <span className="inline-flex items-center space-x-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          <span>配額注意 ({minPercent}%)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        <span>額度充足 ({minPercent}%)</span>
      </span>
    );
  };

  const getBarColor = (percent: number) => {
    if (percent <= 20) return 'from-rose-500 to-red-500';
    if (percent <= 50) return 'from-amber-500 to-orange-400';
    return 'from-emerald-500 to-teal-400';
  };

  const getPercentBadgeColor = (percent: number) => {
    if (percent <= 20) return 'bg-rose-50 text-rose-700 border-rose-200';
    if (percent <= 50) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const renderQuotaItem = (item: ModelQuotaItem, idx: number) => {
    const isFiveHour = item.limitType === 'five_hour';

    return (
      <div key={idx} className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-1.5 font-medium text-slate-700">
            <span className="text-slate-400">
              {isFiveHour ? '⏱️' : '📅'}
            </span>
            <span>{item.name}</span>
          </div>
          <span
            className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded-md border ${getPercentBadgeColor(
              item.remainingPercent,
            )}`}
          >
            {item.remainingPercent}% 剩餘
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200/50 shadow-inner">
          <div
            className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out ${getBarColor(
              item.remainingPercent,
            )}`}
            style={{ width: `${Math.max(4, Math.min(100, item.remainingPercent))}%` }}
          />
        </div>

        {/* Reset Time Note */}
        {item.resetTimeFormatted && (
          <div className="flex items-center space-x-1 text-[10.5px] text-slate-500 pl-0.5">
            <Clock className="h-3 w-3 text-slate-400 shrink-0" />
            <span>重置時間：{item.resetTimeFormatted}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-ag-border bg-gradient-to-br from-ag-panel via-ag-panel to-blue-50/20 p-4 space-y-3.5 shadow-soft">
      {/* 1. Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-ag-border/60 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 via-blue-500/15 to-purple-500/10 border border-blue-200/60 text-blue-600 shadow-xs">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-900">模型額度池 (Model Quota Pool)</span>
              <span className="rounded-full bg-blue-100/70 border border-blue-200 px-2 py-0.2 font-mono text-[9.5px] font-medium text-blue-700">
                Antigravity 官方同步
              </span>
            </div>
            <p className="text-[10.5px] text-slate-500">
              即時追蹤 Google Antigravity 帳號的 5 小時動態滾動額度與每週累計配額
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end sm:self-auto shrink-0">
          {getStatusBadge()}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoadingQuota}
            title="重新查詢 Antigravity 即時額度"
            className="flex items-center space-x-1 rounded-xl border border-ag-border bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 cursor-pointer shadow-xs transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoadingQuota ? 'animate-spin text-ag-blue' : ''}`} />
            <span>{isLoadingQuota ? '查詢中...' : '重新整理'}</span>
          </button>
        </div>
      </div>

      {/* 2. Primary Gemini Models Shared Quota Pool */}
      {geminiPool && (
        <div className="rounded-xl border border-blue-100/90 bg-white/95 p-3.5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="font-semibold text-xs text-slate-900 truncate">
                {geminiPool.name}
              </span>
            </div>
            <span className="shrink-0 inline-flex items-center space-x-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[9.5px] font-semibold text-blue-700">
              <span>⚡ Flash & Pro 共享運算</span>
            </span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            {geminiPool.description ||
              'Gemini 3.8 / 3.7 / 2.5 系列模型統一依計算複雜度折算，共用滑動重置額度。'}
          </p>

          <div className="space-y-3 pt-1">
            {geminiPool.items.map((item, idx) => renderQuotaItem(item, idx))}
          </div>
        </div>
      )}

      {/* 3. Secondary Quota Pools (Claude/GPT, Argon, etc.) */}
      {otherPools.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {otherPools.map((pool) => (
            <div
              key={pool.id}
              className="rounded-xl border border-ag-border bg-white/80 p-3 space-y-2.5 shadow-xs"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-semibold text-xs text-slate-800 truncate">
                  {pool.name}
                </span>
                {pool.isShared && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] text-slate-600 font-medium">
                    共享
                  </span>
                )}
              </div>
              {pool.description && (
                <p className="text-[10.5px] text-slate-500 truncate">{pool.description}</p>
              )}
              <div className="space-y-2.5 pt-1">
                {pool.items.map((item, idx) => renderQuotaItem(item, idx))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Error or Warning Notice if any */}
      {quotaInfo?.error && (
        <div className="flex items-start space-x-2 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] text-amber-800">
          <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <span>{quotaInfo.error}</span>
        </div>
      )}

      {/* 5. Antigravity Quota Usage Tips & Timestamp */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pt-1 text-[10.5px] text-slate-400">
        <div className="flex items-center space-x-1.5">
          <Info className="h-3 w-3 text-blue-500 shrink-0" />
          <span>
            提示：高上下文與深度思考會加速額度消耗；5 小時滾動窗口將隨時間自然向前滑動補充。
          </span>
        </div>
        {quotaInfo?.updatedAt && (
          <span className="shrink-0 font-mono text-[10px] text-slate-400">
            最後同步: {new Date(quotaInfo.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
};
