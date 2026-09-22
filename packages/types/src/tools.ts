/**
 * Supported built-in tool names
 */
export type BuiltInToolName =
  | 'read_file'
  | 'write_to_file'
  | 'replace_file_content'
  | 'list_files'
  | 'search_files'
  | 'execute_command'
  | 'browser_action'
  | 'mcp_call'
  | 'use_skill'
  | 'ask_question';

/**
 * JSON Schema parameter definition for Tool calling
 */
export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: unknown;
}

export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * Tool Definition provided to LLM
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  requiresApproval?: boolean;
}

/**
 * Incoming Tool Call request emitted by the Agent LLM
 */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  requiresApproval: boolean;
}

/**
 * Execution result of a Tool
 */
export interface ToolResult {
  toolCallId: string;
  isError?: boolean;
  output: string | Record<string, unknown> | unknown[];
  summary?: string;
}

/**
 * Specific parameter types for Built-in Tools
 */
export interface ReadFileParams {
  path: string;
}

export interface WriteFileParams {
  path: string;
  content: string;
}

export interface ReplaceFileContentParams {
  path: string;
  targetContent: string;
  replacementContent: string;
}

export interface ListFilesParams {
  path?: string;
  recursive?: boolean;
}

export interface SearchFilesParams {
  query: string;
  path?: string;
  isRegex?: boolean;
}

export interface ExecuteCommandParams {
  command: string;
  cwd?: string;
}

export interface AskQuestionParams {
  question: string;
  options?: string[];
  is_multi_select?: boolean;
  allow_custom_input?: boolean;
}

