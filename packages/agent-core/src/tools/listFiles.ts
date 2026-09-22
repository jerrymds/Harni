import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import type { ListFilesParams, ToolParametersSchema, ToolResult } from '@harni/types';

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  '.turbo',
  'dist',
  'build',
  '.next',
  '.cache',
]);

export class ListFilesTool extends BaseTool<ListFilesParams> {
  public readonly name = 'list_files';
  public readonly description =
    'List files and subdirectories in a given directory path within the workspace.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path relative to workspace root (defaults to ".").',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list subdirectories recursively (defaults to true).',
      },
    },
  };

  public async execute(
    params: ListFilesParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const targetRelPath = params.path || '.';
      const safeDir = this.resolveSafePath(targetRelPath, context.workspaceRoot);
      const isRecursive = params.recursive ?? true;

      const entries: string[] = [];

      const walk = async (currentDir: string, relativePrefix: string, depth = 0) => {
        if (depth > 10) return; // guard against deep recursion
        const dirents = await fs.readdir(currentDir, { withFileTypes: true });

        for (const dirent of dirents) {
          if (DEFAULT_IGNORES.has(dirent.name)) continue;

          const relPath = path.join(relativePrefix, dirent.name).replace(/\\/g, '/');
          if (dirent.isDirectory()) {
            entries.push(`${relPath}/`);
            if (isRecursive) {
              await walk(path.join(currentDir, dirent.name), relPath, depth + 1);
            }
          } else {
            entries.push(relPath);
          }
        }
      };

      await walk(safeDir, '');

      return {
        toolCallId: '',
        isError: false,
        output: entries.length > 0 ? entries.join('\n') : '(empty directory)',
        summary: `Found ${entries.length} items in ${targetRelPath}`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to list files in '${params.path || '.'}': ${errorMsg}`,
      };
    }
  }
}
