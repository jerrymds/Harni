import * as http from 'node:http';
import * as path from 'node:path';
import { WebSocketServer } from 'ws';
import { AgentCoreEngine } from '@harni/agent-core';
import type { AppInstance, ReadBodyOptions, ServerConfig, ServerContext } from './types/server.js';
import { FSService } from './services/fsService.js';
import { PTYService } from './services/ptyService.js';
import { DBService } from './services/dbService.js';
import { WebSocketHandler } from './ws/wsHandler.js';
import {
  extractAuthTokenFromRequest,
  timingSafeCompare,
  validateHostBindingSecurity,
} from './utils/security.js';
import { DEFAULT_MAX_BODY_SIZE } from './utils/http.js';
import { Router } from './routes/router.js';
import { sendJsonResponse } from './utils/http.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerModelRoutes } from './routes/models.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCredentialsRoutes } from './routes/credentials.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerDbRoutes } from './routes/db.js';
import { registerCheckpointRoutes } from './routes/checkpoint.js';
import type { McpServerConfig } from '@harni/agent-core';
import { StaticFileService } from './services/staticFileService.js';

export function createApp(config: ServerConfig = {}): AppInstance {
  const port = config.port ?? parseInt(process.env.PORT || '3001', 10);
  const host = config.host ?? process.env.HOST ?? '127.0.0.1';
  const authToken =
    config.authToken ||
    process.env.AUTH_TOKEN ||
    process.env.CLINE_AUTH_TOKEN ||
    process.env.SERVER_API_KEY ||
    undefined;
  const maxBodySize =
    config.maxBodySize ??
    (process.env.MAX_BODY_SIZE ? parseInt(process.env.MAX_BODY_SIZE, 10) : DEFAULT_MAX_BODY_SIZE);
  const readBodyOpts: ReadBodyOptions = { maxBodySize };
  const allowInsecureRemote = process.env.ALLOW_INSECURE_REMOTE_ACCESS === 'true';

  validateHostBindingSecurity(host, authToken, allowInsecureRemote);

  const workspaceRoot = path.resolve(
    config.workspaceRoot || process.env.WORKSPACE_ROOT || process.cwd(),
  );

  const fsService = new FSService(workspaceRoot);
  const ptyService = new PTYService({ workspaceRoot });
  const dbService = new DBService({
    dbPath: config.dbPath || process.env.HARNI_DB_PATH || process.env.CLINE_DB_PATH,
  });

  const mcpEnabledSetting = dbService.getSetting('mcp_enabled');
  const mcpConfigSetting = dbService.getSetting('mcp_config');
  const mcpEnabled = mcpEnabledSetting === 'true';
  let mcpServers: Record<string, McpServerConfig> = {};
  if (mcpConfigSetting) {
    try {
      const parsed = JSON.parse(mcpConfigSetting);
      if (parsed && typeof parsed === 'object') {
        mcpServers = parsed.mcpServers || parsed;
      }
    } catch (e) {
      console.warn('[Server] Failed to parse mcp_config from database:', e);
    }
  }

  const engine = new AgentCoreEngine({
    workspaceRoot,
    defaultProvider: config.defaultProvider || 'anthropic',
    defaultModel: config.defaultModel,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    mcpEnabled,
    mcpServers,
    executeTerminalCommand: async (cmd, cwd, onData) => {
      return await ptyService.executeCommand(cmd, cwd, onData);
    },
  });

  if (mcpEnabled && Object.keys(mcpServers).length > 0) {
    engine.initializeMcp().then((res) => {
      console.log(`[MCP] Initialized: ${res.connected.length} connected, ${res.failed.length} failed`);
      if (res.failed.length > 0) {
        for (const f of res.failed) {
          console.warn(`[MCP] Failed to connect server '${f.name}': ${f.error}`);
        }
      }
    }).catch((err) => {
      console.error('[MCP] Failed to initialize MCP servers:', err);
    });
  }

  const wsHandler = new WebSocketHandler(engine, fsService, ptyService, dbService, workspaceRoot);

  const serverContext: ServerContext = {
    workspaceRoot,
    authToken,
    maxBodySize,
    readBodyOpts,
    engine,
    fsService,
    ptyService,
    dbService,
    wsHandler,
  };

  const router = new Router();
  registerHealthRoutes(router);
  registerWorkspaceRoutes(router);
  registerModelRoutes(router);
  registerAuthRoutes(router);
  registerCredentialsRoutes(router);
  registerSkillsRoutes(router);
  registerMcpRoutes(router);
  registerDbRoutes(router);
  registerCheckpointRoutes(router);

  const staticService = process.env.HARNI_STATIC_DIR
    ? new StaticFileService(process.env.HARNI_STATIC_DIR)
    : null;

  const server = http.createServer(async (req, res) => {
    const matched = await router.handle(req, res, serverContext, async () => {
      if (staticService) {
        return staticService.handle(req, res);
      }
      sendJsonResponse(res, 404, { error: 'Not Found' });
      return true;
    });
    if (!matched && !res.headersSent && !res.writableEnded) {
      sendJsonResponse(res, 404, { error: 'Not Found' });
    }
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, callback) => {
      if (!authToken) {
        callback(true);
        return;
      }
      const req = info.req;
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const token = extractAuthTokenFromRequest(req, url);

      if (token && timingSafeCompare(token, authToken)) {
        callback(true);
      } else {
        console.warn(
          `[WS Security] Unauthorized WebSocket connection attempt rejected from ${req.socket.remoteAddress || 'unknown'}`,
        );
        callback(false, 401, 'Unauthorized: Missing or invalid authentication token');
      }
    },
  });

  wss.on('connection', (ws, req) => {
    wsHandler.handleConnection(ws, req);
  });

  const start = async (): Promise<number> => {
    return new Promise((resolve) => {
      server.listen(port, host, () => {
        const actualPort = (server.address() as any)?.port || port;
        console.log(`⚡ Harni server listening on http://${host}:${actualPort} (WS path: /ws)`);
        console.log(`📁 Workspace Root: ${workspaceRoot}`);
        console.log(`💾 SQLite Database: ${dbService.getPath()}`);
        resolve(actualPort);
      });
    });
  };

  const stop = async (): Promise<void> => {
    await fsService.close();
    return new Promise((resolve) => {
      ptyService.close();
      dbService.close();
      wss.close(() => {
        server.close(() => {
          resolve();
        });
      });
    });
  };

  return {
    server,
    wss,
    engine,
    fsService,
    ptyService,
    dbService,
    wsHandler,
    port,
    start,
    stop,
  };
}

export * from './types/server.js';
export * from './utils/security.js';
export * from './utils/http.js';
export * from './routes/router.js';
