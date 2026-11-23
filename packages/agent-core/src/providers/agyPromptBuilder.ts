import * as crypto from 'node:crypto';
import type { ChatMessage, ToolDefinition } from '@harni/types';

/**
 * Built-in Harni tools that overlap with Antigravity CLI (`agy`) native ACP tools.
 * When `toolPolicy === 'allow'`, `agy` executes its own native file/terminal tools
 * via ACP, so these overlapping definitions are omitted from the text function list.
 */
export const AGY_BUILTIN_OVERLAP_TOOLS = new Set([
  'read_file',
  'write_file',
  'write_to_file',
  'edit_file',
  'replace_file_content',
  'run_command',
  'execute_command',
  'list_files',
  'search_files',
]);

export const ACP_SYNC_EXECUTION_RULE =
  '\n\n[ACP_SYNC_EXECUTION_RULE] When using run_command for builds/tests/checks, set WaitMsBeforeAsync to 10000 to wait synchronously whenever possible. Never finish your turn after launching a command or build check with an interim status message; inspect background task output via manage_task and complete all requested edits before ending your turn.';

export const ACP_HARNI_ORCHESTRATION_RULE_TAG = '[ACP_HARNI_ORCHESTRATION_RULE]';

export interface BuildAgyPromptOptions {
  acpMcpServerName?: string;
  acpMcpToolNames?: ReadonlySet<string> | readonly string[];
  disableSubagents?: boolean;
}

function formatToolOutputText(msg: ChatMessage): string {
  if (typeof msg.toolResult?.output === 'string') {
    return msg.toolResult.output;
  }
  if (msg.toolResult?.output !== undefined) {
    return JSON.stringify(msg.toolResult.output);
  }
  return msg.content ?? '';
}

/**
 * Formats the system preamble and grouped user/tool turns for `agy acp`.
 */
export function buildAgyPromptParts(
  messages: ChatMessage[],
  systemPrompt: string,
  tools: ToolDefinition[],
  toolPolicy: 'allow' | 'deny' = 'allow',
  options?: BuildAgyPromptOptions,
): { preamble: string; turns: string[] } {
  const sections: string[] = [];
  const trimmedSystem = (systemPrompt || '').trim();
  if (trimmedSystem) {
    sections.push(trimmedSystem);
  }

  let effectiveTools: ToolDefinition[];
  if (toolPolicy === 'allow') {
    if (!trimmedSystem.includes('[ACP_SYNC_EXECUTION_RULE]')) {
      sections.push(ACP_SYNC_EXECUTION_RULE.trim());
    }
    sections.push(
      '## Operating mode (ACP Synchronous Execution)\n' +
        'You are running inside an ACP session with native tool execution enabled. ' +
        'When running builds, tests, or checks via `run_command`, set `WaitMsBeforeAsync` to `10000` so commands wait synchronously whenever possible. ' +
        'Never end your turn early with an interim status update while background tasks are still running; inspect output via `manage_task` and complete all requested edits before finishing.',
    );
    effectiveTools = tools.filter((t) => !AGY_BUILTIN_OVERLAP_TOOLS.has(t.name));

    if (options?.acpMcpServerName) {
      const bridgedSet = options.acpMcpToolNames
        ? new Set(options.acpMcpToolNames)
        : null;
      const bridgedTools = effectiveTools.filter(
        (t) => !bridgedSet || bridgedSet.has(t.name),
      );
      if (bridgedTools.length > 0) {
        const bridgedNames = new Set(bridgedTools.map((t) => t.name));
        effectiveTools = effectiveTools.filter((t) => !bridgedNames.has(t.name));

        if (!trimmedSystem.includes(ACP_HARNI_ORCHESTRATION_RULE_TAG)) {
          const serverName = options.acpMcpServerName;
          const mappingLines = bridgedTools.map(
            (t) => `- \`${t.name}\` -> \`mcp_${serverName}_${t.name}\``,
          );
          sections.push(
            `${ACP_HARNI_ORCHESTRATION_RULE_TAG} Harni Orchestration & Tool Bridge:\n` +
              `The following Harni tools are bridged via native MCP server \`${serverName}\`:\n` +
              `${mappingLines.join('\n')}\n\n` +
              `Rules:\n` +
              `- You MUST call the \`mcp_${serverName}_*\` native MCP tools listed above for these capabilities.\n` +
              `- NEVER call CLI built-in \`invoke_subagent\`, \`define_subagent\`, \`manage_subagents\`, \`send_message\`, \`swarm\`, \`schedule\`, or \`ask_question\` (the CLI built-in versions bypass Harni Mission Control, \`modelTierMap\`, and worktree isolation).\n` +
              `- NEVER emit text-formatted \`Calling tool ...\` lines for bridged tools.`,
          );
        }
      }
    }

    if (options?.disableSubagents === true) {
      sections.push(
        '[ACP_SUBAGENT_DISABLED] Subagent orchestration is disabled in this context. NEVER call CLI built-in `invoke_subagent`, `define_subagent`, `manage_subagents`, or `swarm`.',
      );
    }
  } else {
    if (tools.length > 0) {
      sections.push(
        '## Operating mode\n' +
          'Do NOT invoke built-in native tools directly. Instead, emit a text tool invocation line using the exact format `Calling tool \\`<name>\\` with arguments: {...}` for the functions listed under `## Available functions`.',
      );
    } else {
      sections.push(
        '## Operating mode\n' +
          'Respond in plain text conversation only without calling any tools.',
      );
    }
    effectiveTools = tools;
  }

  if (effectiveTools.length > 0) {
    const toolBlocks = effectiveTools.map((t) => {
      const schema = JSON.stringify(t.parameters);
      return `### ${t.name}\n${t.description}\nParameters: ${schema}`;
    });
    sections.push(
      '## Available functions\n' +
        'To call one of these functions, output:\n' +
        'Calling tool `<name>` with arguments: {"key": "value"}\n\n' +
        toolBlocks.join('\n\n'),
    );
  }

  const preamble = sections.join('\n\n');

  const turns: string[] = [];
  let pendingParts: string[] = [];

  const flushPending = (): void => {
    if (pendingParts.length === 0) return;
    const combined = pendingParts.join('\n\n');
    if (combined.trim()) {
      turns.push(combined);
    }
    pendingParts = [];
  };

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content ?? '';
      if (text.trim()) {
        pendingParts.push(text);
      }
    } else if (msg.role === 'tool') {
      const outputText = formatToolOutputText(msg);
      pendingParts.push(`[tool \`${msg.name || 'tool'}\` returned]\n${outputText}`);
    } else if (msg.role === 'assistant') {
      flushPending();
    }
  }
  flushPending();

  return { preamble, turns };
}

