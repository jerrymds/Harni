import { describe, it, expect } from 'vitest';
import { cleanServerId, validateAndBuildMcpServer } from './mcpValidation.js';

describe('mcpValidation', () => {
  describe('cleanServerId', () => {
    it('normalizes uppercase and special characters to lowercase dashes', () => {
      expect(cleanServerId('My Test Server!')).toBe('my-test-server-');
      expect(cleanServerId('  github_tool  ')).toBe('github_tool');
      expect(cleanServerId('Server@123')).toBe('server-123');
    });
  });

  describe('validateAndBuildMcpServer', () => {
    const baseInput = {
      id: 'my-server',
      isEditing: false,
      existingIds: ['existing-1', 'existing-2'],
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      serverUrl: '',
      cwd: '/workspace',
      requiresApproval: true,
      disabled: false,
      envList: [
        { key: 'API_KEY', value: 'secret123' },
        { key: ' ', value: 'ignored' },
      ],
    };

    it('successfully validates and builds a stdio server entry', () => {
      const res = validateAndBuildMcpServer(baseInput);
      expect(res.isValid).toBe(true);
      expect(res.error).toBeNull();
      expect(res.cleanId).toBe('my-server');
      expect(res.config).toEqual({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        cwd: '/workspace',
        requiresApproval: true,
        disabled: false,
        env: {
          API_KEY: 'secret123',
        },
      });
    });

    it('rejects empty or whitespace-only id', () => {
      const res = validateAndBuildMcpServer({ ...baseInput, id: '   ' });
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('請輸入合法的伺服器識別名稱');
    });

    it('rejects duplicate id when creating new server', () => {
      const res = validateAndBuildMcpServer({ ...baseInput, id: 'existing-1' });
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('已存在同名的伺服器');
    });

    it('allows keeping the same id when editing existing server', () => {
      const res = validateAndBuildMcpServer({
        ...baseInput,
        id: 'existing-1',
        isEditing: true,
        oldId: 'existing-1',
      });
      expect(res.isValid).toBe(true);
      expect(res.cleanId).toBe('existing-1');
    });

    it('rejects renaming to another existing id when editing', () => {
      const res = validateAndBuildMcpServer({
        ...baseInput,
        id: 'existing-2',
        isEditing: true,
        oldId: 'existing-1',
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('已存在同名的伺服器');
    });

    it('rejects empty command for stdio server', () => {
      const res = validateAndBuildMcpServer({ ...baseInput, command: '  ' });
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('請輸入欲執行的指令 (Command)');
    });

    it('successfully validates and builds an sse server entry', () => {
      const res = validateAndBuildMcpServer({
        ...baseInput,
        transport: 'sse',
        serverUrl: 'https://mcp.example.com/sse',
      });
      expect(res.isValid).toBe(true);
      expect(res.config).toEqual({
        serverUrl: 'https://mcp.example.com/sse',
        requiresApproval: true,
        disabled: false,
      });
    });

    it('rejects empty serverUrl for sse server', () => {
      const res = validateAndBuildMcpServer({
        ...baseInput,
        transport: 'sse',
        serverUrl: '   ',
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('請輸入 SSE 伺服器端點 URL');
    });
  });
});
