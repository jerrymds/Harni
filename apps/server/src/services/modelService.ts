import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgyBinaryResolver } from '@harni/agent-core';
import type { LLMProviderType, ModelInfo } from '@harni/types';

const execFileAsync = promisify(execFile);
const AGY_MODELS_CACHE_TTL_MS = 5 * 60_000;

interface AgyModelsCache {
  models: ModelInfo[];
  cachedAt: number;
}

export interface FetchModelsOptions {
  provider: LLMProviderType;
  apiKey?: string;
  baseURL?: string;
}

interface RawOpenAIModelItem {
  id?: string;
  name?: string;
  display_name?: string;
  description?: string;
  owned_by?: string;
  context_window?: number;
  max_context_length?: number;
  context_length?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  pricing?: {
    input?: number | string;
    prompt?: number | string;
    output?: number | string;
    completion?: number | string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

interface RawOpenAIModelsPayload {
  data?: RawOpenAIModelItem[];
  models?: RawOpenAIModelItem[];
}

interface RawGoogleGeminiModelItem {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

interface RawGoogleGeminiModelsPayload {
  models?: RawGoogleGeminiModelItem[];
}

interface RawAnthropicModelItem {
  id: string;
  display_name?: string;
  created_at?: string;
}

interface RawOllamaModelItem {
  name?: string;
  model?: string;
  size?: number;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const ANTIGRAVITY_OFFICIAL_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Google 官方 - 最新一代高性價比、深度推理與長程 Agent 主力模型 (推薦預設)',
    contextWindow: 1048576,
    maxTokens: 8192,
  },
  {
    id: 'gemini-3.8-pro',
    name: 'Gemini 3.8 Pro',
    description: 'Google 官方 - 旗艦頂級編程、複雜架構設計與極致多步推理',
    contextWindow: 2097152,
    maxTokens: 8192,
  },
  {
    id: 'claude-sonnet-5-5:acp',
    name: 'Claude 3.5 Sonnet (ACP)',
    provider: 'antigravity',
    contextWindow: 200000,
    isCustom: false,
  },
  {
    id: 'claude-opus-5-5:acp',
    name: 'Claude 3.5 Opus (ACP)',
    provider: 'antigravity',
    contextWindow: 200000,
    isCustom: false,
  },
  {
    id: 'gpt-oss-120b-medium:acp',
    name: 'GPT-OSS 120B (ACP)',
    provider: 'antigravity',
    contextWindow: 131072,
    isCustom: false,
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

export const PRESET_CURATED_MODELS: Record<string, ModelInfo[]> = {
  openrouter: OPENROUTER_OFFICIAL_MODELS,
  opencode: OPENCODE_OFFICIAL_MODELS,
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3 (deepseek-chat)', description: 'DeepSeek 官方主力對話與編程模型', contextWindow: 65536, maxTokens: 8192 },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1 (deepseek-reasoner)', description: 'DeepSeek 官方深度思維推理模型', contextWindow: 65536, maxTokens: 8192 },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile (Groq)', description: 'Groq LPU 超高速主力模型', contextWindow: 128000, maxTokens: 8192 },
    { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill Llama 70B', description: 'Groq 高速深度推理模型', contextWindow: 128000, maxTokens: 8192 },
    { id: 'qwen-qwq-32b', name: 'Qwen QwQ 32B (Groq)', description: '通義千問推理模型', contextWindow: 128000, maxTokens: 8192 },
  ],
  xai: [
    { id: 'grok-3-beta', name: 'Grok 3 Beta', description: 'xAI 旗艦推理與編程模型', contextWindow: 131072, maxTokens: 8192 },
    { id: 'grok-3-mini-beta', name: 'Grok 3 Mini Beta', description: 'xAI 高速輕量推理模型', contextWindow: 131072, maxTokens: 8192 },
  ],
  siliconflow: [
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 (SiliconFlow)', description: 'SiliconFlow 高速開源模型', contextWindow: 65536, maxTokens: 8192 },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 (SiliconFlow)', description: 'SiliconFlow 深度推理模型', contextWindow: 65536, maxTokens: 8192 },
    { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B', description: '程式碼專精開源模型', contextWindow: 131072, maxTokens: 8192 },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Instruct Turbo', description: 'Together AI 高速主力模型', contextWindow: 131072, maxTokens: 8192 },
    { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 (Together)', description: 'DeepSeek V3 雲端推論', contextWindow: 65536, maxTokens: 8192 },
    { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 (Together)', description: 'DeepSeek R1 深度推理', contextWindow: 65536, maxTokens: 8192 },
  ],
  mistral: [
    { id: 'codestral-latest', name: 'Codestral Latest', description: 'Mistral 官方程式碼生成與 Agent 專精模型', contextWindow: 256000, maxTokens: 8192 },
    { id: 'mistral-large-latest', name: 'Mistral Large Latest', description: 'Mistral 旗艦通用推理模型', contextWindow: 128000, maxTokens: 8192 },
  ],
  fireworks: [
    { id: 'accounts/fireworks/models/deepseek-v3', name: 'DeepSeek V3 (Fireworks)', description: 'Fireworks 超低延遲推論', contextWindow: 131072, maxTokens: 8192 },
    { id: 'accounts/fireworks/models/deepseek-r1', name: 'DeepSeek R1 (Fireworks)', description: 'Fireworks 深度推理模型', contextWindow: 131072, maxTokens: 8192 },
  ],
  cerebras: [
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B (Cerebras)', description: 'Cerebras 晶圓級極速推論', contextWindow: 128000, maxTokens: 8192 },
    { id: 'qwen-3-32b', name: 'Qwen 3 32B (Cerebras)', description: 'Cerebras 高速代碼與推理模型', contextWindow: 128000, maxTokens: 8192 },
  ],
};

const PRESET_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  opencode: process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1',
  deepseek: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  groq: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  xai: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
  siliconflow: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
  together: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
  mistral: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
  fireworks: process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1',
  cerebras: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
  lmstudio: 'http://localhost:1234/v1',
  vllm: 'http://localhost:8000/v1',
  custom: process.env.CUSTOM_BASE_URL || 'http://localhost:8000/v1',
};

export class ModelService {
  private static agyCliModelsCache: AgyModelsCache | null = null;

  public static clearAgyCliModelsCache(): void {
    this.agyCliModelsCache = null;
  }

  private static inferAgyModelContextWindow(modelId: string): number {
    const lower = modelId.toLowerCase();
    if (lower.includes('gemini-4') || lower.includes('pro') || lower.includes('orchestrator')) {
      return 2097152;
    }
    if (lower.includes('claude')) {
      return 200000;
    }
    if (lower.includes('gpt')) {
      return 131072;
    }
    return 1048576;
  }

  /**
   * Parses `<id>\t<displayName>` lines from `agy models` CLI output.
   */
  public static parseAgyModelsOutput(rawOutput: string): ModelInfo[] {
    if (!rawOutput || typeof rawOutput !== 'string') {
      return [];
    }

    const lines = rawOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsed: ModelInfo[] = [];

    for (const line of lines) {
      if (/^fetching\b/i.test(line) || /^[-=]+$/.test(line)) continue;

      const parts = line.includes('\t')
        ? line.split('\t').map((p) => p.trim())
        : line.split(/\s{2,}/).map((p) => p.trim());

      if (parts.length < 2) continue;

      const rawId = parts[0] || '';
      if (!rawId || /\s/.test(rawId) || /^[-=]+$/.test(rawId)) continue;

      const rawName = parts[1] || rawId;
      if (rawId.toLowerCase() === 'id' && rawName.toLowerCase().includes('name')) {
        continue;
      }

      const lowerId = rawId.toLowerCase();
      const shouldTagAcp =
        (lowerId.startsWith('claude-') || lowerId.startsWith('gpt-oss-')) &&
        !lowerId.endsWith(':acp');
      const id = shouldTagAcp ? `${rawId}:acp` : rawId;

      parsed.push({
        id,
        name: rawName,
        provider: 'antigravity',
        contextWindow: this.inferAgyModelContextWindow(rawId),
        isCustom: false,
      });
    }

    return parsed;
  }

  /**
   * Queries `agy models` via local CLI with a 5-minute TTL cache.
   */
  public static async fetchAgyCliModels(forceRefresh = false): Promise<ModelInfo[]> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.agyCliModelsCache &&
      now - this.agyCliModelsCache.cachedAt < AGY_MODELS_CACHE_TTL_MS
    ) {
      return this.agyCliModelsCache.models;
    }

    try {
      const binary = await AgyBinaryResolver.resolve();
      const { stdout } = await execFileAsync(binary, ['models'], {
        timeout: 10_000,
        windowsHide: true,
      });
      const models = this.parseAgyModelsOutput(stdout);
      if (models.length > 0) {
        this.agyCliModelsCache = { models, cachedAt: now };
      }
      return models;
    } catch (err: unknown) {
      console.info(`[ModelService] agy models discovery skipped: ${getErrorMessage(err)}`);
      return [];
    }
  }

  /**
   * Queries the provider's /models endpoint to retrieve all live available models.
   * For Cline API, prioritizes the 13 official Cline Pass models at the top.
   */
  public static async fetchModels(options: FetchModelsOptions): Promise<ModelInfo[]> {
    const { provider, apiKey, baseURL } = options;

    try {
      // 0. Antigravity Direct CLI Models (`agy models`)
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

        const cliModels = await this.fetchAgyCliModels();
        if (cliModels.length > 0) {
          return this.mergeAntigravityModels(cliModels, ANTIGRAVITY_OFFICIAL_MODELS);
        }

        // Direct fallback: if a valid Gemini API key (starts with AIza) is provided, query Google Gemini models API directly
        if (cleanApiKey && cleanApiKey.startsWith('AIza')) {
          try {
            const googleRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanApiKey)}`,
              { signal: AbortSignal.timeout(4000) },
            );
            if (googleRes.ok) {
              const googleData = (await googleRes.json()) as RawGoogleGeminiModelsPayload;
              const liveModels = this.parseGoogleGeminiModelsResponse(googleData);
              if (liveModels.length > 0) {
                return this.mergeAntigravityModels(liveModels, ANTIGRAVITY_OFFICIAL_MODELS);
              }
            }
          } catch (err: unknown) {
            console.info(`[ModelService] Live Google models discovery: ${getErrorMessage(err)}`);
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
            const json = (await res.json()) as RawOpenAIModelsPayload | RawOpenAIModelItem[];
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

      // 2. Anthropic Official or Anthropic-compatible /v1/models
      if (provider === 'anthropic' || provider.startsWith('anthropic-')) {
        const effectiveKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
        if (!effectiveKey) return [];

        const rawAnthropicBase = (baseURL || 'https://api.anthropic.com/v1').trim().replace(/\/+$/, '');
        const anthropicModelsUrl = rawAnthropicBase.endsWith('/models')
          ? rawAnthropicBase
          : `${rawAnthropicBase}/models`;

        try {
          const res = await fetch(anthropicModelsUrl, {
            method: 'GET',
            headers: {
              'x-api-key': effectiveKey,
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(4000),
          });

          if (res.ok) {
            const data = (await res.json()) as { data?: RawAnthropicModelItem[] };
            const items = Array.isArray(data.data) ? data.data : [];
            return items.map((m) => ({
              id: m.id,
              name: m.display_name || m.id,
              description: m.created_at
                ? `Released: ${new Date(m.created_at).toLocaleDateString()}`
                : undefined,
            }));
          }
        } catch (err: unknown) {
          console.info(`[ModelService] Anthropic /models query timed out or failed: ${getErrorMessage(err)}`);
        }
        return [];
      }

      // 3. Ollama /api/tags or /v1/models
      if (provider === 'ollama' || provider.startsWith('ollama-')) {
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
            const json = (await v1Res.json()) as RawOpenAIModelsPayload | RawOpenAIModelItem[];
            const parsed = this.parseOpenAIModelsResponse(json);
            if (parsed.length > 0) return parsed;
          }
        } catch {}

        try {
          const res = await fetch(`${effectiveUrl}/api/tags`, {
            signal: AbortSignal.timeout(2500),
          });
          if (res.ok) {
            const data = (await res.json()) as { models?: RawOllamaModelItem[] };
            const items = Array.isArray(data.models) ? data.models : [];
            return items
              .filter((m) => Boolean(m.name || m.model))
              .map((m) => {
                const id = m.name || m.model || '';
                return {
                  id,
                  name: id,
                  description: m.size
                    ? `Size: ${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB`
                    : undefined,
                };
              });
          }
        } catch {}
        return [];
      }

      // 4. OpenAI-compatible Gateway (OpenAI, OpenRouter, OpenCode, DeepSeek, Groq, xAI, Custom, or any dynamic provider ID)
      const defaultBaseUrl =
        PRESET_DEFAULT_BASE_URLS[provider] ||
        process.env.CUSTOM_BASE_URL ||
        'http://localhost:8000/v1';
      const envKeyName = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
      const defaultKey = process.env[envKeyName];
      const effectiveKey = apiKey || defaultKey || '';
      const fallbackModels = PRESET_CURATED_MODELS[provider] || [];

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
          return fallbackModels;
        }

        const json = (await res.json()) as RawOpenAIModelsPayload | RawOpenAIModelItem[];
        const models = this.parseOpenAIModelsResponse(json);
        if (models.length > 0) return models;
        return fallbackModels;
      } catch (fetchErr: unknown) {
        const errName = fetchErr instanceof Error ? fetchErr.name : 'Timeout';
        console.info(`[ModelService] Unable to auto-discover /models from ${rawUrl} (${errName}: ${getErrorMessage(fetchErr)}). Manual Model ID input remains active.`);
        return fallbackModels;
      }
    } catch (err: unknown) {
      console.info(`[ModelService] Failed to query /models for ${provider}: ${getErrorMessage(err)}`);
    }

    return [];
  }

  /**
   * Helper to parse OpenAI-standard { object: 'list', data: [...] } structure
   */
  private static parseOpenAIModelsResponse(
    json: RawOpenAIModelsPayload | RawOpenAIModelItem[] | null | undefined,
  ): ModelInfo[] {
    const list: RawOpenAIModelItem[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
          ? json.models
          : [];

    return list
      .filter((item): item is RawOpenAIModelItem & { id?: string; name?: string } =>
        Boolean(item && (item.id || item.name)),
      )
      .map((item) => {
        const id = item.id || item.name || '';
        const name = item.display_name || item.name || item.id || '';
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
  private static parseGoogleGeminiModelsResponse(
    json: RawGoogleGeminiModelsPayload | null | undefined,
  ): ModelInfo[] {
    const list = Array.isArray(json?.models) ? json.models : [];
    return list
      .filter((m): m is RawGoogleGeminiModelItem & { name: string } => {
        if (!m || !m.name) return false;
        const id = m.name.replace(/^models\//, '');
        const methods = m.supportedGenerationMethods || [];
        return methods.includes('generateContent') || id.startsWith('gemini');
      })
      .map((m) => {
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
   * Normalizes an Antigravity model ID by stripping thinking level suffixes.
   * Special exceptions: gpt-oss-120b-medium and gemini-pro-orchestrator-* preserve their names.
   */
  public static normalizeAntigravityModelId(rawId: string): string {
    const trimmed = (rawId || '').trim();
    const hasAcp = trimmed.toLowerCase().endsWith(':acp');
    let base = hasAcp ? trimmed.slice(0, -4) : trimmed;

    if (
      base.toLowerCase() !== 'gpt-oss-120b-medium' &&
      !/^gemini-pro-orchestrator-/i.test(base)
    ) {
      base = base.replace(/-(low|medium|high|xhigh)$/i, '');
    }

    return hasAcp ? `${base}:acp` : base;
  }

  /**
   * Normalizes an Antigravity model display name:
   * - Strips (Low), (Medium), (High), (XHigh), (Antigravity), (ACP Mode).
   * - Ensures pure ACP models end with '(ACP)', while dual-mode models have no suffix.
   */
  public static normalizeAntigravityModelName(rawName?: string, normalizedId?: string): string {
    let name = (rawName || normalizedId || '').trim();
    name = name
      .replace(/\s*\((?:low|medium|high|xhigh)\)/gi, '')
      .replace(/\s*-\s*(?:low|medium|high|xhigh)$/gi, '')
      .replace(/\s*\(antigravity\)/gi, '')
      .replace(/\s*\(acp\s+mode\)/gi, '')
      .trim();

    const isAcp = (normalizedId || '').toLowerCase().endsWith(':acp') || /\(acp\)/i.test(rawName || '');
    if (isAcp) {
      name = name.replace(/\s*\(acp\)/gi, '').trim();
      name = `${name} (ACP)`;
    } else {
      name = name.replace(/\s*\(acp\)/gi, '').trim();
    }
    return name;
  }

  /**
   * Normalizes and merges live Antigravity models with official curated models:
   * - Strips thinking level suffixes (-(low|medium|high)) and badges ((Low), (Medium), (High)).
   * - De-duplicates models based on normalized IDs and maps known models to official definitions.
   * - Retains new discovered models (e.g. gemini-4-argon) in pure form without duplicate thinking variants.
   */
  public static mergeAntigravityModels(
    liveModels: ModelInfo[],
    officialModels: ModelInfo[] = ANTIGRAVITY_OFFICIAL_MODELS,
  ): ModelInfo[] {
    const result: ModelInfo[] = [];
    const seenIds = new Set<string>();

    const officialByExactId = new Map<string, ModelInfo>();
    const officialByBaseId = new Map<string, ModelInfo>();

    for (const official of officialModels) {
      result.push(official);
      seenIds.add(official.id.toLowerCase());
      officialByExactId.set(official.id.toLowerCase(), official);

      const base = official.id.replace(/:acp$/i, '').toLowerCase();
      seenIds.add(base);
      officialByBaseId.set(base, official);
    }

    for (const live of liveModels) {
      const rawId = (live.id || live.name || '').trim();
      if (!rawId) continue;

      const normalizedId = this.normalizeAntigravityModelId(rawId);
      const normalizedBase = normalizedId.replace(/:acp$/i, '').toLowerCase();

      // Check if this normalized model matches an official model or already added model
      if (
        officialByExactId.has(normalizedId.toLowerCase()) ||
        officialByBaseId.has(normalizedBase) ||
        seenIds.has(normalizedId.toLowerCase()) ||
        seenIds.has(normalizedBase)
      ) {
        continue;
      }

      const hasAcpInRaw =
        rawId.toLowerCase().endsWith(':acp') ||
        /\(acp\s*mode\)/i.test(live.name || '') ||
        /\(acp\)/i.test(live.name || '');

      const finalId =
        hasAcpInRaw && !normalizedId.endsWith(':acp')
          ? `${normalizedId}:acp`
          : normalizedId;

      const cleanName = this.normalizeAntigravityModelName(live.name, finalId);

      const newModel: ModelInfo = {
        ...live,
        id: finalId,
        name: cleanName,
      };

      seenIds.add(finalId.toLowerCase());
      seenIds.add(finalId.replace(/:acp$/i, '').toLowerCase());
      result.push(newModel);
    }

    return result;
  }

  /**
   * Merges live discovered models with curated official models, keeping curated metadata.
   */
  public static mergeModelsWithOfficial(liveModels: ModelInfo[], officialModels: ModelInfo[]): ModelInfo[] {
    if (officialModels === ANTIGRAVITY_OFFICIAL_MODELS || officialModels.some((m) => m.id === 'gemini-3.8-flash')) {
      return this.mergeAntigravityModels(liveModels, officialModels);
    }
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
