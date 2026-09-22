import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  SyntaxLinterService,
  WriteFileTool,
  ReplaceFileContentTool,
  type ToolExecutionContext,
} from '../src/index.js';
import type { FileDiagnosticsResult } from '@harni/types';

describe('SyntaxLinterService Unit Tests', () => {
  const tempDir = path.resolve('temp_test_syntax_linter');

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects syntax errors in TypeScript code with accurate line and column', () => {
    const brokenCode = `export function add(a: number, b: number) {
  if (a > 0) {
    return a + b;
// missing closing brace for if and function`;

    const diags = SyntaxLinterService.checkTypeScriptSyntax('src/math.ts', brokenCode);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].source).toBe('syntax');
    expect(diags[0].code).toMatch(/^TS\d+/);
    expect(diags[0].message).toContain('expected');
    expect(diags[0].line).toBeGreaterThanOrEqual(3);
  });

  it('returns empty diagnostics for valid TypeScript and TSX code', () => {
    const validTs = `export interface User { id: string; name: string; }
export const getUser = (id: string): User => ({ id, name: 'Alice' });
`;
    const diagsTs = SyntaxLinterService.checkTypeScriptSyntax('src/user.ts', validTs);
    expect(diagsTs).toEqual([]);

    const validTsx = `import React from 'react';
export const Button: React.FC<{ label: string }> = ({ label }) => (
  <button type="button" className="btn">{label}</button>
);
`;
    const diagsTsx = SyntaxLinterService.checkTypeScriptSyntax('src/Button.tsx', validTsx);
    expect(diagsTsx).toEqual([]);
  });

  it('detects JSON syntax errors with line and column information', () => {
    const brokenJson = `{
  "name": "cline-web",
  "version": 1.0,
  "invalid": [1, 2, 3,]
}`;
    const diags = SyntaxLinterService.checkJsonSyntax('config.json', brokenJson);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].source).toBe('json');
    expect(diags[0].line).toBe(4);
    expect(diags[0].message).toContain('JSON');
  });

  it('formats diagnostics into structured Markdown output for Agent prompt', () => {
    const formatted = SyntaxLinterService.formatDiagnosticsOutput(
      [
        {
          line: 12,
          column: 5,
          message: "';' expected.",
          severity: 'error',
          source: 'syntax',
          code: 'TS1005',
        },
      ],
      'src/broken.ts',
    );

    expect(formatted).toContain('語法與 Linter 即時回饋');
    expect(formatted).toContain('src/broken.ts');
    expect(formatted).toContain('第 12 行，第 5 欄');
    expect(formatted).toContain('TS1005');
    expect(formatted).toContain('replace_file_content');
  });
});

describe('Tool Integration with Syntax & Linter Instant Feedback', () => {
  const tempDir = path.resolve('temp_test_tool_syntax_feedback');

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('write_to_file appends syntax diagnostic feedback when code has syntax errors', async () => {
    const tool = new WriteFileTool();
    let receivedDiagnostics: FileDiagnosticsResult | null = null;

    const context: ToolExecutionContext = {
      workspaceRoot: tempDir,
      onDiagnostics: (result) => {
        receivedDiagnostics = result;
      },
    };

    const brokenCode = `function calculateTotal(items: any[]) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
// syntax error: unclosed for loop and function`;

    const result = await tool.execute(
      { path: 'calculator.ts', content: brokenCode },
      context,
    );

    // File writing succeeds
    expect(result.isError).toBe(false);
    expect(result.output).toContain('Successfully wrote');

    // But output contains instant syntax diagnostic warning!
    expect(result.output).toContain('語法與 Linter 即時回饋');
    expect(result.output).toContain('calculator.ts');
    expect(result.output).toContain('replace_file_content');

    // Context listener received diagnostics
    expect(receivedDiagnostics).not.toBeNull();
    expect(receivedDiagnostics!.hasErrors).toBe(true);
    expect(receivedDiagnostics!.diagnostics.length).toBeGreaterThan(0);
  });

  it('write_to_file produces clean output when code is syntactically valid', async () => {
    const tool = new WriteFileTool();
    let receivedDiagnostics: FileDiagnosticsResult | null = null;

    const context: ToolExecutionContext = {
      workspaceRoot: tempDir,
      onDiagnostics: (result) => {
        receivedDiagnostics = result;
      },
    };

    const cleanCode = `export function multiply(a: number, b: number): number {
  return a * b;
}
`;

    const result = await tool.execute(
      { path: 'clean.ts', content: cleanCode },
      context,
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Successfully wrote');
    expect(result.output).not.toContain('語法與 Linter 即時回饋');
    expect(receivedDiagnostics).toBeNull();
  });

  it('replace_file_content appends syntax diagnostic feedback when replacement creates syntax error', async () => {
    const writeTool = new WriteFileTool();
    const replaceTool = new ReplaceFileContentTool();
    let receivedDiagnostics: FileDiagnosticsResult | null = null;

    const context: ToolExecutionContext = {
      workspaceRoot: tempDir,
      onDiagnostics: (result) => {
        receivedDiagnostics = result;
      },
    };

    // 1. First write valid file
    await writeTool.execute(
      {
        path: 'service.ts',
        content: `export function processItem(val: number) {
  if (val > 0) {
    return val * 2;
  }
  return 0;
}
`,
      },
      context,
    );

    // 2. Now replace valid closing brace with broken syntax
    const replaceResult = await replaceTool.execute(
      {
        path: 'service.ts',
        targetContent: 'return val * 2;\n  }',
        replacementContent: 'return val * 2;\n  // removed closing brace',
      },
      context,
    );

    expect(replaceResult.isError).toBe(false);
    expect(replaceResult.output).toContain('Successfully replaced target content');
    // Verifies instant syntax diagnostic warning was injected!
    expect(replaceResult.output).toContain('語法與 Linter 即時回饋');
    expect(replaceResult.output).toContain('service.ts');
    expect(receivedDiagnostics).not.toBeNull();
    expect(receivedDiagnostics!.hasErrors).toBe(true);
  });
});
