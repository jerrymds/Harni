/**
 * MCP (Model Context Protocol) client types.
 * Implements a JSON-RPC 2.0 client over stdio (Content-Length framed messages)
 * without depending on the official SDK.
 */

/** Single MCP server configuration entry (compatible with `mcpServers` in claude/cursor configs). */
export interface McpServerConfig {
  /** Command to spawn (e.g. `npx`) */
  command: string;
  /** Arguments passed to the command (e.g. `['-y', '@modelcontextprotocol/server-github']`) */
  args?: string[];
  /** Environment variables injected into the spawned process (merged over process.env) */
  env?: Record<string, string>;
  /** Override the default approval requirement for this server's tools. Default: true */
  requiresApproval?: boolean;
  /** Optional working directory the server process is spawned in. Default: workspace root */
  cwd?: string;
  /** Timeout in ms for a single `tools/call` request. Default: 120s */
  callTimeoutMs?: number;
  /** Whether this server is temporarily disabled */
  disabled?: boolean;
  /** Optional SSE remote server URL */
  serverUrl?: string;
}

/** Full MCP configuration object as persisted in settings / localStorage. */
export interface McpServersConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** Tool info returned by a server's `tools/list` method. */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** Result of a `tools/call` request. */
export interface McpToolResult {
  content?: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

/** Connection/health status of one MCP server. */
export interface McpServerStatus {
  name: string;
  status: 'connecting' | 'connected' | 'error' | 'disconnected';
  toolCount: number;
  error?: string;
}

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_CLIENT_NAME = 'harni';
export const MCP_CLIENT_VERSION = '0.1.0';