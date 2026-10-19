import * as fs from 'node:fs/promises';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import { SyntaxLinterService } from '../diagnostics/syntaxLinterService.js';
import type {
  ReplaceFileContentParams,
  ToolParametersSchema,
  ToolResult,
} from '@harni/types';

export class ReplaceFileContentTool extends BaseTool<ReplaceFileContentParams> {
  public readonly name = 'replace_file_content';
  public readonly description =
    'Replace a specific target block or line of text within an existing file with replacement text.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path of the file to modify.',
      },
      targetContent: {
        type: 'string',
        description: 'The exact string/block to be replaced in the file.',
      },
      replacementContent: {
        type: 'string',
        description: 'The new replacement string/block.',
      },
    },
    required: ['path', 'targetContent', 'replacementContent'],
  };

  public async execute(
    params: ReplaceFileContentParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const {
        path: filePath,
        targetContent,
        replacementContent,
        allowMultiple,
        replacementChunks,
      } = params;

      const chunks =
        Array.isArray(replacementChunks) && replacementChunks.length > 0
          ? replacementChunks
          : targetContent !== undefined && replacementContent !== undefined
            ? [{ targetContent, replacementContent, allowMultiple }]
            : [];

      if (!filePath || chunks.length === 0) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Missing required parameters: path, targetContent, replacementContent',
        };
      }

      const safePath = this.resolveSafePath(filePath, context.workspaceRoot);
      const originalContent = await fs.readFile(safePath, 'utf-8');
      let newContent = originalContent;

      for (const chunk of chunks) {
        if (!chunk.targetContent && chunk.targetContent !== '') {
          return {
            toolCallId: '',
            isError: true,
            output: 'Missing required parameters: path, targetContent, replacementContent',
          };
        }

        const occurrences = newContent.split(chunk.targetContent).length - 1;
        if (occurrences === 0) {
          return {
            toolCallId: '',
            isError: true,
            output: `Target content not found in '${filePath}'. Make sure whitespace and line breaks match exactly.`,
          };
        }

        const canReplaceMultiple = Boolean(chunk.allowMultiple ?? allowMultiple);
        if (occurrences > 1 && !canReplaceMultiple) {
          return {
            toolCallId: '',
            isError: true,
            output: `Target content matched ${occurrences} times in '${filePath}'. Please provide more surrounding context to make the targetContent unique.`,
          };
        }

        if (canReplaceMultiple) {
          newContent = newContent.split(chunk.targetContent).join(chunk.replacementContent);
        } else {
          newContent = newContent.replace(chunk.targetContent, () => chunk.replacementContent);
        }
      }

      if (context.onFileDiff) {
        context.onFileDiff({
          path: filePath,
          originalContent,
          newContent,
          isNewFile: false,
        });
      }

      await fs.writeFile(safePath, newContent, 'utf-8');

      let output = `Successfully replaced target content in '${filePath}'.`;

      // Instant Syntax & Linter Diagnostics Feedback
      try {
        const diagResult = await SyntaxLinterService.diagnoseFile({
          filePath: safePath,
          workspaceRoot: context.workspaceRoot,
          content: newContent,
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
        // Non-blocking for replacement
      }

      return {
        toolCallId: '',
        isError: false,
        output,
        summary: `Modified ${filePath}`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to replace content in '${params.path}': ${errorMsg}`,
      };
    }
  }
}
