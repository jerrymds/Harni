import type { LLMProviderType, ModelInfo } from '@harni/types';

export interface FetchModelsOptions {
  provider: LLMProviderType;
  apiKey?: string;
  baseURL?: string;
}

export const ANTIGRAVITY_OFFICIAL_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Antigravity)',
    description: 'Google 官方 - 最新一代高性價比、深度推理與長程 Agent 主力模型 (推薦預設)',
    contextWindow: 1048576,
    maxTokens: 8192,
  },
  {
    id: 'gemini-3.8-pro',
    name: 'Gemini 3.8 Pro (Antigravity)',
    description: 'Google 官方 - 旗艦頂級編程、複雜架構設計與極致多步推理',
    contextWindow: 2097152,
    maxTokens: 8192,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash (Antigravity)',
    description: 'Google 官方 - 新一代高速智慧與深度推理模型',
    contextWindow: 1048576,
    maxTokens: 8192,
  },
  {
    id: 'gemini-3.7-pro',
    name: 'Gemini 3.7 Pro (Antigravity)',
    description: 'Google 官方 - 旗艦頂級編程、複雜架構設計與多步推理',
    contextWindow: 2097152,
    maxTokens: 8192,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Antigravity)',
    description: 'Google 官方 - 極低延遲、高性價比 Agent 執行模型',
    contextWindow: 1048576,
    maxTokens: 8192,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro (Antigravity)',
    description: 'Google 官方 - 高精度程式碼理解與深度多模態分析',
    contextWindow: 2097152,
    maxTokens: 8192,
  },
];

export const CLINE_OFFICIAL_PASS_MODELS: ModelInfo[] = [
  { id: 'cline-pass/deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'Cline 官方 - 旗艦深度推理與強大編程能力', contextWindow: 131072, maxTokens: 8192 },
  { id: 'cline-pass/deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'Cline 官方 - 超高速、低延遲編程 (1M 上下文)', contextWindow: 1048576, maxTokens: 8192 },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', description: 'Cline 官方 - 超高速、低延遲編程 (1M 上下文)', contextWindow: 1048576, maxTokens: 8192 },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'Cline 官方 - 超高速、低延遲編程 (1M 上下文)', contextWindow: 1048576, maxTokens: 8192 },
  { id: 'cline-pass/kimi-k2.7-code', name: 'Kimi K2.7 Code', description: 'Cline 官方 - 程式碼專精與 Agent 執行模型', contextWindow: 200000, maxTokens: 8192 },
  { id: 'cline-pass/kimi-k3', name: 'Kimi K3', description: 'Cline 官方 - 新一代超長上下文與複雜推理', contextWindow: 200000, maxTokens: 8192 },
  { id: 'cline-pass/kimi-k2.6', name: 'Kimi K2.6', description: 'Cline 官方 - 均衡型高水準編程能力', contextWindow: 200000, maxTokens: 8192 },
  { id: 'cline-pass/glm-5.3', name: 'GLM-5.3', description: 'Cline 官方 - 最新智譜旗艦主力模型', contextWindow: 131072, maxTokens: 8192 },
  { id: 'cline-pass/glm-5.2', name: 'GLM-5.2', description: 'Cline 官方 - 高速推理模型', contextWindow: 131072, maxTokens: 8192 },
  { id: 'cline-pass/qwen3.8-max', name: 'Qwen3.8 Max', description: 'Cline 官方 - 通義千問頂級代碼與數學', contextWindow: 131072, maxTokens: 8192 },
  { id: 'cline-pass/qwen3.7-max', name: 'Qwen3.7 Max', description: 'Cline 官方 - 超大規模通用主力模型', contextWindow: 131072, maxTokens: 8192 },
  { id: 'cline-pass/qwen3.7-plus', name: 'Qwen3.7 Plus', description: 'Cline 官方 - 效能與品質平衡型模型', contextWindow: 131072, maxTokens: 8192 },
  { id: 'cline-pass/minimax-m3', name: 'MiniMax M3', description: 'Cline 官方 - MiniMax 旗艦多模態與邏輯', contextWindow: 1000000, maxTokens: 8192 },
  { id: 'cline-pass/mimo-v2.5-pro', name: 'MiMo-V2.5-Pro', description: 'Cline 官方 - 高精度專用 Agent 執行模型', contextWindow: 131072, maxTokens: 8192 },
  { id: 'cline-pass/mimo-v2.5', name: 'MiMo-V2.5', description: 'Cline 官方 - 快速執行模型', contextWindow: 131072, maxTokens: 8192 },
];