/**
 * Prepends earlier conversation history when starting a fresh `agy acp` process
 * mid-conversation (or when history exists prior to the trailing user/tool block).
 */
export function buildAgyCompositePrompt(messages: ChatMessage[], lastTurn: string): string {
  let trailingBlockStart = messages.length;
  while (
    trailingBlockStart > 0 &&
    (messages[trailingBlockStart - 1]!.role === 'user' ||
      messages[trailingBlockStart - 1]!.role === 'tool')
  ) {
    trailingBlockStart--;
  }

  if (trailingBlockStart === messages.length) {
    return lastTurn;
  }

  const priorMessages = messages.slice(0, trailingBlockStart);
  const historyLines: string[] = [];

  for (const msg of priorMessages) {
    if (msg.role === 'user') {
      if (msg.content?.trim()) {
        historyLines.push(`User: ${msg.content}`);
      }
    } else if (msg.role === 'assistant') {
      for (const tc of msg.toolCalls || []) {
        historyLines.push(
          `Assistant: Calling tool \`${tc.name}\` with arguments: ${JSON.stringify(tc.arguments || {})}`,
        );
      }
      if (msg.content?.trim()) {
        historyLines.push(`Assistant: ${msg.content}`);
      }
    } else if (msg.role === 'tool') {
      const outputText = formatToolOutputText(msg);
      historyLines.push(`Tool \`${msg.name || 'tool'}\` returned: ${outputText}`);
    }
  }

  if (historyLines.length > 0) {
    return `## Earlier Conversation History\n${historyLines.join('\n\n')}\n\n## Current Request\n${lastTurn}`;
  }

  return lastTurn;
}

/**
 * Builds a deterministic 24-char SHA-256 hex session key for pooling warm `agy acp` sessions.
 */
export function buildAgySessionKey(options: {
  sessionId?: string;
  subagentId?: string;
  workspaceRoot?: string;
  systemPrompt?: string;
  messages?: ChatMessage[];
}): string {
  const workspace = options.workspaceRoot || '';
  let rawKey: string;

  if (options.sessionId) {
    const subagentPart = options.subagentId ? `\0subagent:${options.subagentId}` : '';
    rawKey = `conv:${options.sessionId}${subagentPart}\0workspace:${workspace}`;
  } else {
    const firstUserMsg = (options.messages || []).find((m) => m.role === 'user');
    const firstUserMsgContent = firstUserMsg?.content ?? '';
    rawKey = `${options.systemPrompt || ''}\0workspace:${workspace}\0first:${firstUserMsgContent}`;
  }

  return crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 24);
}
