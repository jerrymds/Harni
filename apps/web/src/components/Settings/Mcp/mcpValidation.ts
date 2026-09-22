import type { McpServerEntry } from './McpEditModal.js';

export interface McpValidationInput {
  id: string;
  isEditing: boolean;
  oldId?: string;
  existingIds: string[];
  transport: 'stdio' | 'sse';
  command: string;
  args: string[];
  serverUrl: string;
  cwd: string;
  requiresApproval: boolean;
  disabled?: boolean;
  envList: Array<{ key: string; value: string }>;
}

export interface McpValidationResult {
  isValid: boolean;
  error: string | null;
  cleanId?: string;
  config?: McpServerEntry;
}

export function cleanServerId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

export function validateAndBuildMcpServer(input: McpValidationInput): McpValidationResult {
  const cleanId = cleanServerId(input.id);
  if (!cleanId) {
    return {
      isValid: false,
      error: '請輸入合法的伺服器識別名稱',
    };
  }

  if (!input.isEditing && input.existingIds.includes(cleanId)) {
    return {
      isValid: false,
      error: `已存在同名的伺服器「${cleanId}」，請使用其他名稱`,
    };
  }

  if (input.isEditing && input.oldId && cleanId !== input.oldId && input.existingIds.includes(cleanId)) {
    return {
      isValid: false,
      error: `已存在同名的伺服器「${cleanId}」，請使用其他名稱`,
    };
  }

  const newConfig: McpServerEntry = {
    requiresApproval: input.requiresApproval,
    disabled: input.disabled ?? false,
  };

  if (input.transport === 'sse') {
    const trimmedUrl = input.serverUrl.trim();
    if (!trimmedUrl) {
      return {
        isValid: false,
        error: '請輸入 SSE 伺服器端點 URL',
      };
    }
    newConfig.serverUrl = trimmedUrl;
  } else {
    const trimmedCommand = input.command.trim();
    if (!trimmedCommand) {
      return {
        isValid: false,
        error: '請輸入欲執行的指令 (Command)',
      };
    }
    newConfig.command = trimmedCommand;

    if (input.args.length > 0) {
      newConfig.args = [...input.args];
    }

    if (input.cwd.trim()) {
      newConfig.cwd = input.cwd.trim();
    }

    const envMap: Record<string, string> = {};
    for (const item of input.envList) {
      const k = item.key.trim();
      if (k) {
        envMap[k] = item.value;
      }
    }

    if (Object.keys(envMap).length > 0) {
      newConfig.env = envMap;
    }
  }

  return {
    isValid: true,
    error: null,
    cleanId,
    config: newConfig,
  };
}