export const OPENROUTER_OFFICIAL_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet (OpenRouter)', description: 'Anthropic 旗艦主力推理與編程模型', contextWindow: 200000, maxTokens: 8192 },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (OpenRouter)', description: 'Anthropic 廣受歡迎的編程模型', contextWindow: 200000, maxTokens: 8192 },
  { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', description: 'OpenAI 旗艦多模態主力模型', contextWindow: 128000, maxTokens: 4096 },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', description: '高性價比程式碼與推理模型', contextWindow: 65536, maxTokens: 8192 },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (OpenRouter)', description: '開源頂級深度思維推理模型', contextWindow: 65536, maxTokens: 8192 },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro (OpenRouter)', description: 'Google 超長上下文旗艦模型', contextWindow: 1048576, maxTokens: 8192 },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (OpenRouter)', description: 'Google 極速輕量化模型', contextWindow: 1048576, maxTokens: 8192 },
];

export const OPENCODE_OFFICIAL_MODELS: ModelInfo[] = [
  { id: 'claude-fable-5', name: 'Claude Fable 5 (OpenCode Zen)', description: 'OpenCode Zen 官方首推旗艦 Agent 模型', contextWindow: 200000, maxTokens: 8192 },
  { id: 'claude-opus-5', name: 'Claude Opus 5 (OpenCode Zen)', description: '頂級編程與極致複雜推理', contextWindow: 200000, maxTokens: 8192 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (OpenCode Zen)', description: '兼具速度與高智慧編程', contextWindow: 200000, maxTokens: 8192 },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (OpenCode Zen)', description: '深度推理與長程 Agent 代碼模型', contextWindow: 131072, maxTokens: 8192 },
  { id: 'gpt-5', name: 'GPT-5 (OpenCode Zen)', description: 'OpenAI 次世代主力模型', contextWindow: 128000, maxTokens: 8192 },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (OpenCode Zen)', description: '高速低延遲大上下文模型', contextWindow: 1048576, maxTokens: 8192 },
];

export class ModelService {
  /**
   * Queries the provider's /models endpoint to retrieve all live available models.
   * For Cline API, prioritizes the 13 official Cline Pass models at the top.
   */
  public static async fetchModels(options: FetchModelsOptions): Promise<ModelInfo[]> {
    const { provider, apiKey, baseURL } = options;

    try {
      // 0. Antigravity Python Bridge Models
      if (provider === 'antigravity') {
        let cleanApiKey: string | undefined;
        if (apiKey) {
          const trimmed = apiKey.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.apiKey && typeof parsed.apiKey === 'string' && parsed.apiKey.startsWith('AIza')) {
                cleanApiKey = parsed.apiKey.trim();
              }
            } catch {}
          } else if (trimmed.startsWith('AIza')) {
            cleanApiKey = trimmed;
          }
        }

        const bridgeUrl = (baseURL || process.env.ANTIGRAVITY_BRIDGE_URL || 'http://127.0.0.1:8123').replace(/\/+$/, '');
        try {
          const bridgeQuery = cleanApiKey ? `?apiKey=${encodeURIComponent(cleanApiKey)}` : '';
          const res = await fetch(`${bridgeUrl}/api/models${bridgeQuery}`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            const data = (await res.json()) as any;
            if (Array.isArray(data.models) && data.models.length > 0) {
              return data.models;
            }
          }
        } catch {
          // Bridge may still be starting or offline; proceed to direct fallback
        }

