import { spawn } from 'node:child_process';
import * as path from 'node:path';

let nodePty: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodePty = require('node-pty');
} catch {
  nodePty = null;
}

export interface PTYOptions {
  workspaceRoot: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

export interface PTYSessionOptions {
  terminalId?: string;
  workspaceRoot?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

export interface PTYSessionInfo {
  id: string;
  workspaceRoot: string;
  shell: string;
  cols: number;
  rows: number;
  isNodePty: boolean;
  createdAt: number;
}

export interface PTYSession {
  id: string;
  workspaceRoot: string;
  shell: string;
  cols: number;
  rows: number;
  isNodePty: boolean;
  proc: any;
  createdAt: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export class PTYService {
  private defaultWorkspaceRoot: string;
  private defaultShell: string;
  private defaultCols: number;
  private defaultRows: number;

  private sessions = new Map<string, PTYSession>();
  private globalDataListeners = new Set<(data: string, terminalId: string) => void>();
  private sessionDataListeners = new Map<string, Set<(data: string) => void>>();

  constructor(options: PTYOptions) {
    this.defaultWorkspaceRoot = path.resolve(options.workspaceRoot);
    this.defaultCols = options.cols ?? 80;
    this.defaultRows = options.rows ?? 24;

    const isWindows = process.platform === 'win32';
    if (options.shell) {
      this.defaultShell = options.shell;
    } else if (isWindows) {
      this.defaultShell = 'powershell.exe';
    } else {
      this.defaultShell = process.env.SHELL || '/bin/bash';
    }
  }

  /**
   * Resolve appropriate shell for the platform
   */
  private resolveShell(shell?: string): string {
    if (shell) return shell;
    const isWindows = process.platform === 'win32';
    return isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  }

  /**
   * Emit data from a specific session to both global and session-specific listeners
   */
  private emitSessionData(terminalId: string, data: string): void {
    for (const listener of this.globalDataListeners) {
      try {
        listener(data, terminalId);
      } catch (err) {
        console.error(`[PTY] Error in global data listener:`, err);
      }
    }

    const listeners = this.sessionDataListeners.get(terminalId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (err) {
          console.error(`[PTY] Error in session data listener for ${terminalId}:`, err);
        }
      }
    }
  }

