export interface BridgeManagerOptions {
  baseURL?: string;
  host?: string;
  port?: number;
}

export class AntigravityBridgeManager {
  private static instance: AntigravityBridgeManager | null = null;

  private baseURL: string;
  private host: string;
  private port: number;
  private lastError: string | null = null;

  constructor(options: BridgeManagerOptions = {}) {
    if (options.baseURL) {
      this.baseURL = options.baseURL.replace(/\/+$/, '');
      try {
        const u = new URL(this.baseURL);
        this.host = u.hostname;
        this.port = parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10);
      } catch {
        this.host = '127.0.0.1';
        this.port = 8123;
      }
    } else if (process.env.ANTIGRAVITY_BRIDGE_URL) {
      this.baseURL = process.env.ANTIGRAVITY_BRIDGE_URL.replace(/\/+$/, '');
      try {
        const u = new URL(this.baseURL);
        this.host = u.hostname;
        this.port = parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10);
      } catch {
        this.host = '127.0.0.1';
        this.port = 8123;
      }
    } else {
      this.host = options.host || process.env.ANTIGRAVITY_BRIDGE_HOST || '127.0.0.1';
      this.port = options.port || parseInt(process.env.ANTIGRAVITY_BRIDGE_PORT || '8123', 10);
      this.baseURL = `http://${this.host}:${this.port}`;
    }
  }

  public setBaseURL(url: string): void {
    this.baseURL = url.replace(/\/+$/, '');
    try {
      const u = new URL(this.baseURL);
      this.host = u.hostname;
      this.port = parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10);
    } catch {
      // ignore
    }
  }

  public static getInstance(options?: BridgeManagerOptions): AntigravityBridgeManager {
    if (!AntigravityBridgeManager.instance) {
      AntigravityBridgeManager.instance = new AntigravityBridgeManager(options);
    }
    return AntigravityBridgeManager.instance;
  }

  public getBaseURL(): string {
    return this.baseURL;
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  public hasRunningProcess(): boolean {
    return false;
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.getBaseURL()}/health`, {
        headers: { connection: 'close' },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        if (data.status === 'ok') {
          this.lastError = null;
          return true;
        }
      }
    } catch {
      // Offline / not responding
    }
    return false;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public async ensureRunning(): Promise<boolean> {
    const ok = await this.checkHealth();
    if (ok) {
      this.lastError = null;
      return true;
    }
    this.lastError = `無法連接外部 Antigravity Bridge (${this.getBaseURL()})。請確認外部 Bridge 服務已經啟動 (例如在獨立專案執行 python server.py --port ${this.port})，或檢查環境變數 ANTIGRAVITY_BRIDGE_URL 設定。`;
    return false;
  }

  public async stop(): Promise<void> {
    // External bridge is managed independently outside Harni
  }
}
