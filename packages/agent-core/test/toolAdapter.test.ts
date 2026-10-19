import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AntigravityProvider } from '../src/providers/antigravityProvider.js';
import { normalizeToolCall, resolveCanonicalToolName } from '../src/tools/toolAdapter.js';
import { ToolRegistry } from '../src/tools/toolRegistry.js';

describe('toolAdapter & ToolRegistry agy compatibility', () => {
  let tmpDir: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-tool-adapter-'));
    registry = new ToolRegistry(true);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('maps agy native tool names to Harni canonical tool names', () => {
    expect(resolveCanonicalToolName('view_file')).toBe('read_file');
    expect(resolveCanonicalToolName('view_file_outline')).toBe('read_file');
    expect(resolveCanonicalToolName('view_code_item')).toBe('read_file');
    expect(resolveCanonicalToolName('multi_replace_file_content')).toBe('replace_file_content');
    expect(resolveCanonicalToolName('run_command')).toBe('execute_command');
    expect(resolveCanonicalToolName('list_dir')).toBe('list_files');
    expect(resolveCanonicalToolName('find_by_name')).toBe('list_files');
    expect(resolveCanonicalToolName('grep_search')).toBe('search_files');
  });

  it('resolves getTool and requiresApproval for agy tool aliases', () => {
    expect(registry.getTool('view_file')?.name).toBe('read_file');
    expect(registry.getTool('run_command')?.name).toBe('execute_command');
    expect(registry.getTool('run_command')?.requiresApproval).toBe(true);
    expect(registry.getTool('multi_replace_file_content')?.name).toBe('replace_file_content');
  });

  it('executes view_file with AbsolutePath, StartLine, and EndLine via ReadFileTool', async () => {
    const filePath = path.join(tmpDir, 'sample.ts');
    await fs.writeFile(filePath, ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n'), 'utf-8');

    const res = await registry.executeTool(
      'view_file',
      { AbsolutePath: filePath, StartLine: 2, EndLine: 4 },
      { workspaceRoot: tmpDir },
    );

    expect(res.isError).toBe(false);
    expect(res.output).toContain('   2 | line2');
    expect(res.output).toContain('   3 | line3');
    expect(res.output).toContain('   4 | line4');
    expect(res.output).not.toContain('line1');
    expect(res.output).not.toContain('line5');
  });

  it('executes write_to_file with agy PascalCase TargetFile and CodeContent', async () => {
    const res = await registry.executeTool(
      'write_to_file',
      {
        TargetFile: 'hello.ts',
        CodeContent: 'export const x = 42;\n',
        Overwrite: true,
      },
      { workspaceRoot: tmpDir },
    );

    expect(res.isError).toBe(false);
    const saved = await fs.readFile(path.join(tmpDir, 'hello.ts'), 'utf-8');
    expect(saved).toBe('export const x = 42;\n');
  });

  it('executes replace_file_content and multi_replace_file_content with agy PascalCase params and ReplacementChunks', async () => {
    const targetFile = path.join(tmpDir, 'app.ts');
    await fs.writeFile(
      targetFile,
      'const a = 1;\nconst b = 2;\nconst c = 3;\n',
      'utf-8',
    );

    // 1. Single replace with PascalCase parameters
    const res1 = await registry.executeTool(
      'replace_file_content',
      {
        TargetFile: 'app.ts',
        TargetContent: 'const a = 1;',
        ReplacementContent: 'const a = 10;',
      },
      { workspaceRoot: tmpDir },
    );
    expect(res1.isError).toBe(false);

    // 2. Multi-chunk replace via multi_replace_file_content
    const res2 = await registry.executeTool(
      'multi_replace_file_content',
      {
        TargetFile: 'app.ts',
        ReplacementChunks: [
          { TargetContent: 'const b = 2;', ReplacementContent: 'const b = 20;' },
          { TargetContent: 'const c = 3;', ReplacementContent: 'const c = 30;' },
        ],
      },
      { workspaceRoot: tmpDir },
    );
    expect(res2.isError).toBe(false);

    const updated = await fs.readFile(targetFile, 'utf-8');
    expect(updated).toBe('const a = 10;\nconst b = 20;\nconst c = 30;\n');
  });

  it('executes grep_search and find_by_name / list_dir via SearchFilesTool and ListFilesTool', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src', 'alpha.ts'), 'export function magicToken() {}\n', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'src', 'beta.md'), '# Readme\n', 'utf-8');

    const grepRes = await registry.executeTool(
      'grep_search',
      { SearchPath: 'src', Query: 'magicToken', IsRegex: false },
      { workspaceRoot: tmpDir },
    );
    expect(grepRes.isError).toBe(false);
    expect(grepRes.output).toContain('alpha.ts:1:');

    const findRes = await registry.executeTool(
      'find_by_name',
      { SearchDirectory: 'src', Pattern: '*.ts' },
      { workspaceRoot: tmpDir },
    );
    expect(findRes.isError).toBe(false);
    expect(findRes.output).toContain('alpha.ts');
    expect(findRes.output).not.toContain('beta.md');
  });

  it('normalizes agy text tool calls in AntigravityProvider.extractTextToolCalls', () => {
    const text =
      'Calling tool `view_file` with arguments: {"AbsolutePath": "src/main.ts", "StartLine": 10, "EndLine": 30}\n' +
      'Calling tool `run_command` with arguments: {"CommandLine": "npm test", "Cwd": "packages/agent-core"}\n';

    const calls = AntigravityProvider.extractTextToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.name).toBe('read_file');
    expect(calls[0]!.arguments).toMatchObject({
      path: 'src/main.ts',
      startLine: 10,
      endLine: 30,
    });
    expect(calls[1]!.name).toBe('execute_command');
    expect(calls[1]!.arguments).toMatchObject({
      command: 'npm test',
      cwd: 'packages/agent-core',
    });

    const subCall = normalizeToolCall('invoke_subagent', {
      Subagents: [{ TypeName: 'agy-worker', Role: 'Implementer', Prompt: 'Fix bug', Model: 'inherit' }],
    });
    expect(subCall.name).toBe('invoke_subagent');
    expect(subCall.arguments.subagents).toEqual([
      { typeName: 'agy-worker', role: 'Implementer', prompt: 'Fix bug' },
    ]);
  });
});
