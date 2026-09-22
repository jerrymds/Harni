import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentSkill } from '@harni/types';

export class SkillRegistry {
  private skills = new Map<string, AgentSkill>();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.registerDefaultSkills();
    }
  }

  /**
   * Register a single skill
   */
  public register(skill: AgentSkill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Unregister a skill by name
   */
  public unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Retrieve a skill by name
   */
  public getSkill(name: string): AgentSkill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all registered skills
   */
  public getAllSkills(): AgentSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Discover and register custom skills from user home directory (~/.agents/skills, ~/.cline-web/skills, ~/.gemini/antigravity/builtin/skills)
   * and local workspace directory (.skills/ or skills/)
   */
  public async discoverWorkspaceSkills(workspaceRoot?: string): Promise<AgentSkill[]> {
    const discovered: AgentSkill[] = [];
    const homedir = os.homedir();

    const possibleDirs = [
      // 1. User Global Skill Directories
      path.join(homedir, '.agents', 'skills'),
      path.join(homedir, '.agent', 'skills'),
      path.join(homedir, '.harni', 'skills'),
      path.join(homedir, '.cline-web', 'skills'),
      path.join(homedir, '.gemini', 'antigravity', 'builtin', 'skills'),
    ];

    if (workspaceRoot) {
      // 2. Project Workspace Skill Directories (.skills, skills, .agents/skills)
      possibleDirs.push(
        path.join(workspaceRoot, '.skills'),
        path.join(workspaceRoot, 'skills'),
        path.join(workspaceRoot, '.agents', 'skills'),
        path.join(workspaceRoot, '.agent', 'skills'),
      );
    }

    const uniqueDirs = Array.from(new Set(possibleDirs.map((d) => path.resolve(d))));

    for (const dir of uniqueDirs) {
      try {
        const stats = await fs.stat(dir);
        if (!stats.isDirectory()) continue;

        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
            const filePath = path.join(dir, entry.name);
            const skill = await this.parseSkillFile(filePath, entry.name);
            if (skill) {
              this.register(skill);
              discovered.push(skill);
            }
          } else if (entry.isDirectory()) {
            // Check for subfolder skills (e.g. .skills/my-skill/SKILL.md)
            const subDir = path.join(dir, entry.name);
            try {
              const subEntries = await fs.readdir(subDir, { withFileTypes: true });
              // Prioritize SKILL.md, skill.md, or the first .md file
              const skillFileEntry =
                subEntries.find((e) => e.isFile() && e.name.toLowerCase() === 'skill.md') ||
                subEntries.find((e) => e.isFile() && e.name.endsWith('.md')) ||
                subEntries.find((e) => e.isFile() && e.name.endsWith('.json'));

              if (skillFileEntry) {
                const subSkillFile = path.join(subDir, skillFileEntry.name);
                const subSkill = await this.parseSkillFile(subSkillFile, `${entry.name}.md`);
                if (subSkill) {
                  this.register(subSkill);
                  discovered.push(subSkill);
                }
              }
            } catch {
              // Ignore
            }
          }
        }
      } catch {
        // Directory does not exist, safe to skip
      }
    }

    return discovered;
  }

  /**
   * Format all registered skills for inclusion in System Prompt
   */
  public formatSkillsForPrompt(): string {
    if (this.skills.size === 0) return '';

    const lines = [
      '==== AVAILABLE SKILLS (SKILLS INTEGRATION) ====',
      'You have access to specialized high-level workflows and skills. When a user task matches one of these domains, use the `use_skill` tool to activate the specialized SOP and instructions.',
      '',
    ];

    for (const skill of this.skills.values()) {
      const cat = skill.category ? `[${skill.category.toUpperCase()}] ` : '';
      const tools = skill.requiredTools && skill.requiredTools.length > 0
        ? ` (Recommended Tools: ${skill.requiredTools.join(', ')})`
        : '';
      lines.push(`- **${skill.name}**: ${cat}${skill.description}${tools}`);
    }

    lines.push('');
    lines.push('To activate a skill, call tool: `use_skill({ skillName: "<skill_name>" })`.');
    return lines.join('\n');
  }

  /**
   * Register standard built-in skills
   */
  private registerDefaultSkills(): void {
    // 1. Test Suite & Quality Verification
    this.register({
      name: 'run_test_suite',
      category: 'testing',
      description: '執行專案單元/整合測試套件，自動解析錯誤堆疊並提供精準修復建議',
      instructions: `### 測試執行與驗證流程 (Testing SOP):
1. **檢查測試配置**：讀取 \`package.json\`、\`jest.config.*\`、\`vitest.config.*\`、\`pytest.ini\` 等確定測試指令。
2. **執行測試**：調用 \`execute_command\` 執行測試指令（如 \`npm test\`、\`pytest\`）。
3. **分析測試輸出**：精確識別失敗的測試檔案、行數與 AssertionError 訊息。
4. **定位與修復**：讀取相關原始碼與測試代碼，使用 \`replace_file_content\` 修復問題。
5. **再次回歸測試**：重新執行測試確認全部 Pass。`,
      requiredTools: ['execute_command', 'read_file', 'replace_file_content'],
    });

    // 2. Git Smart Commit & Workflow
    this.register({
      name: 'git_smart_commit',
      category: 'git',
      description: '智慧分析當前工作區 Git 差異，生成標準 Conventional Commits 訊息並自動提交',
      instructions: `### Git 智慧提交流程 (Git Commit SOP):
1. **檢查狀態**：執行 \`git status\` 與 \`git diff\` 查看變更內容與新增檔案。
2. **分類變更**：判斷是 feat、fix、refactor、docs、test 或 chore。
3. **撰寫 Commit Message**：遵循 Conventional Commits 格式，繁體中文或簡潔英文描述具體改動動機與內容。
4. **執行提交**：執行 \`git add <files>\` 及 \`git commit -m "<message>"\`。`,
      requiredTools: ['execute_command'],
    });

    // 3. Code Review & Security Audit
    this.register({
      name: 'code_review',
      category: 'refactor',
      description: '全面性代碼審查：檢查安全性、邊界條件、型別安全、記憶體洩漏與可讀性',
      instructions: `### 代碼審查流程 (Code Review SOP):
1. **架構與依賴**：檢視模組間的耦合度與依賴方向是否合理。
2. **安全性與異常處理**：檢查 SQL Injection、XSS、未捕獲的 Promise Rejection 與空值指針問題。
3. **型別與防禦性設計**：確保 TypeScript / 型別標註嚴格，避免不當的 \`any\` 轉型。
4. **輸出審查報告**：以 Markdown 條列優點、潛在風險（Critical / Warning / Suggestion）與具體修復範例代碼。`,
      requiredTools: ['read_file', 'search_files'],
    });

    // 4. Architecture & Dependency Audit
    this.register({
      name: 'architecture_audit',
      category: 'architecture',
      description: '專案架構深度勘查：分析目錄層級、套件相依圖、資料流向與模組邊界',
      instructions: `### 架構審查流程 (Architecture Audit SOP):
1. **目錄與清單探索**：使用 \`list_files\` 和 \`search_files\` 綜覽專案主要目錄（如 \`src/\`, \`packages/\`, \`components/\`, \`services/\`）。
2. **配置與依賴**：讀取根目錄與各子套件的 \`package.json\`、\`tsconfig.json\` 等。
3. **資料流與核心流程**：追蹤入口點（Entry Point）、狀態管理（State Store）、API 通訊及後端服務。
4. **生成架構總結**：以清晰的層次與 Mermaid 流程圖向用戶展示系統架構與建議。`,
      requiredTools: ['list_files', 'read_file', 'search_files'],
    });

    // 5. Memory Bank Architecture & Context Sync
    this.register({
      name: 'memory-bank',
      category: 'workflow',
      description: '更新與維護專案架構脈絡與 Memory Bank（activeContext, systemPatterns, progress 等）',
      instructions: `### Memory Bank 維護與同步流程 (Memory Bank SOP):
1. **讀取核心檔案**：依序檢視 \`memory-bank/projectbrief.md\`、\`productContext.md\`、\`systemPatterns.md\`、\`techContext.md\`、\`activeContext.md\` 與 \`progress.md\`。
2. **核對最新變更**：比對當前工作階段的程式碼變更與既有架構模式。
3. **更新 activeContext.md**：記錄當前工作焦點、最新改動、下一步驟及未決決策。
4. **更新 progress.md**：更新已完成功能、待辦項目與專案進度狀態。
5. **更新 systemPatterns / techContext**：若有新架構模式、關鍵技術決策或相依套件調整，同步更新對應章節。`,
      requiredTools: ['read_file', 'write_to_file', 'replace_file_content', 'list_files'],
    });

    // 6. Git Commit from Memory Bank
    this.register({
      name: 'git-commit-from-memory',
      category: 'git',
      description: '從 Memory Bank 的 activeContext.md 與 Git 異動自動生成標準 Commit Message',
      instructions: `### 從記憶庫生成 Git 提交訊息流程 (Git Commit from Memory SOP):
1. **讀取 activeContext.md**：從 \`memory-bank/activeContext.md\` 讀取「當前工作焦點」與「當前工作階段 (未提交)」的內容。
2. **檢查 Git 狀態**：執行 \`git status --short\` 與 \`git diff --stat\` 檢查實際檔案變更。
3. **比對與合併**：核對 activeContext 中的描述與實際 Git 異動，排除已提交項並補充遺漏變更。
4. **格式化 Commit Message**：使用簡潔明瞭的繁體中文描述，動詞開頭（新增/修正/調整/優化/重構），多項改動以編號呈現。
5. **產出提交訊息**：提供使用者標準 Commit Message 或協助執行提交。`,
      requiredTools: ['read_file', 'execute_command'],
    });

    // 7. Grill Me Decision Interview
    this.register({
      name: 'grill-me',
      category: 'workflow',
      description: '透過深入連續訪談（一次一問）挑戰與釐清實作計畫、架構決策與邊界情況',
      instructions: `### Grill Me 決策訪談流程 (Grill Me SOP):
1. **一次只問一個問題 (One Question at a Time)**：切勿一次提出多個問題或長篇清單，確保討論聚焦。
2. **挑戰假設與邊界 (Challenge Assumptions)**：深入質疑隱含假設、邊界狀況 (Edge Cases)、極端錯誤與系統併發。
3. **探討取捨與替代方案 (Explore Trade-offs)**：詢問為何選擇此方案而非替代架構，權衡複雜度與維護性。
4. **推進與收斂**：根據使用者回答層層推進，涵蓋模組邊界、資料流、安全、效能與測試策略。
5. **整合最終計畫**：訪談結束後，彙整出周全結構化的 Implementation Plan 與驗證清單。`,
      requiredTools: ['read_file'],
    });
  }

  /**
   * Helper to parse markdown or JSON skill file
   */
  private async parseSkillFile(filePath: string, fileName: string): Promise<AgentSkill | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (fileName.endsWith('.json')) {
        const json = JSON.parse(content) as Partial<AgentSkill>;
        if (json.name && json.instructions) {
          return {
            name: json.name,
            description: json.description || json.name,
            category: json.category || 'custom',
            instructions: json.instructions,
            requiredTools: json.requiredTools || [],
            sourcePath: filePath,
          };
        }
      } else if (fileName.endsWith('.md')) {
        return this.parseMarkdownSkill(content, filePath, fileName);
      }
    } catch (err) {
      console.warn(`[SkillRegistry] Failed to parse skill file '${filePath}':`, err);
    }
    return null;
  }

  /**
   * Simple Frontmatter & Markdown parser for custom skills
   */
  private parseMarkdownSkill(raw: string, filePath: string, fileName: string): AgentSkill | null {
    const fallbackName = fileName.replace(/\.(md|markdown)$/i, '');
    let name = fallbackName;
    let description = fallbackName;
    let category: any = 'custom';
    let requiredTools: string[] = [];
    let instructions = raw;

    // Check for YAML-like Frontmatter (--- ... ---)
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (match && match[1] && match[2]) {
      const frontmatter = match[1];
      instructions = match[2].trim();

      const lines = frontmatter.split(/\r?\n/);
      let currentKey: string | null = null;
      let currentValue = '';

      const applyField = (k: string, v: string) => {
        let cleaned = v.trim();
        // Strip YAML scalar indicators: >-, >, |, |-
        cleaned = cleaned.replace(/^[>|]-?\s*/, '').trim();
        // Strip enclosing quotes
        cleaned = cleaned.replace(/^['"](.*)['"]$/, '$1').trim();

        if (k === 'name' && cleaned) name = cleaned;
        else if (k === 'description' && cleaned) description = cleaned;
        else if (k === 'category' && cleaned) category = cleaned;
        else if ((k === 'tools' || k === 'requiredtools') && cleaned) {
          requiredTools = cleaned.split(',').map((t) => t.trim()).filter(Boolean);
        }
      };

      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > -1 && !line.startsWith(' ') && !line.startsWith('\t')) {
          if (currentKey) {
            applyField(currentKey, currentValue);
          }
          currentKey = line.slice(0, colonIdx).trim().toLowerCase();
          currentValue = line.slice(colonIdx + 1).trim();
        } else if (currentKey) {
          currentValue += (currentValue ? ' ' : '') + line.trim();
        }
      }
      if (currentKey) {
        applyField(currentKey, currentValue);
      }
    } else {
      // First heading as name/description if present
      const headingMatch = raw.match(/^#\s+(.+)$/m);
      if (headingMatch && headingMatch[1]) {
        description = headingMatch[1].trim();
      }
    }

    return {
      name,
      description,
      category,
      instructions,
      requiredTools,
      sourcePath: filePath,
    };
  }
}
