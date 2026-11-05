import type { ToolParametersSchema, ToolResult } from '@harni/types';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';

export interface InvokeSubagentParams {
  subagents: Array<{
    typeName: string;
    role: string;
    prompt: string;
    model?: string;
    background?: boolean;
    maxTokensBudget?: number;
    timeoutMs?: number;
    isolation?: 'inherit' | 'worktree';
    autoMergeWorktree?: boolean;
  }>;
}

export class InvokeSubagentTool extends BaseTool<InvokeSubagentParams> {
  public readonly name = 'invoke_subagent';
  public readonly description =
    'Invokes one or more specialized subagents concurrently with isolated context windows to execute complex subtasks (e.g. researcher, coder, reviewer, architect). Each subagent runs independently and reports back.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      subagents: {
        type: 'array',
        description: 'List of subagents to spawn and execute concurrently.',
        items: {
          type: 'object',
          properties: {
            typeName: {
              type: 'string',
              description:
                'Archetype of subagent: "researcher" (read-only codebase exploration), "coder" (code implementation & file edits), "reviewer" (testing & code review), "architect" (system design & planning), or "self" (general purpose).',
            },
            role: {
              type: 'string',
              description: 'Brief role description, e.g. "Codebase Researcher", "Vitest Runner".',
            },
            prompt: {
              type: 'string',
              description: 'Clear, actionable instructions and objectives for this subagent.',
            },
            model: {
              type: 'string',
              description: 'Optional model override for this subagent.',
            },
            background: {
              type: 'boolean',
              description:
                'If true, launches the subagent asynchronously in the background and returns its ID immediately without waiting for completion.',
            },
            maxTokensBudget: {
              type: 'number',
              description: 'Optional maximum total token budget for this subagent.',
            },
            timeoutMs: {
              type: 'number',
              description: 'Optional wall-clock timeout in milliseconds for this subagent.',
            },
            isolation: {
              type: 'string',
              enum: ['inherit', 'worktree'],
              description:
                'Workspace isolation mode: "inherit" (default, shares parent workspace) or "worktree" (creates an isolated Git worktree for safe parallel file modifications).',
            },
            autoMergeWorktree: {
              type: 'boolean',
              description:
                'If isolation is "worktree", whether to automatically merge changes back into the parent workspace upon successful completion (default: true).',
            },
          },
          required: ['typeName', 'role', 'prompt'],
        },
      },
    },
    required: ['subagents'],
  };

  public async execute(
    params: InvokeSubagentParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!context.subagentManager) {
      return {
        toolCallId: '',
        isError: true,
        output: 'Subagent orchestration is not enabled or available in this execution context.',
        summary: 'SubagentManager not found',
      };
    }

    if (!params.subagents || params.subagents.length === 0) {
      return {
        toolCallId: '',
        isError: true,
        output: 'No subagents provided to invoke_subagent.',
        summary: 'Empty subagent list',
      };
    }

    const spawnParams = params.subagents.map((s) => ({
      typeName: s.typeName,
      role: s.role,
      prompt: s.prompt,
      sessionId: context.sessionId || 'default',
      parentId: context.taskId || 'parent',
      workspaceRoot: context.workspaceRoot,
      depth: (context.depth ?? 0) + 1,
      model: s.model,
      parentModel: context.model,
      provider: context.provider,
      apiKey: context.apiKey,
      baseURL: context.baseURL,
      parentSignal: context.parentSignal,
      onFileDiff: context.onFileDiff,
      onDiagnostics: context.onDiagnostics,
      onTerminalData: context.onTerminalData,
      onCodeModified: context.onCodeModified,
      anthropicOAuth: context.anthropicOAuth,
      openaiOAuth: context.openaiOAuth,
      openaiAccountId: context.openaiAccountId,
      background: s.background,
      maxTokensBudget: s.maxTokensBudget,
      timeoutMs: s.timeoutMs,
      isolation: s.isolation,
      autoMergeWorktree: s.autoMergeWorktree,
    }));

    try {
      const results = await context.subagentManager.spawnSubagents(spawnParams);

      const summaries = results.map((r, i) => {
        const isBg = r.background || r.status === 'pending' || r.status === 'running';
        const statusEmoji = isBg ? '⏳' : r.status === 'completed' ? '✅' : '❌';
        const statusLabel = isBg ? `${r.status} (Background)` : r.status;
        let meta = `### Subagent [${i + 1}]: ${r.role} (${r.typeName})\n- **ID**: \`${r.id}\`\n- **Status**: ${statusEmoji} ${statusLabel}\n- **Duration**: ${r.durationMs}ms\n- **Tool Calls**: ${r.toolCallCount}`;
        if (r.worktreeBranch || r.worktreePath) {
          meta += `\n- **Worktree**: \`${r.worktreeBranch || ''}\` (${r.worktreePath || ''})${r.worktreeMerged ? ' [Merged]' : ''}`;
        }
        if (r.structuredReport?.modifiedFiles && r.structuredReport.modifiedFiles.length > 0) {
          meta += `\n- **Modified Files**: ${r.structuredReport.modifiedFiles.map((f) => `\`${f}\``).join(', ')}`;
        }
        return `${meta}\n\n**Report / Output**:\n${r.result}`;
      });

      const output = summaries.join('\n\n---\n\n');
      const bgCount = results.filter((r) => r.background).length;
      const completedCount = results.filter((r) => r.status === 'completed').length;
      return {
        toolCallId: '',
        output,
        summary: bgCount > 0
          ? `Spawned ${results.length} subagent(s) (${completedCount} completed, ${bgCount} background)`
          : `Executed ${results.length} subagent(s) (${completedCount} succeeded)`,
      };
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to execute subagents: ${errMessage}`,
        summary: 'Error executing subagents',
      };
    }
  }
}
