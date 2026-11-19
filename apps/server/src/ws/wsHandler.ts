import type { WebSocket } from 'ws';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { type AgentCoreEngine, composeAntigravityModel, isPathWithinRoot } from '@harni/agent-core';
import {
  normalizeAgentMode,
  type ClientMessage,
  type ServerMessage,
  type ServerToClientEvents,
} from '@harni/types';
import type { FSService } from '../services/fsService.js';
import type { PTYService } from '../services/ptyService.js';
import type { DBService } from '../services/dbService.js';
import { AntigravityBridgeManager } from '../services/antigravityBridgeManager.js';
import { AnthropicAuthPage } from '../services/anthropicAuthPage.js';
import { OpenAIAuthPage } from '../services/openaiAuthPage.js';
import {
  getAllowedWorkspaceRoots as collectAllowedWorkspaceRoots,
  resolveAuthorizedWorkspaceRoot,
} from '../utils/workspaceSecurity.js';

export class WebSocketHandler {
  private clients = new Set<WebSocket>();
  private clientWorkspaceRoots = new Map<WebSocket, string>();
  private sessionWorkspaceRoots = new Map<string, string>();
  private sessionSubscribers = new Map<string, Set<WebSocket>>();
  private clientSubscriptions = new Map<WebSocket, Set<string>>();
  private defaultWorkspaceRoot: string;
  private approvedWorkspaceRoots: Set<string>;
  private configuredAllowedRoots: string[];
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
    options?: {
      approvedWorkspaceRoots?: Set<string>;
      configuredAllowedRoots?: string[];
    },
  ) {
    this.engine = engine;
    this.fsService = fsService;
    this.ptyService = ptyService;
    this.dbService = dbService;
    this.defaultWorkspaceRoot = path.resolve(
      defaultWorkspaceRoot || fsService.getWorkspaceRoot() || process.cwd(),
    );
    this.approvedWorkspaceRoots = options?.approvedWorkspaceRoots ?? new Set<string>();
    this.configuredAllowedRoots = (options?.configuredAllowedRoots ?? []).map((r) => path.resolve(r));

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

  private getAllowedWorkspaceRoots(ws: WebSocket): string[] {
    return collectAllowedWorkspaceRoots({
      defaultWorkspaceRoot: this.defaultWorkspaceRoot,
      dbService: this.dbService,
      engine: this.engine,
      approvedWorkspaceRoots: this.approvedWorkspaceRoots,
      configuredAllowedRoots: this.configuredAllowedRoots,
      extraRoots: [this.getClientWorkspaceRoot(ws), ...this.sessionWorkspaceRoots.values()],
    });
  }

  private resolveValidatedWorkspaceRoot(ws: WebSocket, requestedRoot?: string): string {
    const clientRoot = this.getClientWorkspaceRoot(ws);
    if (!requestedRoot) {
      return clientRoot;
    }
    const resolved = path.resolve(requestedRoot);
    const allowedRoots = this.getAllowedWorkspaceRoots(ws);
    if (!allowedRoots.some((allowed) => isPathWithinRoot(resolved, allowed))) {
      throw new Error(
        `Path traversal denied: workspaceRoot '${requestedRoot}' is outside allowed workspace roots`,
      );
    }
    return resolved;
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
          const swarmBoard = this.engine.getSwarmBoardService?.().getBoardState(sessionId);
          if (
            swarmBoard &&
            (swarmBoard.title || swarmBoard.members.length > 0 || swarmBoard.messages.length > 0)
          ) {
            this.send(ws, 'swarm:updated', swarmBoard);
          }
          const schedules = this.engine.getSchedulerService?.().listSchedules(sessionId) || [];
          for (const s of schedules) {
            this.send(ws, 'schedule:created', {
              sessionId,
              scheduleId: s.id,
              kind: s.kind,
              prompt: s.prompt,
              nextRunAt: s.nextRunAt,
              cronExpression: s.cronExpression,
              durationSeconds: s.durationSeconds,
              isDaemon: s.isDaemon,
              iterations: s.iterations,
            });
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
        const sessionId =
          'sessionId' in msg.payload && typeof msg.payload.sessionId === 'string'
            ? msg.payload.sessionId
            : undefined;
        if (targetPath) {
          try {
            const resolvedPath = resolveAuthorizedWorkspaceRoot(targetPath, {
              defaultWorkspaceRoot: this.defaultWorkspaceRoot,
              dbService: this.dbService,
              engine: this.engine,
              approvedWorkspaceRoots: this.approvedWorkspaceRoots,
              configuredAllowedRoots: this.configuredAllowedRoots,
            });
            if (!fsSync.existsSync(resolvedPath) || !fsSync.statSync(resolvedPath).isDirectory()) {
              throw new Error(`Workspace directory does not exist: ${targetPath}`);
            }

            const info = await this.fsService.getWorkspaceInfo(resolvedPath);
            const tree = await this.fsService.getFileTree(1, resolvedPath);

            this.clientWorkspaceRoots.set(ws, resolvedPath);
            if (sessionId) {
              this.sessionWorkspaceRoots.set(sessionId, resolvedPath);
            }

            this.send(ws, 'workspace:info', info);
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
          attachments,
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
          contextWindow,
        } = msg.payload;

        if (sessionId) {
          this.subscribeSession(ws, sessionId);
        }

        let validatedRequestedRoot: string | undefined;
        if (workspaceRoot) {
          try {
            validatedRequestedRoot = this.resolveValidatedWorkspaceRoot(ws, workspaceRoot);
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.send(ws, 'error', {
              code: 'TASK_EXECUTION_ERROR',
              message: errorMsg,
              sessionId,
            });
            break;
          }
        }

        const effectiveWorkspaceRoot =
          validatedRequestedRoot ||
          (sessionId ? this.sessionWorkspaceRoots.get(sessionId) : undefined) ||
          this.getClientWorkspaceRoot(ws);

        if (sessionId && effectiveWorkspaceRoot) {
          this.sessionWorkspaceRoots.set(sessionId, effectiveWorkspaceRoot);
        }
        if (validatedRequestedRoot) {
          this.clientWorkspaceRoots.set(ws, validatedRequestedRoot);
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
        if (provider === 'antigravity' && effectiveModel) {
          effectiveModel = composeAntigravityModel(effectiveModel, thinkingDepth);
        }
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

        const dbAgyMode = this.dbService ? this.dbService.getSetting('antigravity_bridge_mode') : undefined;
        const envAgyMode = process.env.ANTIGRAVITY_AGY_MODE || process.env.ANTIGRAVITY_EXECUTION_MODE;
        const rawAgyMode = String(msg.payload.antigravityMode || dbAgyMode || envAgyMode || 'acp').toLowerCase();
        const antigravityMode: 'acp' | 'direct' = rawAgyMode === 'direct' ? 'direct' : 'acp';

        this.engine
          .startTask(prompt, {
            sessionId,
            attachments,
            mode: normalizeAgentMode(mode),
            provider,
            model: effectiveModel,
            apiKey: effectiveApiKey,
            baseURL: effectiveBaseURL,
            autoApprove,
            thinkingDepth,
            antigravityMode,
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
            contextWindow,
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

      case 'subagent:kill': {
        const { subagentId, sessionId } = msg.payload;
        if (subagentId) {
          this.engine.getSubagentManager().manageSubagents('kill', [subagentId], sessionId);
        }
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
        try {
          const requestedRoot =
            msg.payload && 'workspaceRoot' in msg.payload && msg.payload.workspaceRoot
              ? msg.payload.workspaceRoot
              : undefined;
          const workspace = this.resolveValidatedWorkspaceRoot(ws, requestedRoot);
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
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.send(ws, 'error', {
            code: 'CHECKPOINT_PRUNE_ERROR',
            message: errorMsg,
          });
        }
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
        try {
          const terminalId = ('terminalId' in msg.payload && msg.payload.terminalId) || `term_${Date.now()}`;
          const requestedRoot =
            'workspaceRoot' in msg.payload && msg.payload.workspaceRoot
              ? msg.payload.workspaceRoot
              : undefined;
          const root = this.resolveValidatedWorkspaceRoot(ws, requestedRoot);
          this.ptyService.createSession(terminalId, {
            workspaceRoot: root,
            cols: 'cols' in msg.payload ? msg.payload.cols : undefined,
            rows: 'rows' in msg.payload ? msg.payload.rows : undefined,
            shell: 'shell' in msg.payload ? msg.payload.shell : undefined,
          });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.send(ws, 'error', {
            code: 'TERMINAL_CREATE_ERROR',
            message: errorMsg,
          });
        }
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
          const primaryRoot = this.resolveValidatedWorkspaceRoot(ws, msg.payload.workspaceRoot);
          const candidateRoots = [
            primaryRoot,
            ...this.getAllowedWorkspaceRoots(ws).filter((r) => r !== primaryRoot),
          ];

          let content: string | undefined;
          let lastErr: unknown;
          for (const candidateRoot of candidateRoots) {
            try {
              content = await this.fsService.readFile(msg.payload.path, candidateRoot);
              break;
            } catch (readErr: unknown) {
              lastErr = readErr;
              // Relative paths only resolve against primaryRoot; only retry other trusted roots for absolute paths (e.g. worktrees)
              if (!path.isAbsolute(msg.payload.path)) {
                throw readErr;
              }
            }
          }
          if (content === undefined) {
            throw lastErr;
          }
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
          const root = this.resolveValidatedWorkspaceRoot(ws, msg.payload.workspaceRoot);
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
        try {
          const requestedRoot =
            'workspaceRoot' in msg.payload && msg.payload.workspaceRoot
              ? msg.payload.workspaceRoot
              : undefined;
          const root = this.resolveValidatedWorkspaceRoot(ws, requestedRoot);

          if (requestedRoot) {
            this.clientWorkspaceRoots.set(ws, root);
          }

          const info = await this.fsService.getWorkspaceInfo(root);
          this.send(ws, 'workspace:info', info);
          const tree = await this.fsService.getFileTree(1, root);
          this.send(ws, 'workspace:tree', { tree });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.send(ws, 'error', {
            code: 'WORKSPACE_REFRESH_ERROR',
            message: errorMsg,
          });
        }
        break;
      }

      case 'workspace:getDir': {
        try {
          const requestedRoot =
            msg.payload && 'workspaceRoot' in msg.payload && msg.payload.workspaceRoot
              ? msg.payload.workspaceRoot
              : undefined;
          const root = this.resolveValidatedWorkspaceRoot(ws, requestedRoot);
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
      'wakeup:queued',
      'schedule:created',
      'schedule:triggered',
      'schedule:cancelled',
      'swarm:updated',
      'swarm:message',
      'test:result',
      'file:diagnostics',
      'checkpoint:created',
      'checkpoint:restored',
      'checkpoint:pruned',
      'worktree:status',
      'probe:result',
      'error',
    ];

    const forwardEvent = <K extends keyof ServerToClientEvents>(eventName: K) => {
      this.engine.on(eventName, (payload: ServerToClientEvents[K]) => {
        if (
          payload &&
          typeof payload === 'object' &&
          'sessionId' in payload &&
          typeof payload.sessionId === 'string' &&
          payload.sessionId
        ) {
          this.broadcastToSession(payload.sessionId, eventName, payload);
        } else {
          this.broadcast(eventName, payload);
        }
      });
    };

    for (const eventName of forwardEvents) {
      forwardEvent(eventName);
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
