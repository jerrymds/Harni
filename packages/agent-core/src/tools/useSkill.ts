import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import type { SkillRegistry } from '../skills/skillRegistry.js';
import type { ToolParametersSchema, ToolResult, UseSkillParams } from '@harni/types';

export class UseSkillTool extends BaseTool<UseSkillParams> {
  public readonly name = 'use_skill';
  public readonly description =
    '啟用或串接特定專屬技能 (Agent Skill)，獲取該領域專屬的標準作業程序 (SOP)、指引及推薦工具鏈';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      skillName: {
        type: 'string',
        description: '欲啟用的技能名稱 (例如: run_test_suite, git_smart_commit, code_review, architecture_audit)',
      },
      input: {
        type: 'string',
        description: '提供給該技能的額外參數、目標檔案或補充指示 (可選)',
      },
    },
    required: ['skillName'],
  };

  private skillRegistry: SkillRegistry;

  constructor(skillRegistry: SkillRegistry) {
    super();
    this.skillRegistry = skillRegistry;
  }

  public async execute(
    params: UseSkillParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const { skillName, input } = params;
    const skill = this.skillRegistry.getSkill(skillName);

    if (!skill) {
      const available = this.skillRegistry
        .getAllSkills()
        .map((s) => s.name)
        .join(', ');
      return {
        toolCallId: '',
        isError: true,
        output: `❌ 未找到名稱為 '${skillName}' 的技能。目前可用的技能清單：${available}`,
        summary: `Skill '${skillName}' not found`,
      };
    }

    // If the skill defines a custom execution function, execute it
    if (skill.execute) {
      try {
        const customResult = await skill.execute(
          typeof input === 'object' && input !== null ? input : { input },
          context,
        );
        return {
          toolCallId: '',
          isError: customResult.isError || false,
          output: customResult.output,
          summary: customResult.summary || `Executed skill '${skill.name}'`,
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          toolCallId: '',
          isError: true,
          output: `執行技能 '${skill.name}' 發生錯誤: ${errorMsg}`,
          summary: `Error in skill '${skill.name}'`,
        };
      }
    }

    // Default: Return the activated skill's instructions, required tools, and guidelines
    const resultOutput = [
      `🎯 **已啟用技能【${skill.name}】**`,
      skill.description ? `*說明*: ${skill.description}` : '',
      skill.requiredTools && skill.requiredTools.length > 0
        ? `*推薦工具鏈*: ${skill.requiredTools.join(', ')}`
        : '',
      '',
      `📋 **執行 SOP 與指引**:`,
      skill.instructions,
      input ? `\n🔍 **用戶指定目標/參數**: ${typeof input === 'string' ? input : JSON.stringify(input)}` : '',
      '',
      `💡 *請嚴格遵循上述指引，接續調用相應工具逐步完成此任務。*`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      toolCallId: '',
      isError: false,
      output: resultOutput,
      summary: `Activated skill: ${skill.name}`,
    };
  }
}
