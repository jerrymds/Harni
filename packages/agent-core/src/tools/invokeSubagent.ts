import type { ToolParametersSchema, ToolResult } from '@harni/types';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';

export interface InvokeSubagentParams {
  subagents: Array<{
    typeName: string;
    role: string;
    prompt: string;
    model?: string;
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
                'Archetype of subagent. Recommended: "agy-worker" (autonomous implementation via Antigravity CLI), "agy-researcher" (codebase & architecture exploration via Antigravity CLI), "agy-tester" (test & repair via Antigravity CLI), or "researcher", "coder", "reviewer", "architect", "self".',
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
      model: s.model || (s.typeName.toLowerCase().startsWith('agy') ? undefined : context.model),
      provider: context.provider,
      apiKey: context.apiKey,
      baseURL: context.baseURL,
    }));

    try {
      const results = await context.subagentManager.spawnSubagents(spawnParams);

      const summaries = results.map((r, i) => {
        const statusEmoji = r.status === 'completed' ? '✅' : '❌';
        return `### Subagent [${i + 1}]: ${r.role} (${r.typeName})\n- **ID**: \`${r.id}\`\n- **Status**: ${statusEmoji} ${r.status}\n- **Duration**: ${r.durationMs}ms\n- **Tool Calls**: ${r.toolCallCount}\n\n**Report / Output**:\n${r.result}`;
      });

      const output = summaries.join('\n\n---\n\n');
      return {
        toolCallId: '',
        output,
        summary: `Executed ${results.length} subagent(s) (${results.filter((r) => r.status === 'completed').length} succeeded)`,
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