  /**
   * Internal session process factory
   */
  private spawnSessionProcess(
    terminalId: string,
    workspaceRoot: string,
    shell: string,
    cols: number,
    rows: number,
  ): { proc: any; isNodePty: boolean } {
    if (nodePty) {
      try {
        const proc = nodePty.spawn(shell, [], {
          name: 'xterm-color',
          cols,
          rows,
          cwd: workspaceRoot,
          env: process.env as Record<string, string>,
          useConpty: false,
        });

        proc.onData((data: string) => {
          this.emitSessionData(terminalId, data);
        });

        proc.onExit(() => {
          this.sessions.delete(terminalId);
        });

        return { proc, isNodePty: true };
      } catch {
        // Fallback to child_process.spawn
      }
    }

    const isWindows = process.platform === 'win32';
    const shellArgs = isWindows ? ['-NoLogo', '-NoExit'] : ['-i'];

    const child = spawn(shell, shellArgs, {
      cwd: workspaceRoot,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    child.stdout.on('data', (chunk: Buffer) => {
      this.emitSessionData(terminalId, chunk.toString());
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.emitSessionData(terminalId, chunk.toString());
    });

    child.on('close', () => {
      this.sessions.delete(terminalId);
    });

    return { proc: child, isNodePty: false };
  }

  /**
   * Create or replace an interactive PTY session
   */
  public createSession(
    terminalId: string = 'default',
    options: Partial<PTYSessionOptions> = {},
  ): PTYSession {
    if (this.sessions.has(terminalId)) {
      this.closeSession(terminalId);
    }

    const workspaceRoot = options.workspaceRoot
      ? path.resolve(options.workspaceRoot)
      : this.defaultWorkspaceRoot;
    const shell = this.resolveShell(options.shell || this.defaultShell);
    const cols = options.cols ?? this.defaultCols;
    const rows = options.rows ?? this.defaultRows;

    const { proc, isNodePty } = this.spawnSessionProcess(
      terminalId,
      workspaceRoot,
      shell,
      cols,
      rows,
    );

    const isWindows = process.platform === 'win32';
    const session: PTYSession = {
      id: terminalId,
      workspaceRoot,
      shell,
      cols,
      rows,
      isNodePty,
      proc,
      createdAt: Date.now(),
      write: (data: string) => {
        if (!session.proc) return;
        if (session.isNodePty) {
          session.proc.write(data);
        } else if (session.proc.stdin) {
          const formatted = isWindows && data.endsWith('\r') && !data.endsWith('\r\n') ? data + '\n' : data;
          session.proc.stdin.write(formatted);
        }
      },
      resize: (newCols: number, newRows: number) => {
        session.cols = newCols;
        session.rows = newRows;
        if (session.isNodePty && session.proc?.resize) {
          try {
            session.proc.resize(newCols, newRows);
          } catch {}
        }
      },
      close: () => {
        if (session.proc) {
          try {
            session.proc.kill();
          } catch {}
          session.proc = null;
        }
        this.sessions.delete(terminalId);
        this.sessionDataListeners.delete(terminalId);
      },
    };

    this.sessions.set(terminalId, session);
    return session;
  }

  /**
   * Get an existing session or create a new one if not found
   */
  public getOrCreateSession(
    terminalId: string = 'default',
    options?: Partial<PTYSessionOptions>,
  ): PTYSession {
    const existing = this.sessions.get(terminalId);
    if (existing && existing.proc) {
      return existing;
    }
    return this.createSession(terminalId, options);
  }

  /**
   * Get session by ID
   */
  public getSession(terminalId: string): PTYSession | undefined {
    return this.sessions.get(terminalId);
  }

  /**
   * Check if session exists and is active
   */
  public hasSession(terminalId: string): boolean {
    return this.sessions.has(terminalId);
  }

  /**
   * Close a specific session
   */
  public closeSession(terminalId: string): boolean {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.close();
      return true;
    }
    return false;
  }

  /**
   * List metadata of all active PTY sessions
   */
  public listSessions(): PTYSessionInfo[] {
    const list: PTYSessionInfo[] = [];
    for (const session of this.sessions.values()) {
      list.push({
        id: session.id,
        workspaceRoot: session.workspaceRoot,
        shell: session.shell,
        cols: session.cols,
        rows: session.rows,
        isNodePty: session.isNodePty,
        createdAt: session.createdAt,
      });
    }
    return list;
  }

  /**
   * Write data to a specific terminal session (defaults to 'default')
   */
  public write(data: string, terminalId: string = 'default'): void {
    const session = this.getOrCreateSession(terminalId);
    session.write(data);
  }

  /**
   * Resize a specific terminal session (defaults to 'default')
   */
  public resize(cols: number, rows: number, terminalId: string = 'default'): void {
    const session = this.getOrCreateSession(terminalId);
    session.resize(cols, rows);
  }

  /**
   * Listen to data across all sessions
   */
  public onData(listener: (data: string, terminalId: string) => void): () => void {
    this.globalDataListeners.add(listener);
    return () => {
      this.globalDataListeners.delete(listener);
    };
  }

  /**
   * Listen to data for a specific session
   */
  public onSessionData(terminalId: string, listener: (data: string) => void): () => void {
    let listeners = this.sessionDataListeners.get(terminalId);
    if (!listeners) {
      listeners = new Set<(data: string) => void>();
      this.sessionDataListeners.set(terminalId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners && listeners.size === 0) {
        this.sessionDataListeners.delete(terminalId);
      }
    };
  }

  /**
   * Execute an isolated non-interactive command for Agent Tool Execution.
   * Completely separated from interactive Xterm PTY sessions to prevent stream collision.
   */
  public async executeCommand(
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
    timeoutMs: number = 60000,
  ): Promise<{ exitCode: number; output: string }> {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/bash';
    const shellArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command];
    const workingDir = cwd || this.defaultWorkspaceRoot;

    return new Promise<{ exitCode: number; output: string }>((resolve) => {
      let isSettled = false;
      let fullOutput = '';

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: {
          ...process.env,
          TERM: 'dumb',
          PAGER: 'cat',
          GIT_PAGER: 'cat',
          CI: 'true',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });

      // Close stdin immediately so command never hangs waiting for interactive keyboard input
      try {
        child.stdin?.end();
      } catch {}

      const timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try {
            if (isWindows && child.pid) {
              // Kill entire process tree on Windows
              spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
            } else {
              child.kill('SIGKILL');
            }
          } catch {}
          resolve({
            exitCode: 124,
            output: fullOutput + `\n⚠️ [逾時警告] 指令執行超過 ${timeoutMs / 1000} 秒已被系統安全中止。`,
          });
        }
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        onData?.(text);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        onData?.(text);
      });

      child.on('close', (code) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutTimer);
          resolve({
            exitCode: code ?? 0,
            output: fullOutput || '(指令執行完成，無終端輸出)',
          });
        }
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutTimer);
          resolve({
            exitCode: 1,
            output: `指令啟動失敗: ${err.message}`,
          });
        }
      });
    });
  }

  public getWorkspaceRoot(): string {
    return this.defaultWorkspaceRoot;
  }

  public setWorkspaceRoot(newRoot: string, terminalId?: string): void {
    const resolved = path.resolve(newRoot);
    if (terminalId) {
      const session = this.sessions.get(terminalId);
      if (session && session.workspaceRoot !== resolved) {
        this.closeSession(terminalId);
        this.createSession(terminalId, { workspaceRoot: resolved });
      }
    } else {
      if (this.defaultWorkspaceRoot !== resolved) {
        this.defaultWorkspaceRoot = resolved;
        this.close();
      }
    }
  }

  /**
   * Close all active PTY sessions
   */
  public close(): void {
    for (const session of this.sessions.values()) {
      try {
        session.close();
      } catch {}
    }
    this.sessions.clear();
    this.sessionDataListeners.clear();
  }
}
