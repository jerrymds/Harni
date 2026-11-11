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

function safeCleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}

function copyResources() {
  const webDistSrc = path.join(monorepoRoot, 'apps', 'web', 'dist');
  const webDistDest = path.join(deployDir, 'resources', 'web-dist');
  if (!fs.existsSync(path.join(webDistSrc, 'index.html'))) {
    console.error('[dist] apps/web/dist is missing. Run "pnpm --filter @harni/web build" first.');
    process.exit(1);
  }
  safeCleanDir(webDistDest);
  fs.cpSync(webDistSrc, webDistDest, { recursive: true });
  console.log(`[dist] Copied web frontend into resources.`);
}

// 1. Ensure dist exists (main.js)
if (!fs.existsSync(path.join(desktopDir, 'dist', 'main.js'))) {
  console.error('[dist] apps/desktop/dist/main.js missing. Run "pnpm --filter @harni/desktop build" first.');
  process.exit(1);
}

// 2. Create the standalone deploy directory (production node_modules only, no symlinks)
safeCleanDir(deployDir);
run(`pnpm --filter @harni/desktop --prod deploy "${deployDir}"`, { cwd: monorepoRoot });

// Remove potential NTFS junction pointing back to desktopDir to prevent recursive directory loops
const recursiveJunction = path.join(deployDir, 'node_modules', '.pnpm', 'node_modules', '@harni', 'desktop');
if (fs.existsSync(recursiveJunction)) {
  try {
    fs.rmSync(recursiveJunction, { recursive: false, force: true });
  } catch {
    // Non-critical cleanup
  }
}

console.log('[dist] Deploy directory created.');

// 3. Copy static resources into the deploy dir
copyResources();

// 4. Run electron-builder using the locally installed builder
fs.mkdirSync(releaseDir, { recursive: true });
const localBuilderCli = path.join(desktopDir, 'node_modules', 'electron-builder', 'cli.js');
const rootBuilderCli = path.join(monorepoRoot, 'node_modules', 'electron-builder', 'cli.js');
const electronBuilderCli = fs.existsSync(localBuilderCli)
  ? localBuilderCli
  : fs.existsSync(rootBuilderCli)
    ? rootBuilderCli
    : null;

// Determine Electron version since devDependencies are excluded in deployDir
let electronVersion = null;
try {
  const electronPkgPath = path.join(desktopDir, 'node_modules', 'electron', 'package.json');
  if (fs.existsSync(electronPkgPath)) {
    electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')).version;
  }
} catch {
  // ignore
}
if (!electronVersion) {
  try {
    const desktopPkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
    const rawVer = desktopPkg.devDependencies?.electron || desktopPkg.dependencies?.electron || '';
    electronVersion = rawVer.replace(/[\^~]/g, '');
  } catch {
    // ignore
  }
}

const electronVerArg = electronVersion ? ` -c.electronVersion="${electronVersion}"` : '';

const builderCmd = electronBuilderCli
  ? `node "${electronBuilderCli}" --win -c.directories.output="${releaseDir}"${electronVerArg}`
  : `npx electron-builder --win -c.directories.output="${releaseDir}"${electronVerArg}`;

run(builderCmd, { cwd: deployDir });
console.log(`[dist] Done. Installer is in ${releaseDir}`);
