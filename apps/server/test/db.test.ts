import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createApp } from '../src/server.js';

describe('Server SQLite DB REST Endpoints', () => {
  const tempDir = path.resolve('temp_server_test_db');
  let app: any;
  let port: number;

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    app = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath: path.join(tempDir, 'cline-test.db'),
    });
    port = await app.start();
  });

  afterAll(async () => {
    if (app) await app.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('manages folders, sessions, and messages via REST API', async () => {
    // 1. Initial state
    const initRes = await fetch(`http://localhost:${port}/api/db/init`);
    const initJson = (await initRes.json()) as any;
    expect(initRes.ok).toBe(true);
    expect(Array.isArray(initJson.folders)).toBe(true);

    // 2. Create folders
    const createFolderRes = await fetch(`http://localhost:${port}/api/db/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'folder_test_1',
        name: 'Project Alpha',
        path: tempDir,
        createdAt: Date.now(),
        isCollapsed: false,
      }),
    });
    expect(createFolderRes.ok).toBe(true);

    // 3. Create session with provider & model
    const createSessionRes = await fetch(`http://localhost:${port}/api/db/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'session_test_1',
        folderId: 'folder_test_1',
        title: 'Alpha Refactor Task',
        mode: 'code',
        provider: 'antigravity',
        model: 'gemini-3.7-flash',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        messages: [
          {
            id: 'msg_1',
            role: 'user',
            content: 'Hello SQLite!',
            timestamp: Date.now(),
          },
        ],
      }),
    });
    expect(createSessionRes.ok).toBe(true);

    // 4. Get session details
    const getSessionRes = await fetch(`http://localhost:${port}/api/db/sessions/session_test_1`);
    const sessionJson = (await getSessionRes.json()) as any;
    expect(getSessionRes.ok).toBe(true);
    expect(sessionJson.model).toBe('gemini-3.7-flash');
    expect(sessionJson.provider).toBe('antigravity');
    expect(sessionJson.messages.length).toBe(1);

    // 5. Append message
    const appendMsgRes = await fetch(
      `http://localhost:${port}/api/db/sessions/session_test_1/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'msg_2',
          role: 'assistant',
          content: 'Hello! I am ready with gemini-3.7-flash.',
          timestamp: Date.now(),
        }),
      },
    );
    expect(appendMsgRes.ok).toBe(true);

    const updatedSessionRes = await fetch(
      `http://localhost:${port}/api/db/sessions/session_test_1`,
    );
    const updatedSessionJson = (await updatedSessionRes.json()) as any;
    expect(updatedSessionJson.messages.length).toBe(2);
    expect(updatedSessionJson.messages[1].content).toContain('gemini-3.7-flash');

    // 6. Delete session and folder
    const delSessionRes = await fetch(`http://localhost:${port}/api/db/sessions/session_test_1`, { method: 'DELETE' });
    expect(delSessionRes.ok).toBe(true);

    const getDeletedSessionRes = await fetch(`http://localhost:${port}/api/db/sessions/session_test_1`);
    expect(getDeletedSessionRes.status).toBe(404);

    const delFolderRes = await fetch(`http://localhost:${port}/api/db/folders/folder_test_1`, { method: 'DELETE' });
    expect(delFolderRes.ok).toBe(true);
  });

  it('imports legacy sessions and folders', async () => {
    const importRes = await fetch(`http://localhost:${port}/api/db/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folders: [
          {
            id: 'folder_migrated',
            name: 'Migrated Folder',
            createdAt: Date.now(),
          },
        ],
        sessions: [
          {
            id: 'session_migrated',
            folderId: 'folder_migrated',
            title: 'Migrated Session',
            mode: 'architect',
            provider: 'anthropic',
            model: 'claude-3-5-sonnet-20241022',
            createdAt: Date.now(),
            messages: [
              {
                id: 'migrated_msg_1',
                role: 'user',
                content: 'Migrated content',
                timestamp: Date.now(),
              },
            ],
          },
        ],
      }),
    });
    const importJson = (await importRes.json()) as any;
    expect(importRes.ok).toBe(true);
    expect(importJson.importedSessions).toBe(1);
    expect(importJson.importedFolders).toBe(1);
  });

  it('defaults to .harni directory with harni.db and auto-creates directory on first launch', async () => {
    const { DBService } = await import('../src/services/dbService.js');
    const mockHome = path.join(tempDir, `test_user_home_${Date.now()}`);
    const targetDir = path.join(mockHome, '.harni');
    const targetDb = path.join(targetDir, 'harni.db');

    const fsSync = await import('node:fs');
    expect(fsSync.existsSync(targetDir)).toBe(false);

    const svc = new DBService({ dbPath: targetDb });
    expect(svc.getPath()).toBe(targetDb);
    expect(fsSync.existsSync(targetDir)).toBe(true);
    expect(fsSync.existsSync(targetDb)).toBe(true);
    svc.close();
  });
});
