import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';

export interface TestExecutionResult {
  passed: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
  command: string;
}

export interface RunTestOptions {
  command: string;
  workspaceRoot: string;
  timeoutMs?: number;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  onData?: (data: string) => void;
}

export class AutoTestRunner {
  /**
   * Strip ANSI escape sequences from output
   */
  public static stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\([A-Z]/g, '');
  }

  /**
   * Automatically detect the project's test command based on workspace files
   */
  public static async detectTestCommand(
    workspaceRoot: string,
    preferredCommand?: string,
  ): Promise<string | null> {
    if (preferredCommand && preferredCommand.trim()) {
      return preferredCommand.trim();
    }

    try {
      // 1. Check package.json (Node.js / TypeScript)
      const packageJsonPath = path.join(workspaceRoot, 'package.json');
      try {
        const pkgContent = await fs.readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(pkgContent);
        if (pkg.scripts && typeof pkg.scripts.test === 'string') {
          const testScript = pkg.scripts.test.trim();
          // Filter out standard npm init placeholder
          if (!testScript.includes('no test specified')) {
            // Detect package manager
            const [hasPnpmLock, hasYarnLock, hasBunLock] = await Promise.all([
              fs.access(path.join(workspaceRoot, 'pnpm-lock.yaml')).then(() => true).catch(() => false),
              fs.access(path.join(workspaceRoot, 'yarn.lock')).then(() => true).catch(() => false),
              fs.access(path.join(workspaceRoot, 'bun.lockb')).then(() => true).catch(() => false),
            ]);

            if (hasPnpmLock) return 'pnpm test';
            if (hasYarnLock) return 'yarn test';
            if (hasBunLock) return 'bun test';
            return 'npm test';
          }
        }
      } catch {
        // package.json doesn't exist or isn't valid JSON
      }

      // 2. Check Python testing files
      const pythonConfigs = ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'setup.py'];
      for (const cfg of pythonConfigs) {
        try {
          await fs.access(path.join(workspaceRoot, cfg));
          return 'pytest';
        } catch {
          // ignore
        }
      }

      try {
        const testsStat = await fs.stat(path.join(workspaceRoot, 'tests'));
        if (testsStat.isDirectory()) {
          return 'pytest';
        }
      } catch {
        // ignore
      }

      // 3. Check Rust
      try {
        await fs.access(path.join(workspaceRoot, 'Cargo.toml'));
        return 'cargo test';
      } catch {
        // ignore
      }

      // 4. Check Go
      try {
        await fs.access(path.join(workspaceRoot, 'go.mod'));
        return 'go test ./...';
      } catch {
        // ignore
      }
    } catch {
      // fallback
    }

    return null;
  }

  /**
   * Extract error stacktrace and failure details from test output
   */
  public static extractErrorStacktrace(rawOutput: string, maxChars = 8000): string {
    const cleanOutput = this.stripAnsi(rawOutput).trim();
    if (!cleanOutput) return '(無測試輸出訊息)';

    const lines = cleanOutput.split(/\r?\n/);

    // Look for recognizable error blocks
    const failureLines: string[] = [];
    let inFailureBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const isFailHeader =
        /^(FAIL|FAILED|✕|ERROR|Traceback)/i.test(line.trim()) ||
        /AssertionError/i.test(line) ||
        /Expected:/i.test(line) ||
        /Received:/i.test(line);

      if (isFailHeader) {
        inFailureBlock = true;
      }

      if (inFailureBlock) {
        failureLines.push(line);
      }
    }

    // If we extracted a focused failure block with enough content, use it
    if (failureLines.length >= 3) {
      const result = failureLines.join('\n');
      if (result.length <= maxChars) {
        return result;
      }
      return result.slice(-maxChars);
    }

    // Fallback: take the trailing lines where errors typically appear
    if (cleanOutput.length <= maxChars) {
      return cleanOutput;
    }
    return '...\n' + cleanOutput.slice(-maxChars);
  }

  /**
   * Format test failure into a structured observation prompt for the next turn
   */
  public static formatFailureObservation(params: {
    command: string;
    exitCode: number;
    rawOutput: string;
    retries: number;
    maxRetries: number;
  }): string {
    const stacktrace = this.extractErrorStacktrace(params.rawOutput);

    return [
      `[自動測試驅動修復系統 (Auto Test-Driven Repair)]`,
      `⚠️ 檢測到代碼修改後觸發背景測試，但測試未通過。`,
      `測試指令: \`${params.command}\` (Exit Code: ${params.exitCode})`,
      `自動修復重試次數: 第 ${params.retries} / ${params.maxRetries} 次`,
      ``,
      `【錯誤堆疊與失敗訊息 (Error Stacktrace)】:`,
      `\`\`\``,
      stacktrace,
      `\`\`\``,
      ``,
      `【修復指示】:`,
      `請仔細分析上述錯誤堆疊（Error Stacktrace）、AssertionError 與出錯行數。`,
      `請調用相應代碼修改工具（如 \`replace_file_content\` 或 \`write_to_file\`）修正錯誤。`,
      `修正完成後，系統將再次自動觸發背景測試驗證，直到測試全數通過才會完成任務並通知使用者。`,
    ].join('\n');
  }

  /**
   * Execute test command in background with timeout protection
   */
  public static async runTest(options: RunTestOptions): Promise<TestExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 60_000;

    // Use custom terminal executor if available (e.g. node-pty via server)
    if (options.executeTerminalCommand) {
      try {
        const res = await options.executeTerminalCommand(
          options.command,
          options.workspaceRoot,
          options.onData,
        );
        const durationMs = Date.now() - startTime;
        return {
          passed: res.exitCode === 0,
          exitCode: res.exitCode,
          output: res.output,
          durationMs,
          command: options.command,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const msg = err instanceof Error ? err.message : String(err);
        return {
          passed: false,
          exitCode: 1,
          output: `執行測試失敗: ${msg}`,
          durationMs,
          command: options.command,
        };
      }
    }

    // Default: child_process.exec with timeout
    return new Promise<TestExecutionResult>((resolve) => {
      const testEnv = { ...process.env };
      // Strip Harni server PORT to prevent child test frameworks (e.g. Karma, Jest, dev-servers) from colliding with Harni's port 3001
      delete testEnv.PORT;

      const proc = exec(
        options.command,
        {
          cwd: options.workspaceRoot,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...testEnv,
            CI: 'true',
            FORCE_COLOR: '0',
            TERM: 'dumb',
          },
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const combined = [stdout, stderr].filter(Boolean).join('\n');
          if (error) {
            const exitCode = typeof error.code === 'number' ? error.code : 1;
            resolve({
              passed: false,
              exitCode,
              output: combined || error.message,
              durationMs,
              command: options.command,
            });
          } else {
            resolve({
              passed: true,
              exitCode: 0,
              output: combined,
              durationMs,
              command: options.command,
            });
          }
        },
      );

      if (options.onData && proc.stdout) {
        proc.stdout.on('data', (chunk) => options.onData?.(chunk.toString()));
      }
      if (options.onData && proc.stderr) {
        proc.stderr.on('data', (chunk) => options.onData?.(chunk.toString()));
      }
    });
  }
}
