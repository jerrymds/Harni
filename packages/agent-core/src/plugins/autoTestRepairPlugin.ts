import {
  PluginPriority,
  type ChatMessage,
  type CompletionGateResult,
  type ProbeCandidate,
  type ToolCallMiddlewareContext,
  type ToolCallNext,
  type ToolResult,
  type WorkflowPlugin,
  type WorkflowPluginCategory,
  type WorkflowPluginContext,
} from '@harni/types';
import { AutoTestRunner } from '../testing/autoTestRunner.js';
import { ContrastiveProbeRunner } from '../harness/contrastiveProbeRunner.js';
import type { GitCheckpointService } from '../git/gitCheckpointService.js';

export interface AutoTestRepairPluginOptions {
  gitCheckpointService: GitCheckpointService;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  getDefaultEnabled?: () => boolean;
  getDefaultTestCommand?: () => string | undefined;
  getDefaultMaxRetries?: () => number;
}

export interface AutoTestPluginState {
  codeModified: boolean;
  autoTestRetries: number;
  testFailureDiffs: string[];
  encounteredErrors: string[];
}

export class AutoTestRepairPlugin implements WorkflowPlugin {
  public readonly id = 'harni.auto-test-repair';
  public readonly name = 'Auto Test-Driven Repair Plugin';
  public readonly description =
    'Automatically executes tests after code edits and drives iterative self-correction.';
  public readonly priority = PluginPriority.VERIFICATION;
  public readonly category: WorkflowPluginCategory = 'verification';
  public readonly isBuiltin = true;
  public enabled = true;
  public applyToSubagents = false;

  constructor(private options: AutoTestRepairPluginOptions) {}

  public markCodeModified(
    ctx: WorkflowPluginContext,
    filePath?: string,
  ): void {
    if (!filePath || AutoTestRunner.isCodeFile(filePath)) {
      const state = ctx.getPluginState<AutoTestPluginState>(this.id, () => ({
        codeModified: false,
        autoTestRetries: 0,
        testFailureDiffs: [],
        encounteredErrors: [],
      }));
      state.codeModified = true;
    }
  }

  public resetState(ctx: WorkflowPluginContext): void {
    const state = ctx.getPluginState<AutoTestPluginState>(this.id, () => ({
      codeModified: false,
      autoTestRetries: 0,
      testFailureDiffs: [],
      encounteredErrors: [],
    }));
    state.codeModified = false;
    state.autoTestRetries = 0;
    state.testFailureDiffs = [];
    state.encounteredErrors = [];
  }

  public async onToolCall(
    ctx: WorkflowPluginContext,
    toolCtx: ToolCallMiddlewareContext,
    next: ToolCallNext,
  ): Promise<ToolResult> {
    const result = await next();

    if (
      !result.isError &&
      ['write_file', 'edit_file', 'write_to_file', 'replace_file_content'].includes(
        toolCtx.canonicalToolName,
      )
    ) {
      const args = (toolCtx.toolCall.arguments || {}) as Record<string, unknown>;
      const targetPath = String(
        args.path ?? args.TargetFile ?? args.AbsolutePath ?? '',
      ).trim();
      if (targetPath) {
        this.markCodeModified(ctx, targetPath);
        ctx.notifyCodeModified?.(targetPath);
      }
    }

    return result;
  }

