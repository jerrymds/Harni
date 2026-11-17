import type { ChatMessage, ToolParametersSchema, ToolResult } from '@harni/types';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';

export interface SwarmToolParams {
  action: 'title' | 'add' | 'post' | 'read' | 'status' | 'kill';
  title?: string;
  name?: string;
  brief?: string;
  message?: string;
  typeName?: string;
  model?: string;
  fork?: string;
  workspace?: 'inherit' | 'worktree';
  autoMergeWorktree?: boolean;
  n?: number;
  tasks?: string[];
  maxTokensBudget?: number;
  timeoutMs?: number;
  limit?: number;
  sinceId?: string;
}

export class SwarmTool extends BaseTool<SwarmToolParams> {
  public readonly name = 'swarm';
  public readonly description =
    'Collaborate with a swarm of peer subagents on a shared message board. Actions: "title" (name the swarm), "add" (spawn worker(s) with optional tasks sharding, n copies, fork context, or worktree isolation), "post" (post a message with optional @mentions to notify peers or @coordinator), "read" (read board messages), "status" (view members and board state), "kill" (terminate a worker).';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['title', 'add', 'post', 'read', 'status', 'kill'],
        description: 'Swarm action to perform.',
      },
      title: {
        type: 'string',
        description: 'Swarm title (for action="title").',
      },
      name: {
        type: 'string',
        description:
          'Short lowercase member name (for action="add" or "kill"). Base name when "n" or "tasks" is set.',
      },
      brief: {
        type: 'string',
        description: 'Assignment brief for new worker(s) (for action="add").',
      },
      message: {
        type: 'string',
        description:
          'Message text to post to the shared board (for action="post"). Use @name or @coordinator or @all to notify.',
      },
      typeName: {
        type: 'string',
        description:
          'Subagent archetype for new worker(s) (e.g. "researcher", "coder", "reviewer", "architect", or "self"). Defaults to "self".',
      },
      model: {
        type: 'string',
        description: 'Optional model override for new worker(s).',
      },
      fork: {
        type: 'string',
        description:
          'Optional source to fork conversation history from: "coordinator", an existing member name, or a subagentId.',
      },
      workspace: {
        type: 'string',
        enum: ['inherit', 'worktree'],
        description:
          'Workspace isolation mode for new worker(s): "inherit" (default) or "worktree" (isolated Git worktree).',
      },
      autoMergeWorktree: {
        type: 'boolean',
        description: 'Whether to auto-merge worktree changes on completion (default: true).',
      },
      n: {
        type: 'number',
        description: 'Number of homogeneous copies (<name>-1 .. <name>-n) for action="add".',
      },
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Per-worker slice targets (<name>-1 .. <name>-k), each combined with "brief" for action="add".',
      },
      maxTokensBudget: {
        type: 'number',
        description: 'Optional token budget per worker.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional wall-clock timeout in ms per worker.',
      },
      limit: {
        type: 'number',
        description: 'Max messages to return (for action="read").',
      },
      sinceId: {
        type: 'string',
        description: 'Return messages after this message ID (for action="read").',
      },
    },
    required: ['action'],
  };

  public async execute(
    params: SwarmToolParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const board = context.swarmBoardService;
    if (!board) {
      return {
        toolCallId: '',
        isError: true,
        output: 'SwarmBoardService is not available in this execution context.',
      };
    }

    const sessionId = context.sessionId || 'default';
    const sender = context.agentAlias || 'coordinator';

    if (params.action === 'title') {
      if (context.agentAlias) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Only the coordinator may set the swarm title.',
        };
      }
      if (!params.title || !params.title.trim()) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Parameter "title" is required for action="title".',
        };
      }
      const state = board.setTitle(sessionId, params.title);
      return {
        toolCallId: '',
        output: `Swarm title set to "${state.title}".`,
        summary: `Swarm title: ${state.title}`,
      };
    }

    if (params.action === 'status') {
      const state = board.getBoardState(sessionId);
      return {
        toolCallId: '',
        output: JSON.stringify(
          {
            title: state.title || '(untitled)',
            memberCount: state.members.length,
            members: state.members.map((m) => ({
              name: m.name,
              subagentId: m.subagentId,
              typeName: m.typeName,
              status: m.status,
              model: m.model,
              addedBy: m.addedBy,
              workspaceIsolation: m.workspaceIsolation,
              forkedFrom: m.forkedFrom,
            })),
            messageCount: state.messages.length,
          },
          null,
          2,
        ),
        summary: `Swarm status: ${state.members.length} member(s), ${state.messages.length} message(s)`,
      };
    }

    if (params.action === 'read') {
      const messages = board.getMessages(sessionId, {
        limit: params.limit ?? 30,
        sinceId: params.sinceId,
      });
      return {
        toolCallId: '',
        output: JSON.stringify(messages, null, 2),
        summary: `Read ${messages.length} swarm message(s)`,
      };
    }

    if (params.action === 'post') {
      const content = params.message ?? params.brief;
      if (!content || !content.trim()) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Parameter "message" is required for action="post".',
        };
      }
      const posted = board.postMessage({
        sessionId,
        sender,
        senderSubagentId: context.agentAlias ? context.taskId : undefined,
        content: content.trim(),
      });
      return {
        toolCallId: '',
        output: JSON.stringify(posted, null, 2),
        summary: `Posted swarm message (${posted.mentions.length} mention(s))`,
      };
    }

    if (params.action === 'kill') {
      if (!params.name || !params.name.trim()) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Parameter "name" is required for action="kill".',
        };
      }
      const member = board.resolveMember(sessionId, params.name.trim());
      if (!member) {
        return {
          toolCallId: '',
          isError: true,
          output: `Swarm member '${params.name}' not found.`,
        };
      }
      if (context.agentAlias && member.addedBy !== context.agentAlias) {
        return {
          toolCallId: '',
          isError: true,
          output: `Permission denied: worker '${context.agentAlias}' can only kill helpers it added (addedBy='${member.addedBy}').`,
        };
      }
      context.subagentManager?.killSubagent(member.subagentId, sessionId);
      board.updateMemberStatus(sessionId, member.subagentId, 'cancelled');
      return {
        toolCallId: '',
        output: `Swarm member '${member.name}' (${member.subagentId}) terminated.`,
        summary: `Killed swarm member ${member.name}`,
      };
    }

    // action === 'add'
    if (!context.subagentManager) {
      return {
        toolCallId: '',
        isError: true,
        output: 'SubagentManager is not available in this execution context.',
      };
    }
    if (!params.name || !params.name.trim()) {
      return {
        toolCallId: '',
        isError: true,
        output: 'Parameter "name" is required for action="add".',
      };
    }
    if (!params.brief || !params.brief.trim()) {
      return {
        toolCallId: '',
        isError: true,
        output: 'Parameter "brief" is required for action="add".',
      };
    }

    const baseName = params.name.trim().toLowerCase().replace(/\s+/g, '-');
    const brief = params.brief.trim();
    const typeName = params.typeName?.trim() || 'self';
    const isolation: 'inherit' | 'worktree' =
      params.workspace === 'worktree' ? 'worktree' : 'inherit';

    let initialMessages: ChatMessage[] | undefined;
    if (params.fork) {
      initialMessages = context.resolveForkMessages?.(params.fork);
      if (!initialMessages) {
        return {
          toolCallId: '',
          isError: true,
          output: `Fork source '${params.fork}' was not found or has no conversation history.`,
        };
      }
    }

    const workers: Array<{ workerName: string; prompt: string }> = [];
    if (params.tasks && params.tasks.length > 0) {
      params.tasks.forEach((slice, idx) => {
        workers.push({
          workerName: `${baseName}-${idx + 1}`,
          prompt: `${brief}\n\n[Assigned Slice ${idx + 1}/${params.tasks!.length}]:\n${slice}`,
        });
      });
    } else if (params.n && params.n > 1) {
      const count = Math.floor(params.n);
      for (let i = 1; i <= count; i++) {
        workers.push({
          workerName: `${baseName}-${i}`,
          prompt: `${brief}\n\n[Worker Copy ${i}/${count}]`,
        });
      }
    } else {
      workers.push({ workerName: baseName, prompt: brief });
    }

    for (const w of workers) {
      const existing = board.resolveMember(sessionId, w.workerName);
      if (
        existing &&
        (existing.status === 'pending' ||
          existing.status === 'running' ||
          existing.status === 'waiting_for_input')
      ) {
        return {
          toolCallId: '',
          isError: true,
          output: `Swarm member '${w.workerName}' is already active (status: ${existing.status}).`,
        };
      }
    }

    const spawnParams = workers.map((w) => ({
      typeName,
      role: w.workerName,
      alias: w.workerName,
      prompt: `${w.prompt}\n\n[Swarm Collaboration]: You are swarm member "${w.workerName}" (added by "${sender}"). Use the \`swarm\` tool (post/read/status) to coordinate with peers or @${sender}.`,
      sessionId,
      parentId: context.taskId || 'parent',
      workspaceRoot: context.workspaceRoot,
      depth: (context.depth ?? 0) + 1,
      model: params.model,
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
      background: true,
      maxTokensBudget: params.maxTokensBudget,
      timeoutMs: params.timeoutMs,
      isolation,
      autoMergeWorktree: params.autoMergeWorktree,
      forkedFrom: params.fork,
      initialMessages,
      swarmEnabled: true,
      swarmBoardService: board,
      getSessionMessages: context.getSessionMessages,
    }));

    const results = await context.subagentManager.spawnSubagents(spawnParams);
    const registered: Array<{ name: string; subagentId: string; status: string }> = [];

    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      const res = results[i];
      if (!res || res.id.startsWith('failed_')) {
        return {
          toolCallId: '',
          isError: true,
          output: `Failed to spawn swarm worker '${w.workerName}': ${res?.error || res?.result || 'Unknown error'}`,
        };
      }
      board.registerMember(sessionId, {
        name: w.workerName,
        subagentId: res.id,
        role: w.workerName,
        typeName,
        model: params.model,
        status: res.status,
        addedBy: sender,
        workspaceIsolation: isolation,
        forkedFrom: params.fork,
      });
      // Publicly record the brief on the board without @mentioning the newly spawned worker itself
      board.postMessage({
        sessionId,
        sender,
        senderSubagentId: context.agentAlias ? context.taskId : undefined,
        content: `[Assigned to ${w.workerName}] ${w.prompt}`,
      });
      registered.push({ name: w.workerName, subagentId: res.id, status: res.status });
    }

    return {
      toolCallId: '',
      output: JSON.stringify(registered, null, 2),
      summary: `Added ${registered.length} swarm worker(s): ${registered.map((r) => r.name).join(', ')}`,
    };
  }
}
