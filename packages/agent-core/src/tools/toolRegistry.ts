import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import { ReadFileTool } from './readFile.js';
import { WriteFileTool } from './writeFile.js';
import { ReplaceFileContentTool } from './replaceFileContent.js';
import { ListFilesTool } from './listFiles.js';
import { SearchFilesTool } from './searchFiles.js';
import { ExecuteCommandTool } from './executeCommand.js';
import { UseSkillTool } from './useSkill.js';
import { InvokeSubagentTool } from './invokeSubagent.js';
import { SendMessageTool } from './sendMessage.js';
import { ManageSubagentsTool } from './manageSubagents.js';
import { DefineSubagentTool } from './defineSubagent.js';
import { AskQuestionTool } from './askQuestion.js';
import type { SkillRegistry } from '../skills/skillRegistry.js';
import type { ToolDefinition, ToolResult } from '@harni/types';

export class ToolRegistry {
  private tools = new Map<string, BaseTool<any>>();
  private skillRegistry?: SkillRegistry;

  constructor(registerDefaults = true, skillRegistry?: SkillRegistry) {
    this.skillRegistry = skillRegistry;
    if (registerDefaults) {
      this.registerDefaultTools();
    }
  }

  public setSkillRegistry(skillRegistry: SkillRegistry): void {
    this.skillRegistry = skillRegistry;
    this.register(new UseSkillTool(skillRegistry));
  }

  public register(tool: BaseTool<any>): void {
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): BaseTool<any> | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): BaseTool<any>[] {
    return Array.from(this.tools.values());
  }

  public getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.getDefinition());
  }

  public async executeTool(
    name: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        toolCallId: '',
        isError: true,
        output: `Unknown tool: '${name}'. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
      };
    }

    return await tool.execute(params, context);
  }

  private registerDefaultTools(): void {
    this.register(new ReadFileTool());
    this.register(new WriteFileTool());
    this.register(new ReplaceFileContentTool());
    this.register(new ListFilesTool());
    this.register(new SearchFilesTool());
    this.register(new ExecuteCommandTool());
    this.register(new InvokeSubagentTool());
    this.register(new SendMessageTool());
    this.register(new ManageSubagentsTool());
    this.register(new DefineSubagentTool());
    this.register(new AskQuestionTool());
    if (this.skillRegistry) {
      this.register(new UseSkillTool(this.skillRegistry));
    }
  }
}
