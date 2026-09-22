import type { RateLimitInfo } from '@harni/types';

/**
 * 判斷錯誤訊息或代碼是否屬於 API 頻率限制 (429 / TPM / RPM / Quota)
 */
export function isRateLimitError(errorMsg?: string, code?: string): boolean {
  if (code === 'RATE_LIMIT_ERROR') return true;
  if (!errorMsg || typeof errorMsg !== 'string') return false;
  const lower = errorMsg.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('ratelimit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota exceeded') ||
    lower.includes('quotafailure') ||
    lower.includes('quota_exceeded') ||
    lower.includes('requests per minute') ||
    lower.includes('tokens per minute') ||
    lower.includes('requests per day') ||
    lower.includes('tpm 超標') ||
    lower.includes('rpm 超標') ||
    lower.includes('頻率限制') ||
    lower.includes('5 小時') ||
    lower.includes('5 hours') ||
    lower.includes('rolling window')
  );
}

/**
 * 解析客戶端接收到的頻率限制錯誤詳細資訊
 */
export function parseClientRateLimit(
  errorMsg: string,
  model?: string,
  provider?: string,
): RateLimitInfo & { formattedContent: string } {
  const targetModel = model || 'Gemini';
  const targetProvider = provider || 'Google Gemini';
  const lower = (errorMsg || '').toLowerCase();

  let limitType: RateLimitInfo['limitType'] = 'RATE_LIMIT';
  let limitTypeLabel = 'API 頻率限制 (Rate Limit)';

  if (
    lower.includes('tokens per minute') ||
    lower.includes('tokensperminute') ||
    lower.includes('tpm')
  ) {
    limitType = 'TPM';
    limitTypeLabel = 'TPM 超標 (Tokens per minute 每分鐘 Token 數超額)';
  } else if (
    lower.includes('requests per minute') ||
    lower.includes('requestsperminute') ||
    lower.includes('rpm')
  ) {
    limitType = 'RPM';
    limitTypeLabel = 'RPM 超標 (Requests per minute 每分鐘請求數超額)';
  } else if (
    lower.includes('requests per day') ||
    lower.includes('requestsperday') ||
    lower.includes('rpd') ||
    lower.includes('daily')
  ) {
    limitType = 'RPD';
    limitTypeLabel = 'RPD 超標 (Requests per day 每日配額上限用罄)';
  } else if (
    lower.includes('5 小時') ||
    lower.includes('5 hours') ||
    lower.includes('5小時') ||
    lower.includes('rolling window')
  ) {
    limitType = 'QUOTA';
    limitTypeLabel = '5 小時動態滑動額度用罄 (Rolling Window Quota Exhausted)';
  } else if (
    lower.includes('quota') ||
    lower.includes('exhausted') ||
    lower.includes('配額')
  ) {
    limitType = 'QUOTA';
    limitTypeLabel = '資源配額耗盡 (Resource / Quota Exhausted)';
  }

  // 提取重試時間 (Retry-After)
  let retryAfter: string | undefined;
  const retryMatches = [
    /retrydelay["':\s]+([0-9a-zA-Z.]+)/i,
    /retry-after["':\s]+([0-9a-zA-Z.]+)/i,
    /建議等待時間[：:\s]+([0-9a-zA-Z一-龥]+)/i,
    /wait\s+([0-9]+\s*(?:seconds?|secs?|s|minutes?|mins?|m))/i,
    /after\s+([0-9]+\s*(?:seconds?|secs?|s|minutes?|mins?|m))/i,
    /in\s+([0-9]+\s*(?:seconds?|secs?|s|minutes?|mins?|m))/i,
  ];

  for (const regex of retryMatches) {
    const match = errorMsg.match(regex);
    if (match && match[1]) {
      retryAfter = match[1].trim();
      break;
    }
  }

  let cleanDetails = errorMsg.replace(/\s+/g, ' ').trim();
  if (cleanDetails.length > 300) {
    cleanDetails = `${cleanDetails.slice(0, 300)}...`;
  }

  const retryText = retryAfter ? `請等待約 **${retryAfter}** 後重試` : '建議稍候 15~30 秒再試';

  const formattedContent = [
    `### ⚠️ 觸發 API 頻率限制 (Rate Limit / HTTP 429)`,
    ``,
    `串接模型 **${targetModel}** 遇到頻率限制或配額暫時用罄：`,
    `- **限制類型**：\`${limitTypeLabel}\``,
    `- **建議等待時間**：${retryAfter ? `\`${retryAfter}\`` : '稍候 15~30 秒'}`,
    `- **錯誤詳情**：${cleanDetails}`,
    ``,
    `---`,
    `#### 💡 建議因應措施：`,
    `1. **稍候重試**：${retryText}，待 API 配額窗口重置後即可繼續作業。`,
    `2. **切換輕量模型**：可至模型選單切換至 \`gemini-3.8-flash\` 或 \`gemini-2.5-flash\`，具備更高的 TPM/RPM 限額。`,
    `3. **關閉子代理人**：若目前開啟了多代理人 (Subagents)，可在「⚙️ 設定」中暫時停用，避免多任務並發請求瞬間超標。`,
    `4. **檢查配額方案**：請至 [Google AI Studio](https://aistudio.google.com/) 或 Google Cloud Console 檢視當前專案配額與帳單狀態。`,
  ].join('\n');

  return {
    isRateLimit: true,
    limitType,
    model: targetModel,
    provider: targetProvider,
    retryAfter,
    details: cleanDetails,
    formattedContent,
  };
}
