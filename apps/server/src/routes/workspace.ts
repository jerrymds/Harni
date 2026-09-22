import * as path from 'node:path';
import type { Router } from './router.js';
import { sendJsonResponse } from '../utils/http.js';

export function registerWorkspaceRoutes(router: Router): void {
  router.get('/api/workspace', async ({ res, url, ctx }) => {
    try {
      const queryWorkspaceRoot = url.searchParams.get('workspaceRoot') || undefined;
      const info = await ctx.fsService.getWorkspaceInfo(queryWorkspaceRoot);
      sendJsonResponse(res, 200, info);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg });
    }
  });

  router.get('/api/workspace/browse-directory', async ({ res }) => {
    try {
      const { exec } = await import('node:child_process');
      const isWin = process.platform === 'win32';
      const isMac = process.platform === 'darwin';

      if (isWin) {
        const psCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '請選擇專案工作目錄'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($f.SelectedPath) }"`;
        exec(psCommand, { timeout: 60000 }, (_error, stdout) => {
          const selectedPath = (stdout || '').trim().split('\r\n')[0] || '';
          if (selectedPath) {
            const name = path.basename(selectedPath) || selectedPath;
            sendJsonResponse(res, 200, { path: selectedPath, name });
          } else {
            sendJsonResponse(res, 200, { cancelled: true });
          }
        });
        return;
      } else if (isMac) {
        const macCommand = `osascript -e 'POSIX path of (choose folder with prompt "請選擇專案工作目錄")'`;
        exec(macCommand, { timeout: 60000 }, (_error, stdout) => {
          const selectedPath = (stdout || '').trim();
          if (selectedPath) {
            const name = path.basename(selectedPath) || selectedPath;
            sendJsonResponse(res, 200, { path: selectedPath, name });
          } else {
            sendJsonResponse(res, 200, { cancelled: true });
          }
        });
        return;
      } else {
        // Linux (zenity)
        exec(`zenity --file-selection --directory --title="請選擇專案工作目錄"`, { timeout: 60000 }, (_error, stdout) => {
          const selectedPath = (stdout || '').trim();
          if (selectedPath) {
            const name = path.basename(selectedPath) || selectedPath;
            sendJsonResponse(res, 200, { path: selectedPath, name });
          } else {
            sendJsonResponse(res, 200, { cancelled: true });
          }
        });
        return;
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, { error: errorMsg });
    }
  });
}
