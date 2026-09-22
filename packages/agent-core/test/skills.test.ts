import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentCoreEngine, MockProvider } from '../src/index.js';

describe('SkillRegistry & Skills Integration', () => {
  const tempTestDir = path.resolve('temp_test_skills_workspace');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  it('contains built-in skills and discovers custom workspace skills', async () => {
    const engine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    const skillRegistry = engine.getSkillRegistry();
    const allSkills = skillRegistry.getAllSkills();
    expect(allSkills.length).toBeGreaterThanOrEqual(7);
    expect(skillRegistry.getSkill('run_test_suite')).toBeDefined();
    expect(skillRegistry.getSkill('git_smart_commit')).toBeDefined();
    expect(skillRegistry.getSkill('memory-bank')).toBeDefined();
    expect(skillRegistry.getSkill('git-commit-from-memory')).toBeDefined();
    expect(skillRegistry.getSkill('grill-me')).toBeDefined();

    // Create a custom workspace skill in .skills/
    const customSkillsDir = path.join(tempTestDir, '.skills');
    await fs.mkdir(customSkillsDir, { recursive: true });
    const customSkillContent = `---
name: custom_db_migrate
description: 執行資料庫遷移與結構校驗
category: workflow
tools: execute_command, read_file
---

### 自訂遷移流程:
1. 檢查 migrations 資料夾
2. 執行遷移指令
`;
    await fs.writeFile(path.join(customSkillsDir, 'db_migrate.md'), customSkillContent, 'utf-8');

    const discovered = await skillRegistry.discoverWorkspaceSkills(tempTestDir);
    expect(discovered.some((s) => s.name === 'custom_db_migrate')).toBe(true);

    // Test use_skill Tool Execution
    const useSkillRes = await engine.getToolRegistry().executeTool(
      'use_skill',
      { skillName: 'custom_db_migrate' },
      { workspaceRoot: tempTestDir },
    );
    expect(useSkillRes.isError).toBeFalsy();
    expect(String(useSkillRes.output)).toContain('custom_db_migrate');

    const formattedPrompt = skillRegistry.formatSkillsForPrompt();
    expect(formattedPrompt).toContain('custom_db_migrate');
  });

  it('executes multi-turn code_review skill with tool name preservation', async () => {
    const codeReviewEngine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
    });

    const mockReviewProvider = new MockProvider({
      script: [
        // Turn 1: Assistant activates code_review skill
        {
          thought: 'I will activate the code_review skill.',
          text: 'Activating code_review skill...',
          toolCalls: [
            {
              id: 'call_review_01',
              name: 'use_skill',
              arguments: { skillName: 'code_review' },
            },
          ],
        },
        // Turn 2: Assistant receives SOP and calls search_files
        {
          thought: 'Skill activated. Now searching codebase.',
          text: 'Reviewing codebase...',
          toolCalls: [
            {
              id: 'call_review_02',
              name: 'search_files',
              arguments: { query: 'test' },
            },
          ],
        },
        // Turn 3: Assistant produces final review summary
        {
          thought: 'Analysis complete. Delivering review report.',
          text: '## Code Review Report\nAll code looks solid.',
        },
      ],
    });

    await codeReviewEngine.startTask('請使用 code_review 技能審查現有代碼', {
      customProvider: mockReviewProvider,
    });

    expect(codeReviewEngine.getStatus()).toBe('completed');
    const reviewMessages = codeReviewEngine.getTaskState()?.messages || [];
    expect(reviewMessages.length).toBeGreaterThanOrEqual(5);

    const toolMsg1 = reviewMessages.find((m) => m.role === 'tool' && m.toolCallId === 'call_review_01');
    expect(toolMsg1?.name).toBe('use_skill');
    expect(typeof toolMsg1?.content === 'string' && toolMsg1.content.includes('code_review')).toBe(true);

    const toolMsg2 = reviewMessages.find((m) => m.role === 'tool' && m.toolCallId === 'call_review_02');
    expect(toolMsg2?.name).toBe('search_files');

    const finalAsst = reviewMessages[reviewMessages.length - 1];
    expect(finalAsst?.role === 'assistant' && finalAsst.content.includes('Code Review Report')).toBe(true);
  });
});
