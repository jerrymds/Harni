import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type {
  ChatSession,
  ChatMessage,
  WorkspaceFolder,
  AgentMode,
  LLMProviderType,
} from '@harni/types';
import { SecurityService } from './securityService.js';

export interface DBServiceOptions {
  dbPath?: string;
  securityService?: SecurityService;
}

export class DBService {
  private db: DatabaseSync;
  private dbPath: string;
  private security: SecurityService;

  constructor(options: DBServiceOptions = {}) {
    const harniDir = path.join(os.homedir(), '.harni');
    const defaultPath =
      process.env.HARNI_DB_PATH ||
      process.env.CLINE_DB_PATH ||
      path.join(harniDir, 'harni.db');
    this.dbPath = path.resolve(options.dbPath || defaultPath);
    this.security = options.securityService || SecurityService.getInstance();

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Auto-migration: If default harni.db does not exist yet but legacy cline.db exists, migrate it
    if (
      !options.dbPath &&
      !process.env.HARNI_DB_PATH &&
      !process.env.CLINE_DB_PATH &&
      !fs.existsSync(this.dbPath)
    ) {
      const legacyDbPath = path.join(os.homedir(), '.cline-web', 'cline.db');
      if (fs.existsSync(legacyDbPath)) {
        try {
          fs.copyFileSync(legacyDbPath, this.dbPath);
          console.log(`[DBService] Migrated legacy database from ${legacyDbPath} to ${this.dbPath}`);
        } catch (err) {
          console.warn(`[DBService] Failed to migrate legacy database:`, err);
        }
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initDatabase();
  }

  public getPath(): string {
    return this.dbPath;
  }

  private initDatabase(): void {
    // Enable WAL mode for better concurrency and foreign keys support
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        created_at INTEGER NOT NULL,
        is_collapsed INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        folder_id TEXT,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        thinking TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        tool_result TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS credentials (
        provider TEXT PRIMARY KEY,
        encrypted_key TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_folder_id ON sessions(folder_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, timestamp ASC);
    `);
  }

  // --- Folders CRUD ---

  public getFolders(): WorkspaceFolder[] {
    const stmt = this.db.prepare(
      'SELECT id, name, path, created_at, is_collapsed, sort_order FROM folders ORDER BY sort_order ASC, created_at ASC',
    );
    const rows = stmt.all() as Array<{
      id: string;
      name: string;
      path: string | null;
      created_at: number;
      is_collapsed: number;
      sort_order: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path || undefined,
      createdAt: r.created_at,
      isCollapsed: Boolean(r.is_collapsed),
      sortOrder: r.sort_order,
    }));
  }

  public saveFolder(folder: WorkspaceFolder): void {
    const stmt = this.db.prepare(`
      INSERT INTO folders (id, name, path, created_at, is_collapsed, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        is_collapsed = excluded.is_collapsed,
        sort_order = excluded.sort_order;
    `);

    stmt.run(
      folder.id,
      folder.name,
      folder.path || null,
      folder.createdAt || Date.now(),
      folder.isCollapsed ? 1 : 0,
      folder.sortOrder || 0,
    );
  }

  public saveFolders(folders: WorkspaceFolder[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO folders (id, name, path, created_at, is_collapsed, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        is_collapsed = excluded.is_collapsed,
        sort_order = excluded.sort_order;
    `);

    for (const folder of folders) {
      stmt.run(
        folder.id,
        folder.name,
        folder.path || null,
        folder.createdAt || Date.now(),
        folder.isCollapsed ? 1 : 0,
        folder.sortOrder || 0,
      );
    }
  }

  public deleteFolder(folderId: string, fallbackFolderId?: string): void {
    if (fallbackFolderId) {
      const updateStmt = this.db.prepare('UPDATE sessions SET folder_id = ? WHERE folder_id = ?');
      updateStmt.run(fallbackFolderId, folderId);
    }
    const stmt = this.db.prepare('DELETE FROM folders WHERE id = ?');
    stmt.run(folderId);
  }

  // --- Sessions CRUD ---

  public getSessions(options: { includeMessages?: boolean } = {}): ChatSession[] {
    const stmt = this.db.prepare(
      'SELECT id, folder_id, title, mode, provider, model, created_at, updated_at FROM sessions ORDER BY created_at DESC',
    );
    const rows = stmt.all() as Array<{
      id: string;
      folder_id: string | null;
      title: string;
      mode: string;
      provider: string | null;
      model: string | null;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((r) => {
      const messages = options.includeMessages ? this.getMessages(r.id) : [];
      const msgCountStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?');
      const countRow = msgCountStmt.get(r.id) as { cnt: number } | undefined;
      const count = countRow ? countRow.cnt : 0;

      return {
        id: r.id,
        folderId: r.folder_id || undefined,
        title: r.title,
        mode: (r.mode as AgentMode) || 'code',
        provider: (r.provider as LLMProviderType) || undefined,
        model: r.model || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: count,
        messages: options.includeMessages ? messages : undefined,
      };
    });
  }

  public getSession(sessionId: string): ChatSession | null {
    const stmt = this.db.prepare(
      'SELECT id, folder_id, title, mode, provider, model, created_at, updated_at FROM sessions WHERE id = ?',
    );
    const row = stmt.get(sessionId) as
      | {
          id: string;
          folder_id: string | null;
          title: string;
          mode: string;
          provider: string | null;
          model: string | null;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;

    const messages = this.getMessages(sessionId);

    return {
      id: row.id,
      folderId: row.folder_id || undefined,
      title: row.title,
      mode: (row.mode as AgentMode) || 'code',
      provider: (row.provider as LLMProviderType) || undefined,
      model: row.model || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: messages.length,
      messages,
    };
  }

  public saveSession(session: ChatSession, saveMessages = true): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, folder_id, title, mode, provider, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        folder_id = excluded.folder_id,
        title = excluded.title,
        mode = excluded.mode,
        provider = excluded.provider,
        model = excluded.model,
        updated_at = excluded.updated_at;
    `);

    const now = Date.now();
    stmt.run(
      session.id,
      session.folderId || null,
      session.title || 'Conversation',
      session.mode || 'code',
      session.provider || null,
      session.model || null,
      session.createdAt || now,
      session.updatedAt || now,
    );

    if (saveMessages && Array.isArray(session.messages)) {
      this.saveMessages(session.id, session.messages);
    }
  }

  public saveSessions(sessions: ChatSession[]): void {
    for (const session of sessions) {
      this.saveSession(session, true);
    }
  }

  public deleteSession(sessionId: string): void {
    const delMsgStmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    delMsgStmt.run(sessionId);
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(sessionId);
  }

  // --- Messages CRUD ---

  public getMessages(sessionId: string): ChatMessage[] {
    const stmt = this.db.prepare(
      'SELECT id, session_id, role, content, thinking, tool_calls, tool_call_id, tool_result, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC',
    );
    const rows = stmt.all(sessionId) as Array<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      thinking: string | null;
      tool_calls: string | null;
      tool_call_id: string | null;
      tool_result: string | null;
      timestamp: number;
    }>;

    return rows.map((r) => {
      let toolCalls: any = undefined;
      let toolResult: any = undefined;

      if (r.tool_calls) {
        try {
          toolCalls = JSON.parse(r.tool_calls);
        } catch {}
      }

      if (r.tool_result) {
        try {
          toolResult = JSON.parse(r.tool_result);
        } catch {}
      }

      return {
        id: r.id,
        role: r.role as any,
        content: r.content,
        thinking: r.thinking || undefined,
        toolCalls,
        toolCallId: r.tool_call_id || undefined,
        toolResult,
        timestamp: r.timestamp,
      };
    });
  }

  public saveMessages(sessionId: string, messages: ChatMessage[]): void {
    // Delete existing messages and re-insert or upsert
    this.clearSessionMessages(sessionId);

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, thinking, tool_calls, tool_call_id, tool_result, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const msg of messages) {
      stmt.run(
        msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sessionId,
        msg.role || 'user',
        msg.content || '',
        msg.thinking || null,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolCallId || null,
        msg.toolResult ? JSON.stringify(msg.toolResult) : null,
        msg.timestamp || Date.now(),
      );
    }

    // Update session updatedAt timestamp
    const updateSessionStmt = this.db.prepare(
      'UPDATE sessions SET updated_at = ? WHERE id = ?',
    );
    updateSessionStmt.run(Date.now(), sessionId);
  }

  public appendMessage(sessionId: string, msg: ChatMessage): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, thinking, tool_calls, tool_call_id, tool_result, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        thinking = excluded.thinking,
        tool_calls = excluded.tool_calls,
        tool_call_id = excluded.tool_call_id,
        tool_result = excluded.tool_result,
        timestamp = excluded.timestamp;
    `);

    stmt.run(
      msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId,
      msg.role || 'user',
      msg.content || '',
      msg.thinking || null,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolCallId || null,
      msg.toolResult ? JSON.stringify(msg.toolResult) : null,
      msg.timestamp || Date.now(),
    );

    const updateSessionStmt = this.db.prepare(
      'UPDATE sessions SET updated_at = ? WHERE id = ?',
    );
    updateSessionStmt.run(Date.now(), sessionId);
  }

  public clearSessionMessages(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    stmt.run(sessionId);
  }

  // --- Settings Key-Value Store ---

  public getSetting(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  public setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;
    `);
    stmt.run(key, value, Date.now());
  }

  public getSettings(): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  public saveSettings(settings: Record<string, string>): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;
    `);
    const now = Date.now();
    for (const [k, v] of Object.entries(settings)) {
      if (typeof v === 'string') {
        stmt.run(k, v, now);
      }
    }
  }

  // --- Encrypted Credentials Vault (AES-256-GCM) ---

  public getSecurityService(): SecurityService {
    return this.security;
  }

  /**
   * Sets and securely encrypts an API Key for a given LLM provider in SQLite
   */
  public setApiKey(provider: string, plainApiKey: string): void {
    const trimmed = plainApiKey.trim();
    if (!trimmed) {
      this.deleteApiKey(provider);
      return;
    }

    const encrypted = this.security.encrypt(trimmed);
    const stmt = this.db.prepare(`
      INSERT INTO credentials (provider, encrypted_key, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        encrypted_key = excluded.encrypted_key,
        updated_at = excluded.updated_at;
    `);
    stmt.run(provider, encrypted, Date.now());
  }

  /**
   * Retrieves and decrypts the API Key for a provider.
   * Falls back to environment variable if not found in database.
   */
  public getApiKey(provider: string, options: { oauthFallback?: boolean } = {}): string | null {
    const { oauthFallback = true } = options;
    const stmt = this.db.prepare('SELECT encrypted_key FROM credentials WHERE provider = ?');
    const row = stmt.get(provider) as { encrypted_key: string } | undefined;

    if (row && row.encrypted_key) {
      try {
        const decrypted = this.security.decrypt(row.encrypted_key);
        if (decrypted && decrypted.trim()) {
          return decrypted.trim();
        }
      } catch (err) {
        console.warn(`[DBService] Failed to decrypt API key for provider ${provider}:`, err);
      }
    }

    // Fall back to a Claude (Pro/Max) subscription OAuth token when no direct key is set.
    if (oauthFallback && provider === 'anthropic') {
      const payload = this.getOAuthPayload('anthropic');
      const token = payload?.accessToken || payload?.access_token;
      if (token) {
        return String(token);
      }
    }

    if (oauthFallback && provider === 'openai') {
      const payload = this.getOAuthPayload('openai');
      if (payload?.accessToken) return String(payload.accessToken);
    }

    // Fallback to environment variables
    switch (provider) {
      case 'cline':
        return process.env.CLINE_API_KEY || null;
      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY || null;
      case 'openai':
        return process.env.OPENAI_API_KEY || null;
      case 'antigravity':
        return process.env.ANTIGRAVITY_AUTH_TOKEN || null;
      case 'openrouter':
        return process.env.OPENROUTER_API_KEY || null;
      case 'opencode':
        return process.env.OPENCODE_API_KEY || null;
      case 'custom':
        return process.env.CUSTOM_API_KEY || null;
      default:
        return null;
    }
  }

  /**
   * Retrieves a stored OAuth payload (JSON blob) for a provider's `<provider>-oauth`
   * credential slot (e.g. `anthropic-oauth`). Returns null if absent or unparseable.
   */
  public getOAuthPayload(provider: string): Record<string, any> | null {
    const stmt = this.db.prepare('SELECT encrypted_key FROM credentials WHERE provider = ?');
    const row = stmt.get(`${provider}-oauth`) as { encrypted_key: string } | undefined;
    if (!row || !row.encrypted_key) return null;
    try {
      const decrypted = this.security.decrypt(row.encrypted_key);
      const parsed = JSON.parse(decrypted);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      console.warn(`[DBService] Failed to decode OAuth payload for ${provider}:`, err);
      return null;
    }
  }

  /**
   * Returns safe, masked status for all supported providers (no plaintext keys exposed)
   */
  public getAllCredentialsStatus(): Record<string, { configured: boolean; maskedKey?: string }> {
    const supportedProviders = [
      'cline', 'anthropic', 'anthropic-oauth', 'openai', 'openai-oauth', 'antigravity', 'ollama', 'openrouter', 'opencode', 'custom',
    ];
    const result: Record<string, { configured: boolean; maskedKey?: string }> = {};

    for (const provider of supportedProviders) {
      if (provider === 'ollama') {
        result[provider] = { configured: true, maskedKey: 'Local daemon (免金鑰)' };
        continue;
      }

      // For the plain `anthropic` slot, only report a *direct* key/env value — the
      // Claude subscription OAuth session is surfaced separately under `anthropic-oauth`.
      const key = this.getApiKey(provider, { oauthFallback: false });
      if (key && key.trim()) {
        if (provider === 'antigravity' || provider === 'anthropic-oauth' || provider === 'openai-oauth') {
          const providerLabel =
            provider === 'antigravity' ? '已登入 Google 帳號' :
              provider === 'openai-oauth' ? '已登入 OpenAI 帳號' : '已登入 Claude 帳號';
          let emailLabel = providerLabel;
          try {
            const parsed = JSON.parse(key);
            if (parsed.email) {
              emailLabel = `已連結 (${parsed.email})`;
            }
          } catch {}
          result[provider] = {
            configured: true,
            maskedKey: emailLabel,
          };
        } else {
          result[provider] = {
            configured: true,
            maskedKey: this.security.maskApiKey(key),
          };
        }
      } else {
        result[provider] = {
          configured: false,
        };
      }
    }

    return result;
  }

  /**
   * Deletes the stored encrypted API Key for a provider
   */
  public deleteApiKey(provider: string): void {
    const stmt = this.db.prepare('DELETE FROM credentials WHERE provider = ?');
    stmt.run(provider);
  }

  // --- Initial State and Bulk Import ---

  public getInitialState(): {
    folders: WorkspaceFolder[];
    sessions: ChatSession[];
    activeSessionId: string | null;
    activeFolderId: string | null;
    settings: Record<string, string>;
    credentials: Record<string, { configured: boolean; maskedKey?: string }>;
  } {
    const folders = this.getFolders();
    const sessions = this.getSessions({ includeMessages: true });
    const settings = this.getSettings();
    const credentials = this.getAllCredentialsStatus();

    let activeSessionId = settings['active_session_id'] || null;
    let activeFolderId = settings['active_folder_id'] || null;

    if (!activeSessionId && sessions.length > 0) {
      activeSessionId = sessions[0]!.id;
    }
    if (!activeFolderId && folders.length > 0) {
      activeFolderId = folders[0]!.id;
    }

    return {
      folders,
      sessions,
      activeSessionId,
      activeFolderId,
      settings,
      credentials,
    };
  }

  public importLegacyData(data: {
    folders?: WorkspaceFolder[];
    sessions?: ChatSession[];
    settings?: Record<string, string>;
  }): {
    importedFolders: number;
    importedSessions: number;
    importedMessages: number;
  } {
    let importedFolders = 0;
    let importedSessions = 0;
    let importedMessages = 0;

    if (Array.isArray(data.folders) && data.folders.length > 0) {
      this.saveFolders(data.folders);
      importedFolders = data.folders.length;
    }

    if (Array.isArray(data.sessions) && data.sessions.length > 0) {
      for (const s of data.sessions) {
        this.saveSession(s, true);
        importedSessions++;
        if (Array.isArray(s.messages)) {
          importedMessages += s.messages.length;
        }
      }
    }

    if (data.settings && typeof data.settings === 'object') {
      this.saveSettings(data.settings);
    }

    return {
      importedFolders,
      importedSessions,
      importedMessages,
    };
  }

  public close(): void {
    this.db.close();
  }
}

