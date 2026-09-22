import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import ts from 'typescript';
import type { FileDiagnostic, FileDiagnosticsResult } from '@harni/types';

export interface DiagnoseFileOptions {
  filePath: string;
  workspaceRoot: string;
  content?: string;
  runEslint?: boolean;
}

export class SyntaxLinterService {
  /**
   * Fast in-memory TypeScript / JavaScript / TSX / JSX syntax diagnostics (< 5ms)
   */
  public static checkTypeScriptSyntax(filePath: string, content: string): FileDiagnostic[] {
    const ext = path.extname(filePath).toLowerCase();
    const validExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    if (!validExtensions.includes(ext)) {
      return [];
    }

    let scriptKind = ts.ScriptKind.TS;
    if (ext === '.tsx') scriptKind = ts.ScriptKind.TSX;
    else if (ext === '.jsx') scriptKind = ts.ScriptKind.JSX;
    else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') scriptKind = ts.ScriptKind.JS;

    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind,
      );

      const diagnostics: FileDiagnostic[] = [];
      const parseDiags =
        (sourceFile as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] })
          .parseDiagnostics || [];

      for (const diag of parseDiags) {
        const startPos = diag.start ?? 0;
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(startPos);
        diagnostics.push({
          line: line + 1,
          column: character + 1,
          message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
          severity: 'error',
          source: 'syntax',
          code: `TS${diag.code}`,
        });
      }

      return diagnostics;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return [
        {
          line: 1,
          column: 1,
          message: `語法解析異常: ${errorMsg}`,
          severity: 'error',
          source: 'syntax',
        },
      ];
    }
  }

  /**
   * Fast in-memory JSON syntax validation
   */
  public static checkJsonSyntax(filePath: string, content: string): FileDiagnostic[] {
    if (!filePath.endsWith('.json')) {
      return [];
    }

    try {
      JSON.parse(content);
      return [];
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      let line = 1;
      let column = 1;

      // 1. Use ts.parseJsonText for accurate line and column diagnostics
      try {
        const jsonSf = ts.parseJsonText(filePath, content) as unknown as {
          parseDiagnostics?: ts.DiagnosticWithLocation[];
          getLineAndCharacterOfPosition: (pos: number) => ts.LineAndCharacter;
        };
        if (jsonSf.parseDiagnostics && jsonSf.parseDiagnostics.length > 0) {
          const d = jsonSf.parseDiagnostics[0]!;
          const pos = jsonSf.getLineAndCharacterOfPosition(d.start ?? 0);
          return [
            {
              line: pos.line + 1,
              column: pos.character + 1,
              message: `JSON 格式錯誤: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
              severity: 'error',
              source: 'json',
              code: `TS${d.code}`,
            },
          ];
        }
      } catch {
        // fallback
      }

      // 2. Check for explicit "(line 4 column 22)" in modern V8 / Node.js
      const lineColMatch = errorMsg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
      if (lineColMatch && lineColMatch[1] && lineColMatch[2]) {
        line = parseInt(lineColMatch[1], 10);
        column = parseInt(lineColMatch[2], 10);
      } else {
        // 3. Extract character offset "at position 61"
        const posMatch = errorMsg.match(/at position (\d+)/i);
        if (posMatch && posMatch[1]) {
          const pos = parseInt(posMatch[1], 10);
          const prefix = content.slice(0, pos);
          const lines = prefix.split(/\r?\n/);
          line = lines.length;
          column = lines[lines.length - 1]!.length + 1;
        } else {
          // 4. Try snippet matching if error message contains '...'
          const snippetMatch = errorMsg.match(/\.\.\."\s*([^"\n]+)/);
          if (snippetMatch && snippetMatch[1]) {
            const token = snippetMatch[1].trim();
            const idx = content.indexOf(token);
            if (idx !== -1) {
              const prefix = content.slice(0, idx);
              const lines = prefix.split(/\r?\n/);
              line = lines.length;
              column = lines[lines.length - 1]!.length + 1;
            }
          }
        }
      }

      return [
        {
          line,
          column,
          message: `JSON 格式錯誤: ${errorMsg}`,
          severity: 'error',
          source: 'json',
        },
      ];
    }
  }

  /**
   * Run workspace ESLint on the target file if configured
   */
  public static async checkWorkspaceEslint(
    filePath: string,
    workspaceRoot: string,
    timeoutMs = 6000,
  ): Promise<FileDiagnostic[]> {
    const ext = path.extname(filePath).toLowerCase();
    const lintableExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    if (!lintableExtensions.includes(ext)) {
      return [];
    }

    // Check if ESLint configuration exists in workspace
    const eslintConfigFiles = [
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yaml',
      '.eslintrc.yml',
      '.eslintrc',
    ];

    let hasEslintConfig = false;
    for (const cfg of eslintConfigFiles) {
      try {
        await fs.access(path.join(workspaceRoot, cfg));
        hasEslintConfig = true;
        break;
      } catch {
        // continue
      }
    }

    if (!hasEslintConfig) {
      try {
        const pkgRaw = await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        if (pkg.eslintConfig || pkg.devDependencies?.eslint || pkg.dependencies?.eslint) {
          hasEslintConfig = true;
        }
      } catch {
        // ignore
      }
    }

    if (!hasEslintConfig) {
      return [];
    }

    const relPath = path.relative(workspaceRoot, filePath);

    return new Promise<FileDiagnostic[]>((resolve) => {
      // Execute eslint with json format output
      const cmd = `pnpm exec eslint --format json "${relPath}"`;
      exec(
        cmd,
        {
          cwd: workspaceRoot,
          timeout: timeoutMs,
          env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
        },
        (_error, stdout) => {
          if (!stdout || !stdout.trim()) {
            return resolve([]);
          }

          try {
            // ESLint JSON format output starts with '['
            const jsonStart = stdout.indexOf('[');
            if (jsonStart === -1) return resolve([]);

            const rawJson = stdout.slice(jsonStart);
            const report = JSON.parse(rawJson);
            const diagnostics: FileDiagnostic[] = [];

            if (Array.isArray(report)) {
              for (const fileReport of report) {
                if (fileReport.messages && Array.isArray(fileReport.messages)) {
                  for (const msg of fileReport.messages) {
                    diagnostics.push({
                      line: msg.line || 1,
                      column: msg.column || 1,
                      message: msg.message || 'Linter warning',
                      severity: msg.severity === 2 ? 'error' : 'warning',
                      source: 'eslint',
                      code: msg.ruleId || undefined,
                    });
                  }
                }
              }
            }

            resolve(diagnostics);
          } catch {
            resolve([]);
          }
        },
      );
    });
  }

  /**
   * Format diagnostics into an actionable markdown notice for the Agent
   */
  public static formatDiagnosticsOutput(
    diagnostics: FileDiagnostic[],
    relativePath: string,
  ): string {
    if (diagnostics.length === 0) {
      return '';
    }

    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');

    const lines: string[] = [
      '',
      `⚠️ **[語法與 Linter 即時回饋 (Syntax & Linter Diagnostics)]**:`,
      `檔案 \`${relativePath}\` 在變更後檢測到 ${errors.length} 個錯誤${warnings.length > 0 ? `、${warnings.length} 個警告` : ''}，請在下一步前優先修正：`,
      '',
    ];

    for (const d of diagnostics) {
      const icon = d.severity === 'error' ? '🔴' : '🟡';
      const codeTag = d.code ? ` \`[${d.code}]\`` : '';
      lines.push(`• ${icon} **第 ${d.line} 行，第 ${d.column} 欄**${codeTag}: ${d.message}`);
    }

    lines.push('');
    lines.push('💡 **建議修復方式**: 請調用 `replace_file_content` 修正上述語法或 Linter 錯誤，避免程式碼無法編譯或執行。');

    return lines.join('\n');
  }

  /**
   * Complete diagnostic pipeline on a single file
   */
  public static async diagnoseFile(options: DiagnoseFileOptions): Promise<FileDiagnosticsResult> {
    const { filePath, workspaceRoot, runEslint = true } = options;
    const relPath = path.relative(workspaceRoot, filePath) || filePath;

    let content = options.content;
    if (content === undefined) {
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        return {
          path: relPath,
          hasErrors: false,
          diagnostics: [],
        };
      }
    }

    const diagnostics: FileDiagnostic[] = [];

    // 1. In-memory TypeScript / JavaScript AST Syntax Check
    const tsDiags = this.checkTypeScriptSyntax(filePath, content);
    diagnostics.push(...tsDiags);

    // 2. In-memory JSON Syntax Check
    const jsonDiags = this.checkJsonSyntax(filePath, content);
    diagnostics.push(...jsonDiags);

    // 3. Workspace ESLint Check (if enabled and no fatal syntax errors already)
    if (runEslint && diagnostics.length === 0) {
      try {
        const eslintDiags = await this.checkWorkspaceEslint(filePath, workspaceRoot);
        diagnostics.push(...eslintDiags);
      } catch {
        // Non-blocking
      }
    }

    // Sort by line, then column
    diagnostics.sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.column - b.column;
    });

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    const formattedOutput = diagnostics.length > 0
      ? this.formatDiagnosticsOutput(diagnostics, relPath)
      : undefined;

    return {
      path: relPath,
      hasErrors,
      diagnostics,
      formattedOutput,
    };
  }
}
