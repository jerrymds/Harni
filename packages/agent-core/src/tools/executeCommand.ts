import { exec } from 'node:child_process';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import type { ExecuteCommandParams, ToolParametersSchema, ToolResult } from '@harni/types';

export class ExecuteCommandTool extends BaseTool<ExecuteCommandParams> {
  public readonly name = 'execute_command';
  public readonly description =
    'Execute a terminal command within the workspace environment. Requires user confirmation before execution.';
  public readonly requiresApproval = true;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command line string to execute.',
      },
      cwd: {
        type: 'string',
        description: 'Optional sub-directory relative to workspace root.',
      },
    },
    required: ['command'],
  };

  public async execute(
    params: ExecuteCommandParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      if (!params.command) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Missing required parameter: command',
        };
      }

      const effectiveCwd = params.cwd
        ? this.resolveSafePath(params.cwd, context.workspaceRoot)
        : context.workspaceRoot;

      // If custom terminal executor (e.g. node-pty in server) is provided:
      if (context.executeTerminalCommand) {
        const result = await context.executeTerminalCommand(
          params.command,
          effectiveCwd,
          context.onTerminalData,
        );
        return {
          toolCallId: '',
          isError: result.exitCode !== 0,
          output: result.output || `(Command exited with code ${result.exitCode})`,
          summary: `Executed: ${params.command} (exit code ${result.exitCode})`,
        };
      }

      // Fallback to standard child_process execution
      return new Promise<ToolResult>((resolve) => {
        const proc = exec(
          params.command,
          {
            cwd: effectiveCwd,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000,
            env: {
              ...process.env,
              TERM: 'dumb',
              PAGER: 'cat',
              GIT_PAGER: 'cat',
              CI: 'true',
              FORCE_COLOR: '0',
            },
          },
          (error: Error | null, stdout: string, stderr: string) => {
            const combinedOutput = [stdout, stderr].filter(Boolean).join('\n');
            if (error) {
              resolve({
                toolCallId: '',
                isError: true,
                output: combinedOutput || error.message,
                summary: `Command failed: ${params.command}`,
              });
            } else {
              resolve({
                toolCallId: '',
                isError: false,
                output: combinedOutput || '(command executed successfully with no output)',
                summary: `Executed: ${params.command}`,
              });
            }
          },
        );

        if (context.onTerminalData && proc.stdout) {
          proc.stdout.on('data', (chunk: Buffer | string) => {
            context.onTerminalData?.(chunk.toString());
          });
        }
        if (context.onTerminalData && proc.stderr) {
          proc.stderr.on('data', (chunk: Buffer | string) => {
            context.onTerminalData?.(chunk.toString());
          });
        }
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to execute command: ${errorMsg}`,
      };
    }
  }
}
