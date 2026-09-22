import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient, McpServerManager, AgentCoreEngine } from '../src/index.js';

describe('MCP Client & Server Manager', () => {
  const tempTestDir = path.resolve('temp_test_mcp_workspace');
  const mockMcpServerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'mockMcpServer.js',
  );
  const nodeCmd = process.platform === 'win32' ? 'node' : process.execPath;
  const mockServerConfig = (name: string) => ({
    command: nodeCmd,
    args: [mockMcpServerPath],
    requiresApproval: false,
    cwd: tempTestDir,
  });

  beforeAll(async () => {
    await fs.mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  it('connects to McpClient, discovers tools and executes tool call', async () => {
    const mcpClient = new McpClient('mock-unit', mockServerConfig('mock-unit'));
    await mcpClient.start();
    expect(mcpClient.isRunning).toBe(true);

    const mcpTools = await mcpClient.listTools();
    expect(mcpTools.some((t) => t.name === 'add')).toBe(true);
    expect(mcpTools.some((t) => t.name === 'echo')).toBe(true);

    const sumResult = await mcpClient.callTool('add', { a: 2, b: 3 });
    const sumOutput = sumResult.content?.[0]?.text?.trim();
    expect(sumOutput).toBe('5');

    await mcpClient.stop();
    expect(mcpClient.isRunning).toBe(false);
  });

  it('aggregates multiple servers with prefixed tools in McpServerManager', async () => {
    const manager = new McpServerManager({ workspaceRoot: tempTestDir });
    const connectResult = await manager.connectAll({
      calculator: mockServerConfig('calculator'),
      textutils: mockServerConfig('textutils'),
    });
    expect(connectResult.connected.length).toBe(2);

    const managerDefs = manager.getToolDefinitions();
    expect(managerDefs.some((d) => d.name === 'mcp__calculator__add')).toBe(true);
    expect(managerDefs.some((d) => d.name === 'mcp__textutils__echo')).toBe(true);
    expect(managerDefs.every((d) => d.requiresApproval === false)).toBe(true);

    const aggregatedCall = await manager.callTool('mcp__calculator__add', { a: 10, b: 32 });
    expect(aggregatedCall.isError).toBeFalsy();
    expect(String(aggregatedCall.output).trim()).toBe('42');

    expect(manager.getStatus().length).toBe(2);
    expect(manager.getStatus().every((s) => s.status === 'connected')).toBe(true);

    await manager.disconnectAll();
    expect(manager.getStatus().length).toBe(0);
  });

  it('injects MCP tools into AgentCoreEngine and handles lifecycle', async () => {
    const mcpEngine = new AgentCoreEngine({
      workspaceRoot: tempTestDir,
      mcpEnabled: true,
      mcpServers: {
        calculator: mockServerConfig('calculator'),
      },
    });

    const engineResult = await mcpEngine.initializeMcp();
    expect(engineResult.connected.length).toBe(1);

    const engineDefs = mcpEngine.getMcpManager().getToolDefinitions();
    expect(engineDefs.some((d) => d.name.startsWith('mcp__calculator__'))).toBe(true);
    expect(mcpEngine.getMcpManager().getTool('mcp__calculator__add')).toBeDefined();

    const engineCall = await mcpEngine.getMcpManager().callTool('mcp__calculator__add', { a: 1, b: 1 });
    expect(engineCall.isError).toBeFalsy();
    expect(String(engineCall.output).trim()).toBe('2');

    await mcpEngine.dispose();
    expect(mcpEngine.getMcpManager().getStatus().length).toBe(0);
  });
});
