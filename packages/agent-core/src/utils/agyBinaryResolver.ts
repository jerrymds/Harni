import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export class AgyBinaryResolver {
  private static cachedPath: string | null = null;

  public static async resolve(explicitPath?: string): Promise<string> {
    if (explicitPath) {
      return explicitPath;
    }

    if (this.cachedPath) {
      return this.cachedPath;
    }

    if (process.env.AGY_BINARY_PATH) {
      this.cachedPath = process.env.AGY_BINARY_PATH;
      return this.cachedPath;
    }

    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'agy.exe' : 'agy';
    const candidatePaths = [
      path.join(homeDir, '.gemini', 'bin', binaryName),
      path.join(homeDir, '.antigravity', 'bin', binaryName),
      ...(process.env.LOCALAPPDATA
        ? [
            path.join(process.env.LOCALAPPDATA, 'agy', 'bin', binaryName),
            path.join(process.env.LOCALAPPDATA, 'Programs', 'agy', 'bin', binaryName),
          ]
        : []),
    ];

    for (const cand of candidatePaths) {
      try {
        await fs.access(cand);
        this.cachedPath = cand;
        return cand;
      } catch {
        // Continue
      }
    }

    // Fallback to binary name expecting PATH resolution
    return binaryName;
  }
}
