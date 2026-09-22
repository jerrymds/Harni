import fs from 'node:fs';
import path from 'node:path';
import { ProviderFactory } from '../packages/agent-core/src/providers/providerFactory.js';
import type { ChatMessage, LLMProviderType } from '../packages/types/src/agent.js';

// Simple .env parser
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

async function runLLMConnectivityTest() {
  console.log('\n======================================================');
  console.log('🤖 cline-web LLM 連線連通性測試工具 (Connectivity Tester)');
  console.log('======================================================\n');

  // Parse CLI args: e.g. pnpm test:llm --provider cline --model cline-pass/deepseek-v4-pro
  const args = process.argv.slice(2);
  let providerArg: LLMProviderType = 'cline';
  let modelArg = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      providerArg = args[i + 1] as LLMProviderType;
      i++;
    } else if (args[i] === '--model' && args[i + 1]) {
      modelArg = args[i + 1];
      i++;
    }
  }

  console.log(`📌 測試服務商 (Provider): \x1b[36m${providerArg}\x1b[0m`);

  let apiKey = '';
  let baseURL = '';

  switch (providerArg) {
    case 'cline':
      apiKey = process.env.CLINE_API_KEY || '';
      baseURL = process.env.CLINE_BASE_URL || 'https://api.cline.bot/api/v1';
      modelArg = modelArg || 'cline-pass/deepseek-v4-pro';
      break;
    case 'anthropic':
      apiKey = process.env.ANTHROPIC_API_KEY || '';
      modelArg = modelArg || 'claude-3-5-sonnet-20241022';
      break;
    case 'openai':
      apiKey = process.env.OPENAI_API_KEY || '';
      modelArg = modelArg || 'gpt-4o';
      break;
    case 'deepseek':
      apiKey = process.env.DEEPSEEK_API_KEY || '';
      baseURL = 'https://api.deepseek.com/v1';
      modelArg = modelArg || 'deepseek-chat';
      break;
    case 'openrouter':
      apiKey = process.env.OPENROUTER_API_KEY || '';
      baseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      modelArg = modelArg || 'anthropic/claude-3.5-sonnet';
      break;
    case 'opencode':
      apiKey = process.env.OPENCODE_API_KEY || '';
      baseURL = process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1';
      modelArg = modelArg || 'claude-fable-5';
      break;
    case 'ollama':
      baseURL = 'http://localhost:11434';
      modelArg = modelArg || 'llama3.3';
      break;
  }

  console.log(`📌 測試模型 (Model): \x1b[33m${modelArg}\x1b[0m`);
  if (baseURL) console.log(`📌 API 端點 (BaseURL): \x1b[90m${baseURL}\x1b[0m`);
  console.log(`📌 API Key 狀態: ${apiKey ? '\x1b[32m已設定 (長度: ' + apiKey.length + ')\x1b[0m' : '\x1b[31m未設定 (請檢查 .env 檔案)\x1b[0m'}`);

  if (!apiKey && providerArg !== 'ollama') {
    console.error(`\n❌ 錯誤: 缺少 API Key！請在專案根目錄的 .env 檔案中設定對應的金鑰 (例如 CLINE_API_KEY=...)`);
    process.exit(1);
  }

  console.log('\n⏳ 正在向 LLM 發送測試請求 (Streaming Request)...');
  console.log('------------------------------------------------------');

  const provider = ProviderFactory.create(providerArg, {
    apiKey,
    baseURL,
    model: modelArg,
  });

  const testMessages: ChatMessage[] = [
    {
      id: 'test_1',
      role: 'user',
      content: '請以繁體中文簡短回覆：「Ping 成功！我已成功連接到 cline-web。」並說明你目前的模型名稱。',
      timestamp: Date.now(),
    },
  ];

  let receivedTokens = 0;
  let fullOutput = '';
  let fullThinking = '';

  try {
    const startTime = Date.now();
    const result = await provider.streamCompletion(
      testMessages,
      '你是一個優秀的 AI Agent 助手。',
      [],
      (chunk) => {
        if (chunk.type === 'token') {
          receivedTokens++;
          process.stdout.write(`\x1b[32m${chunk.content}\x1b[0m`);
          fullOutput += chunk.content;
        } else if (chunk.type === 'thinking') {
          process.stdout.write(`\x1b[90m${chunk.thought}\x1b[0m`);
          fullThinking += chunk.thought;
        }
      },
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n------------------------------------------------------');
    console.log(`\n🎉 \x1b[32m【測試通過】LLM 雙向串流連通完全正常！\x1b[0m`);
    console.log(`⏱️  耗時: ${elapsed} 秒`);
    console.log(`📊 接收 Token 數: ${receivedTokens}`);
    console.log(`💬 模型完整回覆:\n${result.text}`);
    if (result.thinking) {
      console.log(`🧠 思考過程 (Thinking):\n${result.thinking}`);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('\n------------------------------------------------------');
    console.error(`\n❌ \x1b[31m【連線失敗】無法與 LLM 伺服器通訊：\x1b[0m`);
    console.error(`⚠️  錯誤詳情: ${errorMsg}`);
    console.error('\n💡 排查建議：');
    console.error('1. 檢查 .env 中的 API Key 是否正確無誤（有無多餘空格或換行）。');
    console.error('2. 檢查網路是否能連通該 API 端點（若是公司內網需檢查 Proxy 設定）。');
    console.error('3. 檢查帳戶餘額是否充足或模型權限是否開通。');
    process.exit(1);
  }
}

runLLMConnectivityTest();
