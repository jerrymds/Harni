import type { WebSocket } from 'ws';
import * as path from 'node:path';
import type { AgentCoreEngine } from '@harni/agent-core';
import type {
  ClientMessage,
  ServerMessage,
  ServerToClientEvents,
} from '@harni/types';
import type { FSService } from '../services/fsService.js';
import type { PTYService } from '../services/ptyService.js';
import type { DBService } from '../services/dbService.js';
import { AntigravityBridgeManager } from '../services/antigravityBridgeManager.js';
import { AnthropicAuthPage } from '../services/anthropicAuthPage.js';
import { OpenAIAuthPage } from '../services/openaiAuthPage.js';

export class WebSocketHandler {
  private clients = new Set<WebSocket>();
  private clientWorkspaceRoots = new Map<WebSocket, string>();
  private sessionWorkspaceRoots = new Map<string, string>();
  private sessionSubscribers = new Map<string, Set<WebSocket>>();
  private clientSubscriptions = new Map<WebSocket, Set<string>>();
  private defaultWorkspaceRoot: string;
  private engine: AgentCoreEngine;
  private fsService: FSService;
  private ptyService: PTYService;
  private dbService?: DBService;

  constructor(
    engine: AgentCoreEngine,
    fsService: FSService,
    ptyService: PTYService,
    dbService?: DBService,
    defaultWorkspaceRoot?: string,
  ) {
    this.engine = engine;
    this.fsService = fsService;
    this.ptyService = ptyService;
    this.dbService = dbService;
    this.defaultWorkspaceRoot = path.resolve(
      defaultWorkspaceRoot || fsService.getWorkspaceRoot() || process.cwd(),
    );

    this.bindEngineEvents();
    this.bindServiceEvents();
  }

  public subscribeSession(ws: WebSocket, sessionId: string): void {
    if (!sessionId) return;
    let subs = this.sessionSubscribers.get(sessionId);
    if (!subs) {
      subs = new Set<WebSocket>();
      this.sessionSubscribers.set(sessionId, subs);
    }
    subs.add(ws);

    let clientSubs = this.clientSubscriptions.get(ws);
    if (!clientSubs) {
      clientSubs = new Set<string>();
      this.clientSubscriptions.set(ws, clientSubs);
    }
    clientSubs.add(sessionId);
  }

  public unsubscribeSession(ws: WebSocket, sessionId: string): void {
    if (!sessionId) return;
    const subs = this.sessionSubscribers.get(sessionId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) {
        this.sessionSubscribers.delete(sessionId);
      }
    }

