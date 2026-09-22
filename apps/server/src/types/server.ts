import type * as http from 'node:http';
import type { WebSocketServer } from 'ws';
import type { AgentCoreEngine } from '@harni/agent-core';
import type { LLMProviderType } from '@harni/types';
import type { FSService } from '../services/fsService.js';
import type { PTYService } from '../services/ptyService.js';
import type { DBService } from '../services/dbService.js';
import type { WebSocketHandler } from '../ws/wsHandler.js';

export interface ServerConfig {
  port?: number;
  host?: string;
  authToken?: string;
  workspaceRoot?: string;
  defaultProvider?: LLMProviderType;
  defaultModel?: string;
  apiKey?: string;
  baseURL?: string;
  dbPath?: string;
  maxBodySize?: number;
}

export interface ReadBodyOptions {
  maxBodySize?: number;
}

export interface AppInstance {
  server: http.Server;
  wss: WebSocketServer;
  engine: AgentCoreEngine;
  fsService: FSService;
  ptyService: PTYService;
  dbService: DBService;
  wsHandler: WebSocketHandler;
  port: number;
  start: () => Promise<number>;
  stop: () => Promise<void>;
}

export interface ServerContext {
  workspaceRoot: string;
  authToken?: string;
  maxBodySize: number;
  readBodyOpts: ReadBodyOptions;
  engine: AgentCoreEngine;
  fsService: FSService;
  ptyService: PTYService;
  dbService: DBService;
  wsHandler: WebSocketHandler;
}

export interface RequestContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: Record<string, string>;
  ctx: ServerContext;
}

export type RouteHandler = (rc: RequestContext) => Promise<boolean | void> | boolean | void;
