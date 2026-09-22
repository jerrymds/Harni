// Builds the Windows installer via a standalone `pnpm deploy` directory.
//
// Why: pnpm workspace packages (@harni/server -> @harni/agent-core) are node_modules
// symlinks pointing OUTSIDE apps/desktop. electron-builder cannot pack files
// outside the app dir ("must be under ..."). `pnpm deploy` produces a
// self-contained copy with real (non-symlink) node_modules.
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const monorepoRoot = path.resolve(desktopDir, '..', '..');
const deployDir = path.join(desktopDir, '.deploy');
const releaseDir = path.join(desktopDir, 'release');

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function copyResources() {
  const webDistSrc = path.join(monorepoRoot, 'apps', 'web', 'dist');
  const webDistDest = path.join(deployDir, 'resources', 'web-dist');
  if (!fs.existsSync(path.join(webDistSrc, 'index.html'))) {
    console.error('[dist] apps/web/dist is missing. Run "pnpm --filter @harni/web build" first.');
    process.exit(1);
  }
  fs.rmSync(webDistDest, { recursive: true, force: true });
  fs.cpSync(webDistSrc, webDistDest, { recursive: true });
  console.log(`[dist] Copied web frontend into resources.`);
}

// 1. Ensure dist exists (main.js)
if (!fs.existsSync(path.join(desktopDir, 'dist', 'main.js'))) {
  console.error('[dist] apps/desktop/dist/main.js missing. Run "pnpm --filter @harni/desktop build" first.');
  process.exit(1);
}

// 2. Create the standalone deploy directory (real node_modules, no symlinks)
fs.rmSync(deployDir, { recursive: true, force: true });
run(`pnpm --filter @harni/desktop deploy "${deployDir}"`, { cwd: monorepoRoot });
console.log('[dist] Deploy directory created.');

// 3. Copy static resources into the deploy dir
copyResources();

// 4. Run electron-builder from inside the deploy dir
fs.mkdirSync(releaseDir, { recursive: true });
run(`npx electron-builder --win -c.directories.output="${releaseDir}"`, { cwd: deployDir });
console.log(`[dist] Done. Installer is in ${releaseDir}`);
