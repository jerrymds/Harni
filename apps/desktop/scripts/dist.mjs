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

function removeBrokenLinks(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removedCount = 0;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    let isBroken = false;
    try {
      fs.statSync(fullPath);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'UNKNOWN')) {
        isBroken = true;
      }
    }
    if (isBroken) {
      try {
        fs.unlinkSync(fullPath);
        removedCount++;
        continue;
      } catch {
        try {
          fs.rmSync(fullPath, { recursive: false, force: true });
          removedCount++;
          continue;
        } catch {
          try {
            fs.rmdirSync(fullPath);
            removedCount++;
            continue;
          } catch {
            // Non-critical if cannot remove
          }
        }
      }
    } else {
      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isDirectory() && !lstat.isSymbolicLink()) {
          removedCount += removeBrokenLinks(fullPath);
        }
      } catch {
        // ignore
      }
    }
  }
  return removedCount;
}

function prepareDeployedNodePty() {
  const deployPnpmDir = path.join(deployDir, 'node_modules', '.pnpm');
  if (!fs.existsSync(deployPnpmDir)) return;

  let pnpmEntries = [];
  try {
    pnpmEntries = fs.readdirSync(deployPnpmDir);
  } catch {
    return;
  }

  const nodePtyDirs = pnpmEntries.filter((name) => name.startsWith('node-pty'));
  if (nodePtyDirs.length === 0) return;

  const rootPnpmDir = path.join(monorepoRoot, 'node_modules', '.pnpm');

  for (const dirName of nodePtyDirs) {
    const deployedPtyPkg = path.join(deployPnpmDir, dirName, 'node_modules', 'node-pty');
    if (!fs.existsSync(path.join(deployedPtyPkg, 'package.json'))) continue;

    // 1. Apply SpectreMitigation patch to binding.gyp & winpty.gyp
    const gypFiles = [
      path.join(deployedPtyPkg, 'binding.gyp'),
      path.join(deployedPtyPkg, 'deps', 'winpty', 'src', 'winpty.gyp'),
    ];
    for (const gypFile of gypFiles) {
      if (fs.existsSync(gypFile)) {
        try {
          const content = fs.readFileSync(gypFile, 'utf8');
          if (content.includes("'SpectreMitigation': 'Spectre'")) {
            const patched = content.replaceAll("'SpectreMitigation': 'Spectre'", "'SpectreMitigation': 'false'");
            fs.writeFileSync(gypFile, patched, 'utf8');
          }
        } catch {
          // ignore
        }
      }
    }

    // 2. Sync root prebuilt Release binaries if .forge-meta exists
    let rootReleaseDir = path.join(rootPnpmDir, dirName, 'node_modules', 'node-pty', 'build', 'Release');
    if (!fs.existsSync(path.join(rootReleaseDir, '.forge-meta'))) {
      try {
        const rootEntries = fs.readdirSync(rootPnpmDir).filter((n) => n.startsWith('node-pty'));
        for (const re of rootEntries) {
          const candidate = path.join(rootPnpmDir, re, 'node_modules', 'node-pty', 'build', 'Release');
          if (fs.existsSync(path.join(candidate, '.forge-meta'))) {
            rootReleaseDir = candidate;
            break;
          }
        }
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(path.join(rootReleaseDir, '.forge-meta'))) {
      const deployReleaseDir = path.join(deployedPtyPkg, 'build', 'Release');
      fs.mkdirSync(deployReleaseDir, { recursive: true });
      fs.cpSync(rootReleaseDir, deployReleaseDir, { recursive: true, force: true });
      console.log(`[dist] Synced node-pty patch and prebuilt Release binaries (${dirName}).`);
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
let pnpmMajor = 9;
try {
  pnpmMajor = parseInt(execSync('pnpm -v', { encoding: 'utf8' }).trim().split('.')[0], 10) || 9;
} catch {
  // ignore
}
const allowBuildArg = pnpmMajor >= 11 ? ' --allow-build=node-pty' : '';
run(`pnpm --filter @harni/desktop --prod deploy${allowBuildArg} "${deployDir}"`, { cwd: monorepoRoot });

// Prepare deployed node-pty (apply SpectreMitigation patch and sync prebuilt binaries)
prepareDeployedNodePty();

// Clean broken junctions in root pnpm store that cause @electron/rebuild to crash
const rootPnpmNodeModules = path.join(monorepoRoot, 'node_modules', '.pnpm', 'node_modules');
const rootCleaned = removeBrokenLinks(rootPnpmNodeModules);
if (rootCleaned > 0) {
  console.log(`[dist] Removed ${rootCleaned} broken link(s) from root pnpm store.`);
}

// Remove potential NTFS junction pointing back to desktopDir to prevent recursive directory loops
const recursiveJunction = path.join(deployDir, 'node_modules', '.pnpm', 'node_modules', '@harni', 'desktop');
if (fs.existsSync(recursiveJunction)) {
  try {
    fs.rmSync(recursiveJunction, { recursive: false, force: true });
  } catch {
    // Non-critical cleanup
  }
}

// Clean any broken links in deployDir's node_modules
const deployNodeModules = path.join(deployDir, 'node_modules');
const deployCleaned = removeBrokenLinks(deployNodeModules);
if (deployCleaned > 0) {
  console.log(`[dist] Removed ${deployCleaned} broken link(s) from deploy directory.`);
}

// Ensure minimal pnpm-lock.yaml exists in deployDir so @electron/rebuild stops traversing upward
const deployLockfile = path.join(deployDir, 'pnpm-lock.yaml');
if (!fs.existsSync(deployLockfile)) {
  fs.writeFileSync(deployLockfile, "lockfileVersion: '9.0'\n", 'utf8');
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
