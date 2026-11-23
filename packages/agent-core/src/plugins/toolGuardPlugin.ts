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
import { resolveCanonicalToolName } from '../tools/toolAdapter.js';

export class ToolGuardPlugin implements WorkflowPlugin {
  public readonly id = 'harni.tool-guard';
  public readonly name = 'Tool Guard & Permission Plugin';
  public readonly description =
    'Enforces tool approval gates, ask-mode read-only guardrails, read-only MCP permission checks, and tool output truncation.';
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
    'swarm',
  ]);

  private askModeBlockedTools = new Set([
    'write_file',
    'edit_file',
    'run_command',
    'schedule',
    'define_subagent',
    'swarm',
  ]);

  private defaultReadOnlySubagents = new Set(['researcher', 'architect']);

  private strictOrchestrationBlockedTools = new Set([
    'read_file',
    'list_files',
    'search_files',
    'write_file',
    'edit_file',
    'run_command',
  ]);

  private isAskMode(ctx: WorkflowPluginContext): boolean {
    return !ctx.isSubagent && ctx.taskState?.mode === 'ask';
  }

  private isStrictOrchestrationActive(ctx: WorkflowPluginContext): boolean {
    return (
      !ctx.isSubagent &&
      ctx.isSubagentsEnabled?.() !== false &&
      ctx.isStrictOrchestrationEnabled?.() === true
    );
  }

  private isReadOnlySubagent(ctx: WorkflowPluginContext, typeName: string): boolean {
    if (ctx.isReadOnlySubagentType) {
      return ctx.isReadOnlySubagentType(typeName);
    }
    return this.defaultReadOnlySubagents.has(typeName.trim().toLowerCase());
  }

  public onResolveTools(
    ctx: WorkflowPluginContext,
    tools: ToolDefinition[],
  ): ToolDefinition[] {
    let resolved = tools;
    if (!ctx.isSubagent && ctx.isSubagentsEnabled?.() === false) {
      resolved = resolved.filter((t) => !this.subagentToolNames.has(t.name));
    }

    if (this.isAskMode(ctx)) {
      resolved = resolved.filter((t) => {
        const canonical = resolveCanonicalToolName(t.name);
        if (this.askModeBlockedTools.has(canonical)) {
          return false;
        }
        if (ctx.isMcpToolAllowedReadOnly && ctx.isMcpToolAllowedReadOnly(t.name) === false) {
          return false;
        }
        return true;
      });
    }

    if (this.isStrictOrchestrationActive(ctx)) {
      resolved = resolved.filter(
        (t) => !this.strictOrchestrationBlockedTools.has(resolveCanonicalToolName(t.name)),
      );
    }

    return resolved;
  }

  public async onToolCall(
    ctx: WorkflowPluginContext,
    toolCtx: ToolCallMiddlewareContext,
    next: ToolCallNext,
  ): Promise<ToolResult> {
    // 0. Ask-mode hard read-only guardrails
    if (this.isAskMode(ctx)) {
      if (this.askModeBlockedTools.has(toolCtx.canonicalToolName)) {
        return {
          toolCallId: toolCtx.toolCall.id,
          isError: true,
          output: `Tool '${toolCtx.toolCall.name}' is disabled in 'ask' mode (read-only). Switch to 'code' mode to modify files or run commands.`,
          summary: `Blocked in ask mode: ${toolCtx.toolCall.name}`,
        };
      }

      if (toolCtx.isMcpTool && toolCtx.mcpToolAllowedReadOnly === false) {
        return {
          toolCallId: toolCtx.toolCall.id,
          isError: true,
          output: `MCP tool '${toolCtx.toolCall.name}' is not permitted in 'ask' mode (read-only).`,
          summary: `Permission denied in ask mode: ${toolCtx.toolCall.name}`,
        };
      }

      if (toolCtx.canonicalToolName === 'invoke_subagent') {
        const subagents = (
          toolCtx.toolCall.arguments as
            | { subagents?: Array<{ typeName?: string; isolation?: string }> }
            | undefined
        )?.subagents;

        if (Array.isArray(subagents)) {
          for (const sub of subagents) {
            if (sub?.isolation === 'worktree') {
              return {
                toolCallId: toolCtx.toolCall.id,
                isError: true,
                output: `Worktree isolation is not permitted in 'ask' mode (read-only). Switch to 'code' mode to isolate or edit files.`,
                summary: 'Blocked worktree subagent in ask mode',
              };
            }
            const typeName = typeof sub?.typeName === 'string' ? sub.typeName.trim() : '';
            if (!typeName || !this.isReadOnlySubagent(ctx, typeName)) {
              return {
                toolCallId: toolCtx.toolCall.id,
                isError: true,
                output: `Subagent type '${typeName || 'unknown'}' is not permitted in 'ask' mode (read-only). Only read-only subagents (e.g. 'researcher', 'architect') are allowed.`,
                summary: `Blocked subagent '${typeName || 'unknown'}' in ask mode`,
              };
            }
          }
        }
      }
    }

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

    // 2.5. Strict orchestration mode guardrails (coordinator must delegate direct read/write/exec tools)
    if (
      this.isStrictOrchestrationActive(ctx) &&
      this.strictOrchestrationBlockedTools.has(toolCtx.canonicalToolName)
    ) {
      const delegateTarget =
        toolCtx.canonicalToolName === 'read_file' ||
        toolCtx.canonicalToolName === 'list_files' ||
        toolCtx.canonicalToolName === 'search_files'
          ? 'typeName: "researcher" (read-only codebase exploration)'
          : toolCtx.canonicalToolName === 'write_file' ||
              toolCtx.canonicalToolName === 'edit_file'
            ? 'typeName: "coder" (code implementation & file edits)'
            : 'typeName: "reviewer" (running test suites & verification) or "coder" (build/fix commands)';

      return {
        toolCallId: toolCtx.toolCall.id,
        isError: true,
        output: `Tool '${toolCtx.toolCall.name}' is disabled for the primary coordinator in strict orchestration mode. Delegate this work via invoke_subagent using ${delegateTarget}.`,
        summary: `Blocked in strict orchestration mode: ${toolCtx.toolCall.name}`,
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
