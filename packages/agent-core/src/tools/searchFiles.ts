import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import type { SearchFilesParams, ToolParametersSchema, ToolResult } from '@harni/types';

const SEARCH_IGNORES = new Set([
  '.git',
  'node_modules',
  '.turbo',
  'dist',
  'build',
  '.next',
  '.cache',
  '.pytest_cache',
  '.ruff_cache',
  '__pycache__',
  'coverage',
  '.idea',
  '.vscode',
  'tmp',
  'temp',
]);

const BINARY_EXTENSIONS = new Set([
  '.db',
  '.db-wal',
  '.db-shm',
  '.sqlite',
  '.sqlite3',
  '.bin',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.svg',
  '.bmp',
  '.tiff',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.pyc',
  '.pyd',
  '.class',
  '.o',
  '.obj',
]);

export class SearchFilesTool extends BaseTool<SearchFilesParams> {
  public readonly name = 'search_files';
  public readonly description =
    'Search for regex or literal text across files in the workspace. Returns matching file paths and lines.';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search term or regex pattern.',
      },
      path: {
        type: 'string',
        description: 'Directory path to scope search within (defaults to ".").',
      },
      isRegex: {
        type: 'boolean',
        description: 'Whether query should be evaluated as regular expression (defaults to false).',
      },
    },
    required: ['query'],
  };

  public async execute(
    params: SearchFilesParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      if (!params.query) {
        return {
          toolCallId: '',
          isError: true,
          output: 'Missing required parameter: query',
        };
      }

      const targetRelPath = params.path || '.';
      const safeDir = this.resolveSafePath(targetRelPath, context.workspaceRoot);
      const pattern = params.isRegex
        ? new RegExp(params.query, 'i')
        : params.query.toLowerCase();

      // Load simple .gitignore patterns if present in workspaceRoot
      const gitignorePatterns = await this.loadGitignorePatterns(context.workspaceRoot);

      const results: string[] = [];
      let totalMatches = 0;
      let totalChars = 0;
      const MAX_MATCHES = 100;
      const MAX_OUTPUT_CHARS = 40_000;
      const MAX_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5 MB max file size for text searching
      const MAX_LINE_LENGTH = 300;
      let isTruncated = false;

      const isIgnoredByGitignore = (relPath: string, fileName: string): boolean => {
        const normalized = relPath.replace(/\\/g, '/');
        for (const rule of gitignorePatterns) {
          if (rule.endsWith('/')) {
            const dirRule = rule.slice(0, -1);
            if (normalized === dirRule || normalized.startsWith(dirRule + '/')) return true;
          } else if (rule.includes('*')) {
            // Simple wildcard check
            const escaped = rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            if (new RegExp(`(^|/)${escaped}$`).test(normalized) || new RegExp(`^${escaped}$`).test(fileName)) {
              return true;
            }
          } else {
            if (normalized === rule || normalized.endsWith('/' + rule) || fileName === rule) return true;
          }
        }
        return false;
      };

      const isBinaryBuffer = (buf: Buffer): boolean => {
        const checkLen = Math.min(buf.length, 1024);
        for (let i = 0; i < checkLen; i++) {
          if (buf[i] === 0) return true;
        }
        return false;
      };

      const searchFile = async (filePath: string, relativePath: string, fileName: string) => {
        try {
          const ext = path.extname(fileName).toLowerCase();
          if (BINARY_EXTENSIONS.has(ext)) return;
          if (isIgnoredByGitignore(relativePath, fileName)) return;

          const stat = await fs.stat(filePath);
          if (stat.size > MAX_FILE_SIZE) return;

          const buf = await fs.readFile(filePath);
          if (isBinaryBuffer(buf)) return;

          const content = buf.toString('utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const isMatch = params.isRegex
              ? (pattern as RegExp).test(line)
              : line.toLowerCase().includes(pattern as string);

            if (isMatch) {
              let trimmedLine = line.trim();
              // Truncate overly long single lines (e.g., minified JSON or bundle JS)
              if (trimmedLine.length > MAX_LINE_LENGTH) {
                const matchIdx = params.isRegex
                  ? trimmedLine.search(pattern as RegExp)
                  : trimmedLine.toLowerCase().indexOf(pattern as string);
                if (matchIdx !== -1) {
                  const start = Math.max(0, matchIdx - 100);
                  const end = Math.min(trimmedLine.length, matchIdx + 150);
                  const prefix = start > 0 ? '... ' : '';
                  const suffix = end < trimmedLine.length ? ' ...' : '';
                  trimmedLine = prefix + trimmedLine.substring(start, end).trim() + suffix;
                } else {
                  trimmedLine = trimmedLine.slice(0, MAX_LINE_LENGTH) + ' ...';
                }
              }

              const matchStr = `${relativePath}:${i + 1}: ${trimmedLine}`;
              if (totalChars + matchStr.length > MAX_OUTPUT_CHARS) {
                isTruncated = true;
                return;
              }

              results.push(matchStr);
              totalChars += matchStr.length + 1;
              totalMatches++;
              if (totalMatches >= MAX_MATCHES) return;
            }
          }
        } catch {
          // ignore unreadable/permission-denied files
        }
      };

      const walk = async (currentDir: string, relativePrefix: string, depth = 0) => {
        if (depth > 10 || totalMatches >= MAX_MATCHES || isTruncated) return;
        const dirents = await fs.readdir(currentDir, { withFileTypes: true });

        for (const dirent of dirents) {
          if (SEARCH_IGNORES.has(dirent.name)) continue;

          const relPath = path.join(relativePrefix, dirent.name).replace(/\\/g, '/');
          const fullPath = path.join(currentDir, dirent.name);

          if (dirent.isDirectory()) {
            if (isIgnoredByGitignore(relPath, dirent.name)) continue;
            await walk(fullPath, relPath, depth + 1);
          } else {
            await searchFile(fullPath, relPath, dirent.name);
          }
          if (totalMatches >= MAX_MATCHES || isTruncated) return;
        }
      };

      await walk(safeDir, '');

      let output = results.join('\n');
      if (isTruncated) {
        output += `\n...[搜尋結果已達輸出上限 (${MAX_OUTPUT_CHARS.toLocaleString()} 字元)，已截斷以維護 Token 安全]...`;
      } else if (results.length === 0) {
        output = `No matches found for "${params.query}"`;
      }

      return {
        toolCallId: '',
        isError: false,
        output,
        summary: `Found ${totalMatches} matches for "${params.query}"${isTruncated ? ' (truncated)' : ''}`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `Failed to search files: ${errorMsg}`,
      };
    }
  }

  private async loadGitignorePatterns(workspaceRoot: string): Promise<string[]> {
    try {
      const gitignorePath = path.join(workspaceRoot, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      return content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'));
    } catch {
      return [];
    }
  }
}