    const clientSubs = this.clientSubscriptions.get(ws);
    if (clientSubs) {
      clientSubs.delete(sessionId);
      if (clientSubs.size === 0) {
        this.clientSubscriptions.delete(ws);
      }
    }
  }

  private removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
    this.clientWorkspaceRoots.delete(ws);

    const clientSubs = this.clientSubscriptions.get(ws);
    if (clientSubs) {
      for (const sessionId of clientSubs) {
        const subs = this.sessionSubscribers.get(sessionId);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) {
            this.sessionSubscribers.delete(sessionId);
          }
        }
      }
      this.clientSubscriptions.delete(ws);
    }
  }

  public handleConnection(ws: WebSocket, req?: import('node:http').IncomingMessage): void {
    this.clients.add(ws);
    this.clientWorkspaceRoots.set(ws, this.defaultWorkspaceRoot);
    this.subscribeSession(ws, 'default');
    const clientIp = req?.socket?.remoteAddress || 'local';
    console.log(`[WS] Client connected (${clientIp}). Total active clients: ${this.clients.size}`);

    // Send initial workspace info and tree
    this.sendInitialState(ws).catch((err) => {
      console.error('[WS] Failed to send initial state:', err);
    });

    ws.on('message', async (data: Buffer | string) => {
      try {
        const text = data.toString();
        const msg = JSON.parse(text) as ClientMessage;
        await this.handleClientMessage(ws, msg);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.send(ws, 'error', {
          code: 'INVALID_MESSAGE',
          message: `Failed to process message: ${errorMsg}`,
        });
      }
    });

    ws.on('close', () => {
      this.removeClient(ws);
      console.log(`[WS] Client disconnected. Total active clients: ${this.clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client socket error:', err);
      this.removeClient(ws);
    });
  }

  private getClientWorkspaceRoot(ws: WebSocket): string {
    return this.clientWorkspaceRoots.get(ws) || this.defaultWorkspaceRoot;
  }

  private async sendInitialState(ws: WebSocket): Promise<void> {
    const root = this.getClientWorkspaceRoot(ws);
    const info = await this.fsService.getWorkspaceInfo(root);
    this.send(ws, 'workspace:info', info);

    const tree = await this.fsService.getFileTree(1, root);
    this.send(ws, 'workspace:tree', { tree });

    const currentTask = this.engine.getTaskState();
    if (currentTask) {
      this.send(ws, 'task:state', currentTask);
    }
  }

  private async handleClientMessage(
    ws: WebSocket,
    msg: ClientMessage,
  ): Promise<void> {
    switch (msg.type) {
      case 'session:subscribe': {
        const sessionId = msg.payload?.sessionId;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
          const sessionTaskState = this.engine.getTaskState(sessionId);
          if (sessionTaskState) {
            this.send(ws, 'task:state', sessionTaskState);
          }
        }
        break;
      }

      case 'session:unsubscribe': {
        const sessionId = msg.payload?.sessionId;
        if (sessionId) {
          this.unsubscribeSession(ws, sessionId);
        }
        break;
      }

      case 'workspace:set': {
        const targetPath = msg.payload.path;
        const sessionId = ('sessionId' in msg.payload && (msg.payload as any).sessionId) || undefined;
        if (targetPath) {
          try {
            const resolvedPath = path.resolve(targetPath);
            this.clientWorkspaceRoots.set(ws, resolvedPath);
            if (sessionId) {
              this.sessionWorkspaceRoots.set(sessionId, resolvedPath);
            }

            const info = await this.fsService.getWorkspaceInfo(resolvedPath);
            this.send(ws, 'workspace:info', info);

            const tree = await this.fsService.getFileTree(1, resolvedPath);
            this.send(ws, 'workspace:tree', { tree });
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[WS] Failed to switch workspace directory:', errorMsg);
            this.send(ws, 'error', {
              code: 'WORKSPACE_SET_ERROR',
              message: `Failed to set workspace directory: ${errorMsg}`,
            });
          }
        }
        break;
      }

      case 'user:prompt': {
        const {
          sessionId,
          prompt,
          mode,
          provider,
          model,
          apiKey,
          baseURL,
          autoApprove,
          thinkingDepth,
          contextFiles,
          workspaceRoot,
          history,
          maxTurns,
          autoTest,
          testCommand,
          enableWorktree,
          enableCheckpoint,
          subagentsEnabled,
        } = msg.payload;

        if (sessionId) {
          this.subscribeSession(ws, sessionId);
        }

        const effectiveWorkspaceRoot =
          (workspaceRoot ? path.resolve(workspaceRoot) : undefined) ||
          (sessionId ? this.sessionWorkspaceRoots.get(sessionId) : undefined) ||
          this.getClientWorkspaceRoot(ws);

        if (sessionId && effectiveWorkspaceRoot) {
          this.sessionWorkspaceRoots.set(sessionId, effectiveWorkspaceRoot);
        }
        if (workspaceRoot) {
          this.clientWorkspaceRoots.set(ws, path.resolve(workspaceRoot));
        }

        if (provider === 'antigravity') {
          try {
            const manager = AntigravityBridgeManager.getInstance();
            const bridgeReady = await manager.checkHealth();
            if (!bridgeReady) {
              console.warn(
                `[WS] ⚠️ External Antigravity Bridge is offline on ${manager.getBaseURL()}. Please ensure the external bridge is running.`,
              );
            }
          } catch (err) {
            console.warn('[WS] Failed to probe external Antigravity Bridge:', err);
          }
        }

        const dbApiKey = provider && this.dbService
          ? this.dbService.getApiKey(provider, { oauthFallback: false }) || undefined
          : undefined;

        // Built-in providers (cline, anthropic, openai, antigravity, etc.) store encrypted keys in the DB.
        // If a DB key exists for this provider, prioritize it over client-sent payload unless provider is 'custom'.
        let effectiveApiKey = (provider !== 'custom' && dbApiKey)
          ? dbApiKey
          : (apiKey || dbApiKey);

        const dbBaseUrl = provider && this.dbService
          ? (this.dbService.getSetting(`base_url_${provider}`) || (provider === 'custom' ? this.dbService.getSetting('custom_base_url') : null) || undefined)
          : undefined;
        const effectiveBaseURL = (provider === 'custom' ? (baseURL || dbBaseUrl) : (baseURL || dbBaseUrl)) || undefined;

        // Anthropic provider with a Claude Pro/Max subscription login.
        let anthropicOAuth = false;
        let openaiOAuth = false;
        let openaiAccountId: string | undefined;
        let effectiveModel = model;
        if (provider === 'anthropic' && !effectiveApiKey && this.dbService) {
          try {
            const session = await AnthropicAuthPage.ensureSession(this.dbService);
            if (session) {
              effectiveApiKey = session.accessToken;
              anthropicOAuth = true;
              console.log('[WS] Using Claude subscription (OAuth) for Anthropic provider.');
            }
          } catch (err) {
            console.warn('[WS] Failed to resolve Claude session:', err);
          }
        }

        if (provider === 'openai' && !effectiveApiKey && this.dbService) {
          try {
            const session = await OpenAIAuthPage.ensureSession(this.dbService);
            if (session) {
              effectiveApiKey = session.accessToken;
              openaiAccountId = session.accountId;
              openaiOAuth = true;
              const subscriptionModels = await OpenAIAuthPage.fetchSubscriptionModels(session);
              if (!effectiveModel || !subscriptionModels.some((item) => item.id === effectiveModel)) {
                effectiveModel = subscriptionModels[0]!.id;
                console.log(`[WS] Selected OpenAI model is unavailable; using ${effectiveModel}.`);
              }
              console.log('[WS] Using ChatGPT subscription (OAuth) for OpenAI provider.');
            }
          } catch (err) {
            console.warn('[WS] Failed to resolve OpenAI subscription session:', err);
          }
        }

        this.engine
          .startTask(prompt, {
            sessionId,
            mode,
            provider,
            model: effectiveModel,
            apiKey: effectiveApiKey,
            baseURL: effectiveBaseURL,
            autoApprove,
            thinkingDepth,
            contextFiles,
            workspaceRoot: effectiveWorkspaceRoot,
            history,
            anthropicOAuth,
            openaiOAuth,
            openaiAccountId,
            maxTurns,
            autoTest,
            testCommand,
            enableWorktree,
            enableCheckpoint,
            subagentsEnabled,
          })
          .catch((err: unknown) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[WS] Task execution error:', errorMsg);
            this.send(ws, 'error', {
              code: 'TASK_EXECUTION_ERROR',
              message: errorMsg,
              sessionId,
            });
            this.send(ws, 'task:status', {
              status: 'error',
              taskId: '',
              sessionId,
            });
          });
        break;
      }

      case 'task:new': {
        const sessionId = 'sessionId' in msg.payload ? msg.payload.sessionId : undefined;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
        }
        this.engine.resetSession(sessionId);
        break;
      }

      case 'task:cancel': {
        const sessionId = msg.payload && 'sessionId' in msg.payload ? msg.payload.sessionId : undefined;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
        }
        this.engine.cancelTask(msg.payload);
        break;
      }

      case 'checkpoint:rollback': {
        const sessionId = msg.payload?.sessionId;
        const checkpointId = msg.payload?.checkpointId;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
        }
        this.engine
          .rollbackCheckpoint(sessionId, checkpointId)
          .then(async (res) => {
            if (res.success) {
              const root = this.getClientWorkspaceRoot(ws);
              const tree = await this.fsService.getFileTree(1, root);
              this.send(ws, 'workspace:tree', { tree });
            }
          })
          .catch((err: unknown) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.send(ws, 'error', {
              code: 'ROLLBACK_ERROR',
              message: errorMsg,
              sessionId,
            });
          });
        break;
      }

      case 'checkpoint:prune': {
        const workspace = msg.payload && 'workspaceRoot' in msg.payload && msg.payload.workspaceRoot
          ? msg.payload.workspaceRoot
          : this.getClientWorkspaceRoot(ws);
        const maxRetained = msg.payload && 'maxRetained' in msg.payload ? msg.payload.maxRetained : undefined;
        this.engine
          .pruneCheckpointsAndBranches(workspace, maxRetained)
          .catch((err: unknown) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.send(ws, 'error', {
              code: 'CHECKPOINT_PRUNE_ERROR',
              message: errorMsg,
            });
          });
        break;
      }

      case 'worktree:merge': {
        const sessionId = msg.payload?.sessionId;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
          this.engine
            .mergeWorktree(sessionId, msg.payload?.commitMessage)
            .then(async (res) => {
              if (res.success) {
                const root = this.getClientWorkspaceRoot(ws);
                const tree = await this.fsService.getFileTree(1, root);
                this.send(ws, 'workspace:tree', { tree });
              }
            })
            .catch((err: unknown) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              this.send(ws, 'error', {
                code: 'WORKTREE_MERGE_ERROR',
                message: errorMsg,
                sessionId,
              });
            });
        }
        break;
      }

      case 'worktree:discard': {
        const sessionId = msg.payload?.sessionId;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
          this.engine
            .discardWorktree(sessionId)
            .catch((err: unknown) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              this.send(ws, 'error', {
                code: 'WORKTREE_DISCARD_ERROR',
                message: errorMsg,
                sessionId,
              });
            });
        }
        break;
      }

      case 'tool:approve': {
        const { toolCallId, approved, feedback, sessionId } = msg.payload;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
        }
        this.engine.handleApproval(toolCallId, approved, feedback, sessionId);
        break;
      }

      case 'question:answer': {
        const { toolCallId, answers, customInput, sessionId } = msg.payload;
        if (sessionId) {
          this.subscribeSession(ws, sessionId);
        }
        this.engine.handleAnswerQuestion(toolCallId, answers, customInput, sessionId);
        break;
      }

      case 'terminal:input': {
        const terminalId = msg.payload.terminalId || 'default';
        this.ptyService.write(msg.payload.data, terminalId);
        break;
      }

      case 'terminal:resize': {
        const terminalId = msg.payload.terminalId || 'default';
        this.ptyService.resize(msg.payload.cols, msg.payload.rows, terminalId);
        break;
      }

      case 'terminal:create': {
        const terminalId = ('terminalId' in msg.payload && msg.payload.terminalId) || `term_${Date.now()}`;
        const root = ('workspaceRoot' in msg.payload && msg.payload.workspaceRoot)
          ? path.resolve(msg.payload.workspaceRoot)
          : this.getClientWorkspaceRoot(ws);
        this.ptyService.createSession(terminalId, {
          workspaceRoot: root,
          cols: 'cols' in msg.payload ? msg.payload.cols : undefined,
          rows: 'rows' in msg.payload ? msg.payload.rows : undefined,
          shell: 'shell' in msg.payload ? msg.payload.shell : undefined,
        });
        break;
      }

      case 'terminal:close': {
        if ('terminalId' in msg.payload && msg.payload.terminalId) {
          this.ptyService.closeSession(msg.payload.terminalId);
        }
        break;
      }

      case 'file:open': {
        try {
          const root = msg.payload.workspaceRoot
            ? path.resolve(msg.payload.workspaceRoot)
            : this.getClientWorkspaceRoot(ws);
          const content = await this.fsService.readFile(msg.payload.path, root);
          this.send(ws, 'file:content', { path: msg.payload.path, content });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.send(ws, 'error', {
            code: 'FILE_READ_ERROR',
            message: errorMsg,
          });
        }
        break;
      }

      case 'file:save': {
        try {
          const root = msg.payload.workspaceRoot
            ? path.resolve(msg.payload.workspaceRoot)
            : this.getClientWorkspaceRoot(ws);
          await this.fsService.writeFile(msg.payload.path, msg.payload.content, root);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.send(ws, 'error', {
            code: 'FILE_WRITE_ERROR',
            message: errorMsg,
          });
        }
        break;
      }

      case 'workspace:refresh': {
        const root =
          'workspaceRoot' in msg.payload && msg.payload.workspaceRoot
            ? path.resolve(msg.payload.workspaceRoot)
            : this.getClientWorkspaceRoot(ws);

        if ('workspaceRoot' in msg.payload && msg.payload.workspaceRoot) {
          this.clientWorkspaceRoots.set(ws, root);
        }

        const info = await this.fsService.getWorkspaceInfo(root);
        this.send(ws, 'workspace:info', info);
        const tree = await this.fsService.getFileTree(1, root);
        this.send(ws, 'workspace:tree', { tree });
        break;
      }

      case 'workspace:getDir': {
        try {
          const root =
            msg.payload && 'workspaceRoot' in msg.payload && msg.payload.workspaceRoot
              ? path.resolve(msg.payload.workspaceRoot)
              : this.getClientWorkspaceRoot(ws);
          const targetRelPath = (msg.payload && 'path' in msg.payload && msg.payload.path) || '';
          const children = await this.fsService.getDirectoryNodes(targetRelPath, root);
          this.send(ws, 'workspace:dir', { path: targetRelPath, children, workspaceRoot: root });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.send(ws, 'error', {
            code: 'DIR_READ_ERROR',
            message: errorMsg,
          });
        }
        break;
      }
    }
  }

  public send<K extends keyof ServerToClientEvents>(
    ws: WebSocket,
    type: K,
    payload: ServerToClientEvents[K],
  ): void {
    if (ws.readyState === ws.OPEN) {
      const message: ServerMessage = {
        type,
        payload,
        timestamp: Date.now(),
      } as ServerMessage;
      ws.send(JSON.stringify(message));
    }
  }

  public broadcast<K extends keyof ServerToClientEvents>(
    type: K,
    payload: ServerToClientEvents[K],
  ): void {
    const message: ServerMessage = {
      type,
      payload,
      timestamp: Date.now(),
    } as ServerMessage;
    const json = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(json);
      }
    }
  }

  public broadcastToSession<K extends keyof ServerToClientEvents>(
    sessionId: string,
    type: K,
    payload: ServerToClientEvents[K],
  ): void {
    const subs = this.sessionSubscribers.get(sessionId);
    if (!subs || subs.size === 0) {
      return;
    }
    const message: ServerMessage = {
      type,
      payload,
      timestamp: Date.now(),
    } as ServerMessage;
    const json = JSON.stringify(message);

    for (const client of subs) {
      if (client.readyState === client.OPEN) {
        client.send(json);
      }
    }
  }

  private bindEngineEvents(): void {
    const forwardEvents: Array<keyof ServerToClientEvents> = [
      'chat:token',
      'chat:thinking',
      'task:status',
      'task:state',
      'question:ask',
      'tool:request',
      'tool:result',
      'file:diff',
      'terminal:data',
      'subagent:spawned',
      'subagent:status',
      'subagent:token',
      'subagent:tool',
      'subagent:completed',
      'test:result',
      'file:diagnostics',
      'checkpoint:created',
      'checkpoint:restored',
      'checkpoint:pruned',
      'worktree:status',
      'error',
    ];

    for (const eventName of forwardEvents) {
      this.engine.on(eventName, (payload: any) => {
        if (payload && typeof payload === 'object' && payload.sessionId) {
          this.broadcastToSession(payload.sessionId, eventName, payload);
        } else {
          this.broadcast(eventName, payload);
        }
      });
    }
  }

  private bindServiceEvents(): void {
    this.fsService.onTreeChange((tree, changedRoot) => {
      for (const client of this.clients) {
        const clientRoot = this.getClientWorkspaceRoot(client);
        if (clientRoot === changedRoot) {
          this.send(client, 'workspace:tree', { tree });
        }
      }
    });

    this.fsService.onDirChange((relPath, children, changedRoot) => {
      for (const client of this.clients) {
        const clientRoot = this.getClientWorkspaceRoot(client);
        if (clientRoot === changedRoot) {
          this.send(client, 'workspace:dir', { path: relPath, children, workspaceRoot: changedRoot });
        }
      }
    });

    this.ptyService.onData((data, terminalId) => {
      this.broadcast('terminal:data', { data, terminalId });
    });
  }
}
