import type { ToolDefinition, ToolResult, JSONSchemaProperty } from '@harni/types';
import { McpClient } from './mcpClient.js';
import type { McpServerConfig, McpServerStatus, McpToolInfo, McpToolResult } from './mcpTypes.js';

/** Namespace prefix for MCP-sourced tools exposed to the LLM. */
const MCP_TOOL_PREFIX = 'mcp__';

/** Internal registry entry combining definition + routing metadata. */
interface McpToolEntry {
  definition: ToolDefinition;
  serverName: string;
  toolName: string;
  requiresApproval: boolean;
}

export interface McpManagerConnectResult {
  connected: string[];
  failed: Array<{ name: string; error: string }>;
}

export interface McpManagerOptions {
  workspaceRoot?: string;
}

/**
 * Owns the lifecycle of all configured MCP servers and exposes their tools
 * to the Agent engine under prefixed names (`mcp__<server>__<tool>`).
 */
export class McpServerManager {
  private workspaceRoot?: string;
  private configs = new Map<string, McpServerConfig>();
  private clients = new Map<string, McpClient>();
  private tools = new Map<string, McpToolEntry>();
  private serverErrors = new Map<string, string>();

  constructor(options: McpManagerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot;
  }

  public getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  /** Sanitize a server/tool name so it can safely be embedded in a tool name. */
  private sanitizeSegment(segment: string): string {
    return segment.replace(/[^A-Za-z0-9_-]/g, '_');
  }

  /** Build the qualified tool name: `mcp__<server>__<tool>`. */
  private buildQualifiedName(serverName: string, toolName: string): string {
    return `${MCP_TOOL_PREFIX}${this.sanitizeSegment(serverName)}__${this.sanitizeSegment(toolName)}`;
  }

  /**
   * (Re)connect all servers defined in the config, refreshing the tool registry.
   * Servers that fail to start are reported but do not abort the others.
   */
  public async connectAll(
    servers: Record<string, McpServerConfig>,
    workspaceRoot?: string,
  ): Promise<McpManagerConnectResult> {
    if (workspaceRoot) this.workspaceRoot = workspaceRoot;

    // Disconnect servers that were removed from the config.
    for (const [name, client] of this.clients) {
      if (!servers[name]) {
        await client.stop();
        this.clients.delete(name);
      }
    }

    this.configs.clear();
    this.tools.clear();
    this.serverErrors.clear();

    const connected: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const [serverName, config] of Object.entries(servers)) {
      this.configs.set(serverName, config);

      if (config.disabled) {
        const existing = this.clients.get(serverName);
        if (existing) {
          await existing.stop();
          this.clients.delete(serverName);
        }
        continue;
      }

      try {
        const client = new McpClient(serverName, {
          ...config,
          cwd: config.cwd ?? this.workspaceRoot,
        });
        await client.start();
        const mcpTools = await client.listTools();

        this.clients.set(serverName, client);

        for (const tool of mcpTools) {
          this.registerTool(client, tool, config);
        }
        connected.push(serverName);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.serverErrors.set(serverName, errMsg);
        failed.push({
          name: serverName,
          error: errMsg,
        });
      }
    }

