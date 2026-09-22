import * as fs from 'node:fs/promises';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import type { ReadFileParams, ToolParametersSchema, ToolResult } from '@harni/types';

export class ReadFileTool extends BaseTool<ReadFileParams> {
  public readonly name = 'read_file';
  public readonly description =
    'Read the contents of a file within the workspace. Returns the file content with line numbers.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative or absolute path of the file to read.',
      },
    },
    required: ['path'],
  };

  public async execute(
    params: ReadFileParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      if (!params.path) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Missing required parameter: path',
        };
      }

      const safePath = this.resolveSafePath(params.path, context.workspaceRoot);
      const stat = await fs.stat(safePath);
      const MAX_READ_SIZE = 2 * 1024 * 1024; // 2 MB
      if (stat.size > MAX_READ_SIZE) {
        return {
          toolCallId: '',
          isError: true,
          output: `檔案過大 (${(stat.size / (1024 * 1024)).toFixed(2)} MB)，超過讀取上限 2 MB。請使用 terminal 檢視部分內容。`,
        };
      }

      const buf = await fs.readFile(safePath);
      // Check for binary content
      const checkLen = Math.min(buf.length, 1024);
      for (let i = 0; i < checkLen; i++) {
        if (buf[i] === 0) {
          return {
            toolCallId: '',
            isError: true,
            output: `無法讀取二進位或編譯檔案 '${params.path}'。`,
          };
        }
      }

      const rawContent = buf.toString('utf-8');

      // Add line numbers for surgical replacement reference
      const lines = rawContent.split('\n');
      const MAX_LINES = 2500;
      let displayLines = lines;
      let truncatedNotice = '';

      if (lines.length > MAX_LINES) {
        displayLines = lines.slice(0, MAX_LINES);
        truncatedNotice = `\n...[檔案過長 (共 ${lines.length} 行)，僅顯示前 ${MAX_LINES} 行以防止 Token 耗盡]...`;
      }

      const numberedContent =
        displayLines
          .map((line: string, idx: number) => `${String(idx + 1).padStart(4, ' ')} | ${line}`)
          .join('\n') + truncatedNotice;

      return {
        toolCallId: '',
        isError: false,
        output: numberedContent,
        summary: `Read ${displayLines.length} lines from ${params.path}${lines.length > MAX_LINES ? ' (truncated)' : ''}`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to read file '${params.path}': ${errorMsg}`,
      };
    }

  }
}
