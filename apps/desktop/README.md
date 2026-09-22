# Harni Desktop（Windows 打包）

以 Electron 殼封裝 Harni：後端 (`@harni/server`) 直接運行於 Electron 主程序內，
前端靜態檔由後端透過 `HARNI_STATIC_DIR` 提供（單一來源，WebSocket 與 API 無跨域問題）。

## 架構

```
Electron Main (main.ts)
 ├─ spawn 內建 backend：@harni/server 的 createApp()（port 3001, 127.0.0.1）
 ├─ 靜態檔：resources/web-dist（打包自 apps/web/dist）
 ├─ SQLite： ~/.harni/harni.db（與 Web 版共用）
 └─ BrowserWindow → http://127.0.0.1:3001
```

## 開發執行

```bash
# 1. 先建置 web 與 server
pnpm build

# 2. 啟動桌面殼（dev 模式載入 apps/web/dist）
pnpm --filter @harni/desktop start
```

## 打包 Windows 安裝檔（NSIS .exe）

```bash
pnpm install            # 安裝 electron / electron-builder
pnpm --filter @harni/web build
pnpm --filter @harni/desktop dist
# 產出：apps/desktop/release/Harni Setup x.x.x.exe
```

> 打包流程內部使用 `scripts/dist.mjs` 先以 `pnpm deploy` 產生自含目錄
> （解決 workspace symlink 導致的 `must be under ...` 錯誤），
> 再執行 electron-builder（首次需以系統管理員權限執行一次，
> 讓 winCodeSign 快取解壓能建立符號連結）。

## 注意事項

- **預設工作區**：首次啟動使用 `<使用者家目錄>/Harni`（自動建立的空資料夾），
  避免直接掃描家目錄造成大量索引與記憶體膨脹。實際專案請在 UI 中新增資料夾。
- **記憶體上限**：目錄快取上限 500 筆（FIFO 淘汰）、檔案監看深度 2 / 條目上限 3000、
  工作區檔案統計為有界掃描（深度 3、最多 2000 目錄、1.5 秒預算）。
  這些限制讓安裝版在「工作區 = 家目錄」的最壞情況下主程序仍維持在 ~150 MB。
- **node-pty 原生模組**：Electron 內建 Node 版本與系統 Node 不同，
  首次打包前需執行 `npx @electron/rebuild -f -w node-pty`（於 apps/desktop 目錄），
  Windows 上需安裝 Visual Studio Build Tools（C++ 工作負載）。
- **Python Bridge 凍結（onedir 打包）**：
  ```bash
  cd apps/bridge
  pip install -r requirements.txt -r requirements-build.txt
  pyinstaller harni_bridge.spec      # 產出 dist/harni-bridge/（harni-bridge.exe + _internal/）
  ```
  `pnpm --filter @harni/desktop dist` 會自動把整個 onedir 目錄複製到 `resources/bridge/`；
  若不存在則退回舊版 onefile exe 並發出警告，安裝後將無法啟動 Antigravity Bridge（其他功能正常）。
  - **為何必須 onedir**：onefile 每次啟動都得把約 150 MB 內容解壓到 `%TEMP%\_MEIxxxxx`，
    在具備即時防毒／EDR 掃描的機器上實測需約 40 秒；安裝版因此在使用 Antigravity 模型時報
    「無法連接 Antigravity Python 橋接服務 (http://127.0.0.1:8123)：fetch failed」。
    onedir 直接由磁碟啟動，實測 **1.9 秒**即可監聽 8123 埠。
  - **安裝包不含 `apps/bridge/server.py`**：`AntigravityBridgeManager` 只在解析不到凍結執行檔時
    才檢查 Python 腳本（開發環境路徑），否則打包版會在使用凍結 exe 前就提前放棄啟動。
  - **啟動預算**：`ANTIGRAVITY_BRIDGE_START_TIMEOUT_MS`（預設 120000）控制等待 `/health` 的上限；
    同一次啟動中的重複請求會共用同一個啟動流程，不會殺掉仍在啟動中的行程。
- **node-pty 已設定 `asarUnpack`**，避免 asar 封存內無法載入 .node 二進位檔。
- GitHub Actions 建議使用 `windows-latest` runner 建置以確保原生模組一致性。