    return { connected, failed };
  }

  private registerTool(
    client: McpClient,
    tool: McpToolInfo,
    config: McpServerConfig,
  ): void {
    if (!tool.name || !tool.description) {
      console.warn(
        `[Mcp:${client.serverName}] Skipping tool without name/description: ${tool.name ?? '(unnamed)'}`,
      );
      return;
    }

    const qualifiedName = this.buildQualifiedName(client.serverName, tool.name);
    const requiresApproval =
      config.requiresApproval !== undefined ? config.requiresApproval : true;

    const definition: ToolDefinition = {
      name: qualifiedName,
      description: `[MCP:${client.serverName}] ${tool.description}`,
      parameters: {
        type: 'object',
        properties:
          (tool.inputSchema?.properties as Record<string, JSONSchemaProperty>) || {},
        required: tool.inputSchema?.required,
      },
      requiresApproval,
    };

    this.tools.set(qualifiedName, {
      definition,
      serverName: client.serverName,
      toolName: tool.name,
      requiresApproval,
    });
  }

  /** All MCP tool definitions available to the Agent. */
  public getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.definition);
  }

  /** Look up one MCP tool definition by its qualified name. */
  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /** Approval requirement for a qualified tool (inherits from server config). */
  public getToolRequiresApproval(name: string): boolean {
    return this.tools.get(name)?.requiresApproval ?? false;
  }

  /** Execute an MCP tool by its qualified name. */
  public async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const entry = this.tools.get(name);
    if (!entry) {
      return {
        toolCallId: '',
        isError: true,
        output: `Unknown MCP tool: '${name}'. Available: ${Array.from(this.tools.keys()).join(', ')}`,
        summary: `Unknown MCP tool ${name}`,
      };
    }

    const client = this.clients.get(entry.serverName);
    if (!client || !client.isRunning) {
      return {
        toolCallId: '',
        isError: true,
        output: `MCP server '${entry.serverName}' is not running. Please check the server configuration.`,
        summary: `Mcp server ${entry.serverName} offline`,
      };
    }

    try {
      const result = await client.callTool(entry.toolName, args ?? {});
      const text = this.formatToolResult(result);
      return {
        toolCallId: '',
        isError: result.isError === true,
        output: text,
        summary: `MCP ${entry.serverName}.${entry.toolName}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `MCP tool '${entry.serverName}.${entry.toolName}' failed: ${message}`,
        summary: `Error invoking ${entry.serverName}.${entry.toolName}`,
      };
    }
  }

  /** Flatten an MCP tool result into a text-formatted ToolResult.output. */
  private formatToolResult(result: McpToolResult): string {
    const content = result.content as
      | Array<{ type: string; text?: string; data?: string } | string>
      | undefined;

    if (Array.isArray(content) && content.length > 0) {
      const parts = content.map((item) => {
        if (typeof item === 'string') return item;
        if (item.text) return item.text;
        if (item.type === 'image' && item.data) {
          return `[Image data (${item.data.length} bytes)]`;
        }
        return JSON.stringify(item);
      });
      return parts.filter(Boolean).join('\n');
    }

    if (result.structuredContent !== undefined) {
      return JSON.stringify(result.structuredContent, null, 2);
    }

    return JSON.stringify(result, null, 2);
  }

  /** Per-server connection status snapshot. */
  public getStatus(): McpServerStatus[] {
    const statuses: McpServerStatus[] = [];
    for (const [name, config] of this.configs) {
      if (config.disabled) {
        statuses.push({
          name,
          status: 'disconnected',
          toolCount: 0,
        });
        continue;
      }

      const client = this.clients.get(name);
      if (client && client.isRunning) {
        statuses.push({
          name,
          status: 'connected',
          toolCount: Array.from(this.tools.values()).filter((t) => t.serverName === name).length,
        });
      } else {
        const err = this.serverErrors.get(name) || (client ? client.getStderrTail() : undefined);
        statuses.push({
          name,
          status: this.serverErrors.has(name) ? 'error' : (client ? 'disconnected' : 'error'),
          toolCount: 0,
          error: err || (client ? undefined : '連線失敗或未啟動'),
        });
      }
    }
    return statuses;
  }

  /** Whether any MCP server is currently connected. */
  public get hasConnectedServers(): boolean {
    return this.clients.size > 0;
  }

  /** Shut down all child processes and clear the registry. */
  public async disconnectAll(): Promise<void> {
    const stops = Array.from(this.clients.values()).map((client) => client.stop());
    await Promise.allSettled(stops);
    this.clients.clear();
    this.configs.clear();
    this.tools.clear();
    this.serverErrors.clear();
  }
}