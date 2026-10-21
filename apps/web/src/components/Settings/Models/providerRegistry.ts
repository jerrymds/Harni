import type { LLMProviderConfig } from '@harni/types';

/**
 * Built-in core providers shipped by default.
 * Adding or extending providers no longer requires hardcoding UI branches:
 * any entry in BUILTIN_PROVIDERS, PROVIDER_PRESETS, or user-added customProviders
 * is automatically rendered in the Settings Master-Detail panel and Header selector.
 */
export const BUILTIN_PROVIDERS: LLMProviderConfig[] = [
  {
    id: 'antigravity',
    name: 'Google Antigravity',
    icon: '🌌',
    description: 'Gemini 官方額度池與本地 Bridge 服務',
    protocol: 'antigravity',
    defaultBaseUrl: 'http://127.0.0.1:8123',
    defaultModel: 'gemini-3.8-flash',
    requiresApiKey: false,
    isBuiltin: true,
    enabled: true,
    badge: '官方額度池',
    category: 'official',
  },
  {
    id: 'cline',
    name: 'Cline 官方 API',
    icon: '⚡',
    description: 'api.cline.bot (Cline Pass 官方推薦模型)',
    protocol: 'cline',
    defaultBaseUrl: 'https://api.cline.bot/api/v1',
    defaultModel: 'cline-pass/deepseek-v4-pro',
    apiKeyPlaceholder: '輸入 Cline API Key',
    requiresApiKey: true,
    isBuiltin: true,
    enabled: true,
    badge: 'Cline Pass',
    category: 'official',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    icon: '🧠',
    description: '支援 Claude Pro/Max 訂閱 OAuth 與官方 API',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiKeyPlaceholder: '輸入 Anthropic API Key (sk-ant-...)',
    requiresApiKey: true,
    isBuiltin: true,
    enabled: true,
    badge: 'OAuth / API',
    category: 'official',
  },
  {
    id: 'openai',
    name: 'OpenAI GPT',
    icon: '🤖',
    description: '支援 ChatGPT Plus/Pro 訂閱 Codex 與官方 API',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-sol',
    apiKeyPlaceholder: '輸入 OpenAI API Key (sk-...)',
    requiresApiKey: true,
    isBuiltin: true,
    enabled: true,
    badge: 'Codex / API',
    category: 'official',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    description: 'openrouter.ai 跨廠牌聚合路由網關',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKeyPlaceholder: '輸入 OpenRouter API Key (sk-or-v1-...)',
    requiresApiKey: true,
    isBuiltin: true,
    enabled: true,
    badge: '聚合路由',
    category: 'aggregator',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: '💻',
    description: 'opencode.ai/zen 官方 Agent 路由',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    defaultModel: 'claude-fable-5',
    apiKeyPlaceholder: '輸入 OpenCode Zen API Key',
    requiresApiKey: true,
    isBuiltin: true,
    enabled: true,
    badge: 'Zen API',
    category: 'aggregator',
  },
  {
    id: 'ollama',
    name: 'Ollama 本地模型',
    icon: '🦙',
    description: 'Local daemon 本機離線推理服務',
    protocol: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.3',
    apiKeyPlaceholder: '本機預設免填金鑰',
    requiresApiKey: false,
    isBuiltin: true,
    enabled: true,
    badge: '本機免密',
    category: 'local',
  },
  {
    id: 'custom',
    name: '自訂服務商',
    icon: '🛠️',
    description: 'OpenAI 相容私有或第三方網關',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:8000/v1',
    defaultModel: 'custom-model',
    apiKeyPlaceholder: '自訂 API Key (如 sk-..., gsk-... 或本機留空)',
    requiresApiKey: false,
    isBuiltin: true,
    enabled: true,
    badge: '自訂網關',
    category: 'custom',
  },
];

/**
 * One-click Provider Preset Marketplace templates.
 * Users can add any of these to their provider list in 1 click without touching code,
 * or developers can drop new presets here as pure data.
 */
