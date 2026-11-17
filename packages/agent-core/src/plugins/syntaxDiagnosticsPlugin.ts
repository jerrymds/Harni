import * as path from 'node:path';
import {
  PluginPriority,
  type ToolCallMiddlewareContext,
  type ToolCallNext,
  type ToolResult,
  type WorkflowPlugin,
  type WorkflowPluginCategory,
  type WorkflowPluginContext,
} from '@harni/types';
import { SyntaxLinterService } from '../diagnostics/syntaxLinterService.js';

export class SyntaxDiagnosticsPlugin implements WorkflowPlugin {
  public readonly id = 'harni.syntax-diagnostics';
  public readonly name = 'Syntax & Linter Diagnostics Plugin';
  public readonly description =
    'Provides instant syntax and linter diagnostics feedback on modified code files.';
  public readonly priority = PluginPriority.DIAGNOSTICS;
  public readonly category: WorkflowPluginCategory = 'diagnostics';
  public readonly isBuiltin = true;
  public enabled = true;
  public applyToSubagents = true;

  private writingTools = new Set([
    'write_file',
    'edit_file',
    'write_to_file',
    'replace_file_content',
  ]);

  public async onToolCall(
    ctx: WorkflowPluginContext,
    toolCtx: ToolCallMiddlewareContext,
    next: ToolCallNext,
  ): Promise<ToolResult> {
    const result = await next();

    if (!result.isError && this.writingTools.has(toolCtx.canonicalToolName)) {
      const args = toolCtx.toolCall.arguments || {};
      const targetPath = String(
        args.path ?? args.TargetFile ?? args.AbsolutePath ?? '',
      ).trim();

      if (targetPath) {
        const workspaceRoot = ctx.getWorkspaceRoot();
        const normalizedRoot = path.resolve(workspaceRoot);
        const resolvedPath = path.isAbsolute(targetPath)
          ? path.resolve(targetPath)
          : path.resolve(normalizedRoot, targetPath);

        const relative = path.relative(normalizedRoot, resolvedPath);
        const isSafe = !relative.startsWith('..') && !path.isAbsolute(relative);

        if (isSafe) {
          try {
            const diagResult = await SyntaxLinterService.diagnoseFile({
              filePath: resolvedPath,
              workspaceRoot,
            });

            if (diagResult.diagnostics.length > 0) {
              if (ctx.notifyDiagnostics) {
                ctx.notifyDiagnostics(diagResult);
              }
              if (
                typeof result.output === 'string' &&
                diagResult.formattedOutput
              ) {
                result.output += `\n${diagResult.formattedOutput}`;
              }
            }
          } catch {
            // Non-blocking for diagnostics
          }
        }
      }
    }

    return result;
  }
}
