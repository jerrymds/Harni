import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ToolRegistry } from '../src/index.js';

describe('ToolRegistry & Built-in File Operations', () => {
  const tempTestDir = path.resolve('temp_test_tools_workspace');

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  it('registers all default tools', () => {
    const registry = new ToolRegistry(true);
    expect(registry.getAllTools().length).toBe(11);
    expect(registry.getTool('invoke_subagent')).toBeDefined();
    expect(registry.getTool('send_message')).toBeDefined();
    expect(registry.getTool('manage_subagents')).toBeDefined();
    expect(registry.getTool('define_subagent')).toBeDefined();
    expect(registry.getTool('ask_question')).toBeDefined();
  });

  it('executes write_to_file and read_file', async () => {
    const registry = new ToolRegistry(true);
    const writeRes = await registry.executeTool(
      'write_to_file',
      { path: 'test.ts', content: 'export const value = 100;\nexport const name = "test";\n' },
      { workspaceRoot: tempTestDir },
    );
    expect(writeRes.isError).toBeFalsy();

    const readRes = await registry.executeTool(
      'read_file',
      { path: 'test.ts' },
      { workspaceRoot: tempTestDir },
    );
    expect(readRes.isError).toBeFalsy();
    expect(String(readRes.output)).toContain('export const value = 100;');
  });

  it('executes replace_file_content and search_files', async () => {
    const registry = new ToolRegistry(true);
    const replaceRes = await registry.executeTool(
      'replace_file_content',
      { path: 'test.ts', targetContent: 'value = 100;', replacementContent: 'value = 999;' },
      { workspaceRoot: tempTestDir },
    );
    expect(replaceRes.isError).toBeFalsy();

    const readAfterRes = await registry.executeTool(
      'read_file',
      { path: 'test.ts' },
      { workspaceRoot: tempTestDir },
    );
    expect(String(readAfterRes.output)).toContain('value = 999;');

    const searchRes = await registry.executeTool(
      'search_files',
      { query: 'value = 999' },
      { workspaceRoot: tempTestDir },
    );
    expect(searchRes.isError).toBeFalsy();
    expect(String(searchRes.output)).toContain('test.ts');
  });

  it('executes list_files', async () => {
    const registry = new ToolRegistry(true);
    const listRes = await registry.executeTool(
      'list_files',
      { path: '.' },
      { workspaceRoot: tempTestDir },
    );
    expect(listRes.isError).toBeFalsy();
    expect(String(listRes.output)).toContain('test.ts');
  });

  it('blocks path traversal security violations', async () => {
    const registry = new ToolRegistry(true);
    const pathEscapeRes = await registry.executeTool(
      'read_file',
      { path: '../../../../windows/system32/cmd.exe' },
      { workspaceRoot: tempTestDir },
    );
    expect(pathEscapeRes.isError).toBeTruthy();
    expect(String(pathEscapeRes.output)).toContain('Path traversal denied');
  });

  it('truncates overly long lines and ignores binary files in search_files', async () => {
    const registry = new ToolRegistry(true);
    // 1. Create a huge single-line file (500KB)
    const longLine = 'A'.repeat(200000) + ' TARGET_0050 ' + 'B'.repeat(200000);
    await fs.writeFile(path.join(tempTestDir, 'huge_cache.json'), longLine, 'utf-8');

    // 2. Create a fake binary database file containing the keyword
    const binaryBuffer = Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from('TARGET_0050 in db'), Buffer.from([0x00])]);
    await fs.writeFile(path.join(tempTestDir, 'test.db'), binaryBuffer);

    const searchRes = await registry.executeTool(
      'search_files',
      { query: 'TARGET_0050' },
      { workspaceRoot: tempTestDir },
    );

    expect(searchRes.isError).toBeFalsy();
    const outputStr = String(searchRes.output);
    // Should contain matching file
    expect(outputStr).toContain('huge_cache.json');
    // Binary .db must be ignored
    expect(outputStr).not.toContain('test.db');
    // Output should be heavily truncated (not 400KB!)
    expect(outputStr.length).toBeLessThan(1000);
    expect(outputStr).toContain('TARGET_0050');
  });

  it('protects read_file against binary files', async () => {
    const registry = new ToolRegistry(true);
    const binFile = path.join(tempTestDir, 'binary_test.bin');
    await fs.writeFile(binFile, Buffer.from([0x00, 0xFF, 0xFE, 0x00]));

    const readRes = await registry.executeTool(
      'read_file',
      { path: 'binary_test.bin' },
      { workspaceRoot: tempTestDir },
    );
    expect(readRes.isError).toBeTruthy();
    expect(String(readRes.output)).toContain('二進位');
  });
});