  public async onBeforeComplete(
    ctx: WorkflowPluginContext,
  ): Promise<CompletionGateResult> {
    if (!this.enabled) {
      return { action: 'allow' };
    }

    const state = ctx.getPluginState<AutoTestPluginState>(this.id, () => ({
      codeModified: false,
      autoTestRetries: 0,
      testFailureDiffs: [],
      encounteredErrors: [],
    }));

    const autoTestConfig = ctx.getAutoTestConfig?.() || {};
    const defaultEnabled = this.options.getDefaultEnabled
      ? this.options.getDefaultEnabled()
      : true;
    const isConfigEnabled =
      autoTestConfig.enabled !== undefined
        ? autoTestConfig.enabled !== false
        : defaultEnabled;

    if (!state.codeModified || !isConfigEnabled) {
      return { action: 'allow' };
    }

    const defaultTestCmd = this.options.getDefaultTestCommand
      ? this.options.getDefaultTestCommand()
      : undefined;
    const testCmd = await AutoTestRunner.detectTestCommand(
      ctx.getWorkspaceRoot(),
      autoTestConfig.testCommand || defaultTestCmd,
    );

    if (!testCmd) {
      return { action: 'allow' };
    }

    ctx.setStatus('testing');
    if (ctx.taskState) {
      ctx.taskState.autoTestStatus = {
        running: true,
        command: testCmd,
        retries: state.autoTestRetries,
      };
      ctx.syncTaskState();
    }

    const testResult = await AutoTestRunner.runTest({
      command: testCmd,
      workspaceRoot: ctx.getWorkspaceRoot(),
      timeoutMs: autoTestConfig.timeoutMs,
      executeTerminalCommand: this.options.executeTerminalCommand,
      onData: (data) => {
        ctx.notifyTerminalData?.(data);
      },
    });

    if (ctx.taskState) {
      ctx.taskState.autoTestStatus = {
        running: false,
        command: testCmd,
        passed: testResult.passed,
        retries: state.autoTestRetries,
        durationMs: testResult.durationMs,
        lastError: testResult.passed
          ? undefined
          : testResult.output.slice(-1000),
      };
      ctx.syncTaskState();
    }

    ctx.emitEvent('test:result', {
      passed: testResult.passed,
      command: testCmd,
      output: testResult.output,
      exitCode: testResult.exitCode,
      sessionId: ctx.sessionId,
      taskId: ctx.taskId,
      retries: state.autoTestRetries,
      durationMs: testResult.durationMs,
    });

    if (!testResult.passed) {
      const testErrSummary = `Test failed (${testCmd}): ${AutoTestRunner.extractErrorStacktrace(testResult.output, 200).trim() || 'Exit code ' + testResult.exitCode}`;
      state.encounteredErrors.push(testErrSummary);
      if (state.encounteredErrors.length > 5) {
        state.encounteredErrors.shift();
      }

      try {
        const isGit = await this.options.gitCheckpointService.isGitRepo(
          ctx.getWorkspaceRoot(),
        );
        if (isGit) {
          const diffRes = await this.options.gitCheckpointService.runGit(
            ['diff', 'HEAD'],
            ctx.getWorkspaceRoot(),
          );
          const currentDiff = (diffRes.stdout || '').slice(0, 8000);
          if (currentDiff && !state.testFailureDiffs.includes(currentDiff)) {
            state.testFailureDiffs.push(currentDiff);
          }
        }
      } catch (diffErr) {
        console.warn(
          '[AutoTestRepairPlugin] Failed to capture git diff on test failure:',
          diffErr,
        );
      }

      const defaultMaxRetries = this.options.getDefaultMaxRetries
        ? this.options.getDefaultMaxRetries()
        : 5;
      const maxRetries = autoTestConfig.maxRetries ?? defaultMaxRetries;

      if (state.autoTestRetries < maxRetries) {
        state.autoTestRetries++;
        const failureObservation = AutoTestRunner.formatFailureObservation({
          command: testCmd,
          exitCode: testResult.exitCode,
          rawOutput: testResult.output,
          retries: state.autoTestRetries,
          maxRetries,
        });

        const observationMsg: ChatMessage = {
          id: `msg_obs_${Date.now()}`,
          role: 'user',
          content: failureObservation,
          timestamp: Date.now(),
        };

        return {
          action: 'continue_loop',
          injectedMessages: [observationMsg],
        };
      } else {
        // Exceeded max retries: run contrastive probe if multiple attempts exist
        let probeReport = '';
        if (state.testFailureDiffs.length >= 2) {
          try {
            const diffSlice = state.testFailureDiffs.slice(-3);
            const candidates: ProbeCandidate[] = diffSlice.map((diff, idx) => ({
              id: `attempt_${idx + 1}`,
              name: `修復嘗試方案 ${idx + 1}`,
              description: `第 ${idx + 1} 次自動修復的代碼補丁`,
              patchDiff: diff,
            }));

            const llmCaller = async (promptText: string): Promise<string> => {
              return await ctx.invokeLLM(
                promptText,
                'You are an expert evaluator assessing and comparing code solution candidates.',
              );
            };

            const probeResult = await ContrastiveProbeRunner.evaluateCandidates({
              taskDescription:
                ctx.taskState?.prompt || `Repair failing test: ${testCmd}`,
              candidates,
              llmCaller,
            });

            ctx.emitEvent('probe:result', {
              sessionId: ctx.sessionId,
              taskId: ctx.taskId,
              result: probeResult,
            });

            if (probeResult.status === 'parse_failed') {
              probeReport =
                `\n\n### 🔬 對比探測評估建議\n` +
                `- **評估狀態**: 評估輸出解析失敗 (\`parse_failed\`)，無法自動選出最佳候選方案。\n` +
                `- **評估摘要**: ${probeResult.comparisonSummary}\n`;
            } else {
              probeReport =
                `\n\n### 🔬 對比探測評估建議（最接近成功的修改與建議）\n` +
                `- **推薦最佳方案**: ${probeResult.winnerName} (${probeResult.winnerId})\n` +
                `- **評估摘要**: ${probeResult.comparisonSummary}\n` +
                `- **建議理由**: ${probeResult.rationale}\n` +
                (probeResult.improvementSuggestions &&
                probeResult.improvementSuggestions.length > 0
                  ? `- **改進建議**: ${probeResult.improvementSuggestions.join('; ')}\n`
                  : '');
            }
          } catch (probeErr) {
            console.warn(
              '[AutoTestRepairPlugin] Contrastive probe evaluation failed on retry limit:',
              probeErr,
            );
          }
        }

        const limitMsg: ChatMessage = {
          id: `msg_test_max_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **自動測試驅動修復已達重試上限 (${maxRetries} 次)**：經過多次修復嘗試，背景測試仍未通過。\n\n**最後測試指令**: \`${testCmd}\` (結束碼: ${testResult.exitCode})\n\n**錯誤摘要**:\n\`\`\`\n${AutoTestRunner.extractErrorStacktrace(testResult.output, 2000)}\n\`\`\`\n\n已停止自動重試，請檢視上方錯誤堆疊。${probeReport}`,
          timestamp: Date.now(),
        };

        return {
          action: 'complete_with_messages',
          appendedMessages: [limitMsg],
        };
      }
    } else {
      // Test passed!
      state.codeModified = false;
      if (state.autoTestRetries > 0) {
        const passMsg: ChatMessage = {
          id: `msg_test_passed_${Date.now()}`,
          role: 'assistant',
          content: `✅ **自動測試驅動修復成功**：背景測試全數通過！(\`${testCmd}\`)，共修復重試 ${state.autoTestRetries} 次。`,
          timestamp: Date.now(),
        };
        return {
          action: 'allow',
          appendedMessages: [passMsg],
        };
      }
      return { action: 'allow' };
    }
  }
}