export const PROVIDER_PRESETS: LLMProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方 API',
    icon: '🐋',
    description: 'DeepSeek V3 / R1 官方直連 API (platform.deepseek.com)',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyPlaceholder: '輸入 DeepSeek API Key (sk-...)',
    requiresApiKey: true,
    badge: '高性價比推理',
    category: 'cloud',
    docUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    icon: '🚀',
    description: 'LPU 硬體加速超低延遲推論服務 (console.groq.com)',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    apiKeyPlaceholder: '輸入 Groq API Key (gsk_...)',
    requiresApiKey: true,
    badge: 'LPU 極速推論',
    category: 'cloud',
    docUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    icon: '✖️',
    description: 'xAI 官方 Grok-3 / Grok-3 Mini API (console.x.ai)',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-beta',
    apiKeyPlaceholder: '輸入 xAI API Key (xai-...)',
    requiresApiKey: true,
    badge: 'Grok 官方',
    category: 'cloud',
    docUrl: 'https://console.x.ai',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow 矽基流動',
    icon: '💧',
    description: 'DeepSeek / Qwen / GLM 高速開源模型雲端聚合',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    apiKeyPlaceholder: '輸入 SiliconFlow API Key (sk-...)',
    requiresApiKey: true,
    badge: '開源模型聚合',
    category: 'aggregator',
    docUrl: 'https://cloud.siliconflow.cn',
  },
  {
    id: 'together',
    name: 'Together AI',
    icon: '🤝',
    description: 'Llama / DeepSeek / Qwen 頂級開源模型雲端推論',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    apiKeyPlaceholder: '輸入 Together API Key',
    requiresApiKey: true,
    badge: '開源雲端',
    category: 'cloud',
    docUrl: 'https://api.together.xyz',
  },
  {
    id: 'mistral',
    name: 'Mistral AI (Codestral)',
    icon: '🌪️',
    description: 'Mistral Large 與 Codestral 官方編程專精 API',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'codestral-latest',
    apiKeyPlaceholder: '輸入 Mistral API Key',
    requiresApiKey: true,
    badge: 'Codestral',
    category: 'cloud',
    docUrl: 'https://console.mistral.ai',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    icon: '🎆',
    description: '超高速生產級開源模型推論平台 (fireworks.ai)',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/deepseek-v3',
    apiKeyPlaceholder: '輸入 Fireworks API Key (fw_...)',
    requiresApiKey: true,
    badge: '高速推論',
    category: 'cloud',
    docUrl: 'https://fireworks.ai',
  },
  {
    id: 'cerebras',
    name: 'Cerebras Inference',
    icon: '🔥',
    description: '晶圓級引擎驅動的極速開源模型推論 (cloud.cerebras.ai)',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    apiKeyPlaceholder: '輸入 Cerebras API Key (csk-...)',
    requiresApiKey: true,
    badge: '晶圓級加速',
    category: 'cloud',
    docUrl: 'https://cloud.cerebras.ai',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio 本地伺服器',
    icon: '🖥️',
    description: '連接本機 LM Studio OpenAI 相容端點 (預設 1234 埠)',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    apiKeyPlaceholder: '本機預設免填 (lm-studio)',
    requiresApiKey: false,
    badge: '本機 GUI',
    category: 'local',
  },
  {
    id: 'vllm',
    name: 'vLLM / LiteLLM 私有網關',
    icon: '⚙️',
    description: '自建企業內部 vLLM、LiteLLM 或 OneAPI 代理伺服器',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:8000/v1',
    defaultModel: 'default-model',
    apiKeyPlaceholder: '輸入內部網關 Token (若免密可留空)',
    requiresApiKey: false,
    badge: '私有部署',
    category: 'local',
  },
];

/**
 * Merges built-in providers with user-added custom/preset providers.
 */
export function resolveAllProviders(
  customProviders: LLMProviderConfig[] = [],
  customProviderName?: string,
): LLMProviderConfig[] {
  const customMap = new Map(customProviders.map((p) => [p.id, p]));
  const result: LLMProviderConfig[] = [];

  for (const builtin of BUILTIN_PROVIDERS) {
    const override = customMap.get(builtin.id);
    if (builtin.id === 'custom') {
      result.push({
        ...builtin,
        ...override,
        name: override?.name || customProviderName || builtin.name,
        isBuiltin: true,
      });
    } else {
      result.push({
        ...builtin,
        ...override,
        isBuiltin: true,
      });
    }
    customMap.delete(builtin.id);
  }

  for (const custom of customMap.values()) {
    result.push({
      ...custom,
      isBuiltin: false,
      enabled: custom.enabled ?? true,
    });
  }

  return result;
}

/**
 * Finds the configuration for any provider ID (built-in, custom, or preset fallback).
 */
export function getProviderConfig(
  providerId: string,
  customProviders: LLMProviderConfig[] = [],
  customProviderName?: string,
): LLMProviderConfig {
  const all = resolveAllProviders(customProviders, customProviderName);
  const found = all.find((p) => p.id === providerId);
  if (found) return found;

  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  if (preset) return preset;

  return {
    id: providerId,
    name: providerId,
    icon: '🔌',
    description: 'OpenAI 相容服務商',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:8000/v1',
    defaultModel: 'default-model',
    requiresApiKey: false,
    isBuiltin: false,
    enabled: true,
    category: 'custom',
  };
}
