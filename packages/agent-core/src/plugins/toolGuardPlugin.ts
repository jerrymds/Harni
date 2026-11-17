import {
  PluginPriority,
  type ToolCallMiddlewareContext,
  type ToolCallNext,
  type ToolDefinition,
  type ToolResult,
  type WorkflowPlugin,
  type WorkflowPluginCategory,
  type WorkflowPluginContext,
} from '@harni/types';

export class ToolGuardPlugin implements WorkflowPlugin {
  public readonly id = 'harni.tool-guard';
  public readonly name = 'Tool Guard & Permission Plugin';
  public readonly description =
    'Enforces tool approval gates, read-only MCP permission checks, and tool output truncation.';
  public readonly priority = PluginPriority.GUARD;
  public readonly category: WorkflowPluginCategory = 'guard';
  public readonly isBuiltin = true;
  public enabled = true;
  public applyToSubagents = true;

  private subagentToolNames = new Set([
    'invoke_subagent',
    'send_message',
    'manage_subagents',
    'define_subagent',
  ]);

  public onResolveTools(
    ctx: WorkflowPluginContext,
    tools: ToolDefinition[],
  ): ToolDefinition[] {
    if (!ctx.isSubagent && ctx.isSubagentsEnabled?.() === false) {
      return tools.filter((t) => !this.subagentToolNames.has(t.name));
    }
    return tools;
  }

  public async onToolCall(
    ctx: WorkflowPluginContext,
    toolCtx: ToolCallMiddlewareContext,
    next: ToolCallNext,
  ): Promise<ToolResult> {
    // 1. Read-only subagent attempting destructive / non-allowed MCP tool
    if (
      ctx.isSubagent &&
      toolCtx.isMcpTool &&
      toolCtx.mcpToolAllowedReadOnly === false
    ) {
      return {
        toolCallId: toolCtx.toolCall.id,
        isError: true,
        output: 'Tool not permitted for read-only subagent',
        summary: `Permission denied: ${toolCtx.toolCall.name}`,
      };
    }

    // 2. Subagent orchestration tools disabled in settings
    if (
      !ctx.isSubagent &&
      ctx.isSubagentsEnabled?.() === false &&
      this.subagentToolNames.has(toolCtx.canonicalToolName)
    ) {
      return {
        toolCallId: toolCtx.toolCall.id,
        isError: true,
        output: `Subagent orchestration tool '${toolCtx.toolCall.name}' is disabled in settings. Please solve the task directly without spawning subagents.`,
        summary: `Disabled tool ${toolCtx.toolCall.name}`,
      };
    }

    // 3. User approval check
    if (toolCtx.requiresApproval && ctx.requestToolApproval) {
      const approval = await ctx.requestToolApproval(toolCtx.toolCall);
      if (!approval.approved) {
        return {
          toolCallId: toolCtx.toolCall.id,
          isError: true,
          output: `User rejected execution of tool '${toolCtx.toolCall.name}'. ${approval.feedback ? 'Feedback: ' + approval.feedback : ''}`.trim(),
          summary: `Rejected ${toolCtx.toolCall.name}`,
        };
      }
    }

    // 4. Execute downstream middleware / core executor
    const result = await next();

    // 5. Output truncation for context window protection
    if (ctx.isSubagent) {
      const MAX_SUBAGENT_TOOL_OUTPUT_CHARS = 30_000;
      let toolOutputStr =
        typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output);

      if (toolOutputStr.length > MAX_SUBAGENT_TOOL_OUTPUT_CHARS) {
        const truncatedSuffix =
          `\n\n...[Subagent 工具輸出過長 (共 ${toolOutputStr.length.toLocaleString()} 字元)，已自動壓縮至安全長度以維護 Token 安全]...\n` +
          toolOutputStr.slice(-1000);
        toolOutputStr = toolOutputStr.slice(0, 28_000) + truncatedSuffix;
        if (typeof result.output === 'string') {
          result.output = toolOutputStr;
        }
      }
    } else {
      const MAX_TOOL_OUTPUT_CHARS = 40_000;
      let toolOutputStr =
        typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output);

      if (toolOutputStr.length > MAX_TOOL_OUTPUT_CHARS) {
        const truncatedSuffix =
          `\n\n...[工具輸出過長 (共 ${toolOutputStr.length.toLocaleString()} 字元)，Agent Core 已自動壓縮至安全長度以維護 Token 安全]...\n` +
          toolOutputStr.slice(-1000);
        toolOutputStr =
          toolOutputStr.slice(0, MAX_TOOL_OUTPUT_CHARS - 1500) + truncatedSuffix;
        if (typeof result.output === 'string') {
          result.output = toolOutputStr;
        }
      }
    }

    return result;
  }
}
