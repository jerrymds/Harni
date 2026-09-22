import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import { SyntaxLinterService } from '../diagnostics/syntaxLinterService.js';
import type { ToolParametersSchema, ToolResult, WriteFileParams } from '@harni/types';

export class WriteFileTool extends BaseTool<WriteFileParams> {
  public readonly name = 'write_to_file';
  public readonly description =
    'Create a new file or overwrite an existing file with the provided content.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path of the file to write to.',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file.',
      },
    },
    required: ['path', 'content'],
  };

  public async execute(
    params: WriteFileParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      if (!params.path || params.content === undefined) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Missing required parameters: path and content',
        };
      }

      const safePath = this.resolveSafePath(params.path, context.workspaceRoot);
      const parentDir = path.dirname(safePath);
      await fs.mkdir(parentDir, { recursive: true });

      let originalContent = '';
      let isNewFile = true;

      try {
        originalContent = await fs.readFile(safePath, 'utf-8');
        isNewFile = false;
      } catch {
        isNewFile = true;
      }

      // Notify Diff listeners for Monaco Diff Viewer in Web UI
      if (context.onFileDiff) {
        context.onFileDiff({
          path: params.path,
          originalContent,
          newContent: params.content,
          isNewFile,
        });
      }

      await fs.writeFile(safePath, params.content, 'utf-8');

      let output = `Successfully wrote ${params.content.length} characters to ${params.path} (${isNewFile ? 'new file' : 'updated'})`;

      // Instant Syntax & Linter Diagnostics Feedback
      try {
        const diagResult = await SyntaxLinterService.diagnoseFile({
          filePath: safePath,
          workspaceRoot: context.workspaceRoot,
          content: params.content,
        });

        if (diagResult.diagnostics.length > 0) {
          if (context.onDiagnostics) {
            context.onDiagnostics(diagResult);
          }
          if (diagResult.formattedOutput) {
            output += `\n${diagResult.formattedOutput}`;
          }
        }
      } catch {
        // Non-blocking for file writing
      }

      return {
        toolCallId: '',
        isError: false,
        output,
        summary: `Wrote ${params.path}`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to write file '${params.path}': ${errorMsg}`,
      };
    }
  }
}
