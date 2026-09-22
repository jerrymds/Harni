import type { Router } from './router.js';
import type { McpServerConfig } from '@harni/agent-core';
import { sendJsonResponse } from '../utils/http.js';

export function registerMcpRoutes(router: Router): void {
  // GET /api/mcp/status - Get current MCP status, active servers, and discovered tools
  router.get('/api/mcp/status', ({ res, ctx }) => {
    try {
      const mcpManager = ctx.engine.getMcpManager();
      const mcpEnabledSetting = ctx.dbService.getSetting('mcp_enabled');
      const isEnabled = mcpEnabledSetting === 'true';

      const servers = mcpManager.getStatus();
      const tools = mcpManager.getToolDefinitions();

      sendJsonResponse(res, 200, {
        enabled: isEnabled,
        servers,
        tools,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg, enabled: false, servers: [], tools: [] });
    }
  });

  // POST /api/mcp/restart - Force reconnect / reload all configured MCP servers
  router.post('/api/mcp/restart', async ({ res, ctx }) => {
    try {
      const mcpEnabledSetting = ctx.dbService.getSetting('mcp_enabled');
      const mcpConfigSetting = ctx.dbService.getSetting('mcp_config');
      const isEnabled = mcpEnabledSetting === 'true';

      let mcpServers: Record<string, McpServerConfig> = {};
      if (mcpConfigSetting) {
        try {
          const parsed = JSON.parse(mcpConfigSetting);
          if (parsed && typeof parsed === 'object') {
            mcpServers = parsed.mcpServers || parsed;
          }
        } catch (e) {
          console.warn('[MCP Route] Failed to parse mcp_config:', e);
        }
      }

      const result = await ctx.engine.updateMcpServers({
        mcpEnabled: isEnabled,
        mcpServers,
        workspaceRoot: ctx.workspaceRoot,
      });

      const mcpManager = ctx.engine.getMcpManager();
      sendJsonResponse(res, 200, {
        success: true,
        connected: result.connected,
        failed: result.failed,
        statuses: mcpManager.getStatus(),
        tools: mcpManager.getToolDefinitions(),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg, success: false, connected: [], failed: [] });
    }
  });
}
