import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createApp } from './server.js';

// Robust .env loading for monorepo
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '../.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
dotenv.config();

function resolveDefaultWorkspace(): string {
  if (process.env.WORKSPACE_ROOT) {
    return path.resolve(process.env.WORKSPACE_ROOT);
  }
  // When running from inside apps/server, default to monorepo root
  const monorepoRoot = path.resolve(process.cwd(), '../..');
  if (fs.existsSync(path.join(monorepoRoot, 'pnpm-workspace.yaml'))) {
    return monorepoRoot;
  }
  return process.cwd();
}

const app = createApp({
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '127.0.0.1',
  authToken: process.env.AUTH_TOKEN || process.env.CLINE_AUTH_TOKEN || process.env.SERVER_API_KEY,
  workspaceRoot: resolveDefaultWorkspace(),
});

app.start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export * from './server.js';
export * from './services/fsService.js';
export * from './services/ptyService.js';
export * from './services/dbService.js';
export * from './services/antigravityBridgeManager.js';
export * from './services/staticFileService.js';
export * from './ws/wsHandler.js';


