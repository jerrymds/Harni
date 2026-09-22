export interface McpPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  category: 'dev' | 'data' | 'search' | 'browser' | 'utility';
  command: string;
  args: string[];
  env: Record<string, string>;
  envDescriptions?: Record<string, string>;
  serverUrl?: string;
  requiresApproval?: boolean;
  npmPackage?: string;
  docUrl?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'github',
    name: 'GitHub MCP',
    badge: '官方推薦',
    description: '搜尋倉庫代碼、管理 Issues 與 PR、自動檢閱 Commit 紀錄。',
    category: 'dev',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: '',
    },
    envDescriptions: {
      GITHUB_PERSONAL_ACCESS_TOKEN: 'GitHub 經典或細緻權限 Personal Access Token (需具備 repo 權限)',
    },
    npmPackage: '@modelcontextprotocol/server-github',
    requiresApproval: true,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL MCP',
    badge: '資料庫',
    description: '連接 PostgreSQL 資料庫，即時檢視 Table Schema、分析資料結構與執行 SQL 查詢。',
    category: 'data',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost:5432/mydb'],
    env: {},
    npmPackage: '@modelcontextprotocol/server-postgres',
    requiresApproval: true,
  },
  {
    id: 'sqlite',
    name: 'SQLite MCP',
    badge: '本地資料庫',
    description: '直接檢索與操作本機 SQLite 資料庫檔案 (.db / .sqlite)。',
    category: 'data',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data.db'],
    env: {},
    requiresApproval: true,
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    badge: '檔案系統',
    description: '提供特定本地安全目錄的讀取與操作能力。',
    category: 'utility',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', './'],
    env: {},
    npmPackage: '@modelcontextprotocol/server-filesystem',
    requiresApproval: true,
  },
  {
    id: 'brave-search',
    name: 'Brave Search MCP',
    badge: '即時搜尋',
    description: '透過 Brave Search API 為 Agent 提供即時網頁搜尋與最新資訊檢索。',
    category: 'search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: {
      BRAVE_API_KEY: '',
    },
    envDescriptions: {
      BRAVE_API_KEY: 'Brave Search API Key (可於 brave.com/search/api 免費申請)',
    },
    npmPackage: '@modelcontextprotocol/server-brave-search',
    requiresApproval: false,
  },
  {
    id: 'fetch',
    name: 'Fetch & Read Web MCP',
    badge: '網頁抓取',
    description: '抓取遠端網頁 HTML 內容並自動轉換為乾淨的 Markdown 格式供 Agent 分析。',
    category: 'search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    env: {},
    npmPackage: '@modelcontextprotocol/server-fetch',
    requiresApproval: false,
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer 瀏覽器自動化',
    badge: '自動化測試',
    description: '啟動無頭 Chrome 瀏覽器，執行點擊、填表、網頁截圖與 DOM 狀態檢查。',
    category: 'browser',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    env: {},
    npmPackage: '@modelcontextprotocol/server-puppeteer',
    requiresApproval: true,
  },
  {
    id: 'memory',
    name: 'Memory Graph MCP',
    badge: '長效記憶',
    description: '基於知識圖譜的長效記憶伺服器，跨對話持久化實體與關聯紀錄。',
    category: 'utility',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    npmPackage: '@modelcontextprotocol/server-memory',
    requiresApproval: false,
  },
];