        // Direct fallback: if a valid Gemini API key (starts with AIza) is provided, query Google Gemini models API directly
        if (cleanApiKey && cleanApiKey.startsWith('AIza')) {
          try {
            const googleRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanApiKey)}`,
              { signal: AbortSignal.timeout(4000) },
            );
            if (googleRes.ok) {
              const googleData = (await googleRes.json()) as any;
              const liveModels = this.parseGoogleGeminiModelsResponse(googleData);
              if (liveModels.length > 0) {
                return this.mergeModelsWithOfficial(liveModels, ANTIGRAVITY_OFFICIAL_MODELS);
              }
            }
          } catch (err: any) {
            console.info(`[ModelService] Live Google models discovery: ${err.message}`);
          }
        }

        return ANTIGRAVITY_OFFICIAL_MODELS;
      }

      // 1. Cline API (Prioritizes the 13 official Cline Pass models)
      if (provider === 'cline') {
        const effectiveKey = apiKey || process.env.CLINE_API_KEY || '';
        const effectiveUrl = (
          baseURL ||
          process.env.CLINE_BASE_URL ||
          'https://api.cline.bot/api/v1'
        ).replace(/\/+$/, '');

        const targetUrl = effectiveUrl.endsWith('/models')
          ? effectiveUrl
          : `${effectiveUrl}/models`;

        let apiModels: ModelInfo[] = [];

        try {
          const res = await fetch(targetUrl, {
            method: 'GET',
            headers: {
              authorization: `Bearer ${effectiveKey}`,
              'x-api-key': effectiveKey,
              'content-type': 'application/json',
            },
          });

          if (res.ok) {
            const json = (await res.json()) as any;
            apiModels = this.parseOpenAIModelsResponse(json);
          }
        } catch (err) {
          console.warn('[ModelService] Failed to fetch /models from Cline API:', err);
        }

        // Only include models starting with 'cline-pass/' or 'deepseek/'
        const combined = [...CLINE_OFFICIAL_PASS_MODELS];
        const existingIds = new Set(combined.map((m) => m.id));

        for (const model of apiModels) {
          if (
            (model.id.startsWith('cline-pass/') || model.id.startsWith('deepseek/')) &&
            !existingIds.has(model.id)
          ) {
            existingIds.add(model.id);
            combined.push(model);
          }
        }

        return combined.filter(
          (m) => m.id.startsWith('cline-pass/') || m.id.startsWith('deepseek/'),
        );
      }

      // 2. OpenAI / OpenRouter / OpenCode / Custom OpenAI-compatible Gateway
      if (provider === 'openai' || provider === 'custom' || provider === 'openrouter' || provider === 'opencode') {
        let defaultBaseUrl = 'https://api.openai.com/v1';
        let defaultKey = process.env.OPENAI_API_KEY;

        if (provider === 'custom') {
          defaultBaseUrl = process.env.CUSTOM_BASE_URL || 'http://localhost:8000/v1';
          defaultKey = process.env.CUSTOM_API_KEY;
        } else if (provider === 'openrouter') {
          defaultBaseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
          defaultKey = process.env.OPENROUTER_API_KEY;
        } else if (provider === 'opencode') {
          defaultBaseUrl = process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1';
          defaultKey = process.env.OPENCODE_API_KEY;
        }

        const effectiveKey = apiKey || defaultKey || '';

        let rawUrl = (baseURL || defaultBaseUrl).trim().replace(/\/+$/, '');
        if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
          rawUrl = rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1')
            ? `http://${rawUrl}`
            : `https://${rawUrl}`;
        }

        const targetUrl = rawUrl.endsWith('/models')
          ? rawUrl
          : `${rawUrl}/models`;

        try {
          const res = await fetch(targetUrl, {
            method: 'GET',
            headers: {
              ...(effectiveKey ? { authorization: `Bearer ${effectiveKey}` } : {}),
              ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://harni.dev', 'X-Title': 'Harni' } : {}),
              'content-type': 'application/json',
            },
            signal: AbortSignal.timeout(4000),
          });

          if (!res.ok) {
            const errBody = await res.text();
            console.warn(`[ModelService] ${provider} /models returned ${res.status}: ${errBody}`);
            if (provider === 'openrouter') return OPENROUTER_OFFICIAL_MODELS;
            if (provider === 'opencode') return OPENCODE_OFFICIAL_MODELS;
            return [];
          }

          const json = (await res.json()) as any;
          const models = this.parseOpenAIModelsResponse(json);
          if (models.length > 0) return models;
          if (provider === 'openrouter') return OPENROUTER_OFFICIAL_MODELS;
          if (provider === 'opencode') return OPENCODE_OFFICIAL_MODELS;
          return [];
        } catch (fetchErr: any) {
          console.info(`[ModelService] Unable to auto-discover /models from ${rawUrl} (${fetchErr.name || 'Timeout'}: ${fetchErr.message}). Manual Model ID input remains active.`);
          if (provider === 'openrouter') return OPENROUTER_OFFICIAL_MODELS;
          if (provider === 'opencode') return OPENCODE_OFFICIAL_MODELS;
          return [];
        }
      }

      // 3. Anthropic Official /v1/models
      if (provider === 'anthropic') {
        const effectiveKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
        if (!effectiveKey) return [];

        try {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            method: 'GET',
            headers: {
              'x-api-key': effectiveKey,
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(4000),
          });

          if (res.ok) {
            const data = (await res.json()) as any;
            const items = data.data || [];
            return items.map((m: any) => ({
              id: m.id,
              name: m.display_name || m.id,
              description: m.created_at
                ? `Released: ${new Date(m.created_at).toLocaleDateString()}`
                : undefined,
            }));
          }
        } catch (err: any) {
          console.info(`[ModelService] Anthropic /models query timed out or failed: ${err.message}`);
        }
        return [];
      }

      // 4. Ollama /api/tags or /v1/models
      if (provider === 'ollama') {
        let effectiveUrl = (baseURL || 'http://localhost:11434').trim().replace(
          /\/+$/,
          '',
        );
        if (!effectiveUrl.startsWith('http://') && !effectiveUrl.startsWith('https://')) {
          effectiveUrl = `http://${effectiveUrl}`;
        }

        // Try /v1/models first, then fallback to /api/tags
        try {
          const v1Res = await fetch(`${effectiveUrl}/v1/models`, {
            signal: AbortSignal.timeout(2500),
          });
          if (v1Res.ok) {
            const json = (await v1Res.json()) as any;
            const parsed = this.parseOpenAIModelsResponse(json);
            if (parsed.length > 0) return parsed;
          }
        } catch {}

        try {
          const res = await fetch(`${effectiveUrl}/api/tags`, {
            signal: AbortSignal.timeout(2500),
          });
          if (res.ok) {
            const data = (await res.json()) as any;
            const items = data.models || [];
            return items.map((m: any) => ({
              id: m.name || m.model,
              name: m.name || m.model,
              description: m.size
                ? `Size: ${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB`
                : undefined,
            }));
          }
        } catch {}
        return [];
      }
    } catch (err: any) {
      console.info(`[ModelService] Failed to query /models for ${provider}: ${err.message}`);
    }

    return [];
  }

  /**
   * Helper to parse OpenAI-standard { object: 'list', data: [...] } structure
   */
  private static parseOpenAIModelsResponse(json: any): ModelInfo[] {
    const list = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
          ? json.models
          : [];

    return list
      .filter((item: any) => item && (item.id || item.name))
      .map((item: any) => {
        const id = item.id || item.name;
        const name = item.display_name || item.name || item.id;
        let description: string | undefined = item.description;

        if (!description) {
          if (item.pricing) {
            description = `Input: $${item.pricing.input || item.pricing.prompt || 0}/M, Output: $${item.pricing.output || item.pricing.completion || 0}/M`;
          } else if (item.owned_by) {
            description = `Owned by ${item.owned_by}`;
          }
        }

        return {
          id,
          name,
          description,
          contextWindow:
            item.context_window ||
            item.max_context_length ||
            item.context_length ||
            item.top_provider?.context_length,
          maxTokens:
            item.max_tokens ||
            item.top_provider?.max_completion_tokens ||
            item.max_completion_tokens,
        };
      });
  }

  /**
   * Helper to parse Google Gemini /models response
   */
  private static parseGoogleGeminiModelsResponse(json: any): ModelInfo[] {
    const list = Array.isArray(json?.models) ? json.models : [];
    return list
      .filter((m: any) => {
        if (!m || !m.name) return false;
        const id = m.name.replace(/^models\//, '');
        const methods = m.supportedGenerationMethods || [];
        return methods.includes('generateContent') || id.startsWith('gemini');
      })
      .map((m: any) => {
        const id = m.name.replace(/^models\//, '');
        return {
          id,
          name: m.displayName ? `${m.displayName} (Google)` : id,
          description: m.description || `Google 官方模型 (上下文: ${m.inputTokenLimit?.toLocaleString() || '1M'})`,
          contextWindow: m.inputTokenLimit || 1048576,
          maxTokens: m.outputTokenLimit || 8192,
        };
      });
  }

  /**
   * Merges live discovered models with curated official models, keeping curated metadata.
   */
  private static mergeModelsWithOfficial(liveModels: ModelInfo[], officialModels: ModelInfo[]): ModelInfo[] {
    const officialMap = new Map(officialModels.map((m) => [m.id, m]));
    const result: ModelInfo[] = [];

    // Curated official models first
    for (const official of officialModels) {
      result.push(official);
    }

    // Append newly discovered models from live API
    for (const live of liveModels) {
      if (!officialMap.has(live.id)) {
        result.push(live);
      }
    }

    return result;
  }
}
