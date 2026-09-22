/**
 * Utility to pop up native OS File Explorer (檔案總管) for directory selection
 */
export async function pickDirectoryFromExplorer(): Promise<{ name: string; path?: string } | null> {
  // Method 1: Try local backend OS FolderBrowserDialog (Powershell on Win, AppleScript on Mac, Zenity on Linux)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('cline_web_server_auth_token') || ''
        : '';
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-API-Key'] = token;
    }
    const res = await fetch(`http://${window.location.hostname}:3001/api/workspace/browse-directory`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data.path && data.name) {
        return { name: data.name, path: data.path };
      }
      if (data.cancelled) {
        return null;
      }
    }
  } catch {
    // If backend is remote or offline, fallback to browser native file system picker
  }

  // Method 2: Modern Browser File System Access API
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'read',
      });
      if (dirHandle && dirHandle.name) {
        return { name: dirHandle.name };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return null; // User cancelled
      }
      console.warn('[pickDirectory] showDirectoryPicker error, falling back to input:', err);
    }
  }

  // Method 3: HTML5 directory input fallback
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    (input as any).directory = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);

    let resolved = false;

    input.onchange = (e: any) => {
      resolved = true;
      const files = e.target.files;
      if (files && files.length > 0) {
        const firstFile = files[0];
        const rel = firstFile.webkitRelativePath || '';
        const folderName =
          rel.split('/')[0] || rel.split('\\')[0] || firstFile.name || 'Selected Folder';
        document.body.removeChild(input);
        resolve({ name: folderName });
      } else {
        document.body.removeChild(input);
        resolve(null);
      }
    };

    const handleFocus = () => {
      window.removeEventListener('focus', handleFocus);
      setTimeout(() => {
        if (!resolved) {
          try {
            document.body.removeChild(input);
          } catch {}
          resolve(null);
        }
      }, 1500);
    };
    window.addEventListener('focus', handleFocus);

    input.click();
  });
}
