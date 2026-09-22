import { app, BrowserWindow, shell, type Event } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppInstance } from '@harni/server/dist/types/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serverApp: AppInstance | null = null;
let mainWindow: BrowserWindow | null = null;

const SERVER_PORT = 3001;

function resolveStaticDir(): string {
  // Packaged build: web dist is copied into resources/web-dist
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-dist');
  }
  // Development: serve the freshly built web frontend from the monorepo
  return path.resolve(__dirname, '../../web/dist');
}

/**
 * Default workspace for a fresh install.
 *
 * The user's home directory must not be used directly: scanning and watching
 * it indexes millions of unrelated files (AppData, caches, other projects),
 * which is what made the desktop shell balloon to gigabytes of memory. A
 * dedicated, initially empty folder keeps startup cheap; users add their real
 * project folders from the UI.
 */
function resolveDefaultWorkspace(): string {
  if (process.env.WORKSPACE_ROOT) {
    return process.env.WORKSPACE_ROOT;
  }
  const dir = path.join(app.getPath('home'), 'Harni');
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return app.getPath('home');
  }
}

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Harni',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links (OAuth flows, docs) in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url: target }: { url: string }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startBackend(): Promise<void> {
  process.env.HARNI_STATIC_DIR = resolveStaticDir();
  // Database: Use ~/.harni/harni.db by default to share data with Web version
  const targetDbPath = process.env.HARNI_DB_PATH || path.join(app.getPath('home'), '.harni', 'harni.db');
  const legacyDesktopDb = path.join(app.getPath('userData'), 'harni.db');
  if (!fs.existsSync(targetDbPath) && fs.existsSync(legacyDesktopDb)) {
    try {
      fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
      fs.copyFileSync(legacyDesktopDb, targetDbPath);
      console.log(`[Desktop] Migrated legacy database from ${legacyDesktopDb} to ${targetDbPath}`);
    } catch (err) {
      console.warn(`[Desktop] Failed to migrate database from userData:`, err);
    }
  }
  process.env.HARNI_DB_PATH = targetDbPath;
  process.env.PORT = String(SERVER_PORT);
  process.env.HOST = '127.0.0.1';
  // Keep the file watcher bounded: the default workspace is the user home,
  // which can contain millions of files. A depth cap makes memory usage flat.
  process.env.HARNI_WATCH_DEPTH = process.env.HARNI_WATCH_DEPTH || '2';
  process.env.HARNI_WATCH_MAX_ENTRIES = process.env.HARNI_WATCH_MAX_ENTRIES || '3000';
  // Default workspace: dedicated empty folder (see resolveDefaultWorkspace)
  process.env.WORKSPACE_ROOT = resolveDefaultWorkspace();

  // Import createApp directly so the backend runs inside the Electron main process
  const { createApp } = await import('@harni/server/dist/server.js');
  serverApp = createApp({
    port: SERVER_PORT,
    host: '127.0.0.1',
  });
  await serverApp.start();
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    createWindow(`http://127.0.0.1:${SERVER_PORT}`);
  } catch (err) {
    console.error('[Harni Desktop] Failed to start:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async (event: Event) => {
  if (serverApp) {
    event.preventDefault();
    const closing = serverApp;
    serverApp = null;
    try {
      await closing.stop();
    } finally {
      app.quit();
    }
  }
});
