<#
.SYNOPSIS
    打包 Harni Windows 桌面版安裝程式 (.exe)

.DESCRIPTION
    此腳本自動化 Harni 桌面應用程式的完整建置與打包流程：
    1. 環境與先決條件檢查 (Node.js, pnpm, 管理員權限)
    2. 安裝與同步專案依賴 (pnpm install)
    3. 建置前後端核心套件與 Web 前端 (pnpm build)
    4. (選用) 重新編譯原生模組 (node-pty)
    5. 執行 Electron 打包流程 (透過 pnpm deploy 隔離依賴，並由 electron-builder 產出 NSIS 安裝檔)
    6. 驗證產出成品並輸出 SHA256 雜湊值與檔案大小

.PARAMETER SkipInstall
    跳過 pnpm install 階段。

.PARAMETER SkipBuild
    跳過 pnpm build 階段 (適用於前後端核心程式碼未變更，僅測試桌面外殼打包)。

.PARAMETER RebuildNodePty
    使用 electron rebuild 針對 Electron 版本重新編譯 node-pty 原生模組。

.PARAMETER Clean
    在打包前清理舊的 .deploy、dist 與 release 產物。

.PARAMETER OutputDir
    自訂打包產物的額外複製目標資料夾 (預設產物保留於 apps/desktop/release)。

.EXAMPLE
    .\scripts\package-desktop.ps1
    一般完整打包 (建置 web/server 並產出安裝檔)

.EXAMPLE
    .\scripts\package-desktop.ps1 -Clean -RebuildNodePty
    清理舊檔、重新編譯原生 node-pty 並打包
#>

[CmdletBinding()]
param(
    [switch]$BuildBridge,
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [switch]$RebuildNodePty,
    [switch]$Clean,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step {
    param([string]$Message)
    Write-Host "`n====> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "     $Message" -ForegroundColor Gray
}

# -----------------------------------------------------------------------------
# 1. 決定根目錄與路徑定義
# -----------------------------------------------------------------------------
$Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MonorepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path

$DesktopDir    = Join-Path $MonorepoRoot "apps\desktop"
$WebDir        = Join-Path $MonorepoRoot "apps\web"
$DeployDir     = Join-Path $DesktopDir ".deploy"
$ReleaseDir    = Join-Path $DesktopDir "release"

Write-Host "========================================================" -ForegroundColor Blue
Write-Host "        Harni Desktop Application Packaging Tool        " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Blue
Write-Info "工作目錄: $MonorepoRoot"

# -----------------------------------------------------------------------------
# 2. 先決條件檢查 (Prerequisites)
# -----------------------------------------------------------------------------
Write-Step '檢查執行環境與必備工具...'

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Write-Warn '目前非系統管理員身分執行。'
    Write-Warn '若這是第一次打包，electron-builder 解開 winCodeSign 符號連結可能需要管理員權限。'
    Write-Warn '如果打包過程中出現權限或 EPERM 錯誤，請以「以系統管理員身分執行」重試。'
} else {
    Write-Success '系統管理員權限確認完畢。'
}

# 檢查 Node.js
$NodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Err '找不到 Node.js，請先安裝 Node.js (建議 v20+ / v22+)。'
    exit 1
}
$NodeVersion = (& node -v).Trim()
Write-Success "Node.js: $NodeVersion"

# 檢查 pnpm
$PnpmCmd = Get-Command "pnpm" -ErrorAction SilentlyContinue
if (-not $PnpmCmd) {
    Write-Err '找不到 pnpm，請先安裝 pnpm (可透過 npm install -g pnpm 安裝)。'
    exit 1
}
$PnpmVersion = (& pnpm -v).Trim()
Write-Success "pnpm: $PnpmVersion"

# -----------------------------------------------------------------------------
# 3. 清理舊產物 (-Clean)
# -----------------------------------------------------------------------------
if ($Clean) {
    Write-Step '清理既有建置產物 (-Clean)...'
    $CleanTargets = @(
        $DeployDir,
        $ReleaseDir,
        (Join-Path $DesktopDir "dist")
    )
    foreach ($target in $CleanTargets) {
        if (Test-Path $target) {
            Write-Info "移除: $target"
            Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Success '清理完成。'
}

# -----------------------------------------------------------------------------
# 4. 安裝依賴 (pnpm install)
# -----------------------------------------------------------------------------
if ($SkipInstall) {
    Write-Step '跳過 pnpm install (-SkipInstall)。'
} else {
    Write-Step '安裝與同步專案依賴 (pnpm install)...'
    Push-Location $MonorepoRoot
    try {
        & pnpm install
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm install 執行失敗 (Exit Code: $LASTEXITCODE)"
        }
        Write-Success '依賴安裝成功。'
    } finally {
        Pop-Location
    }
}

# -----------------------------------------------------------------------------
# 5. 建置 Monorepo 套件與 Web 前端 (pnpm build)
# -----------------------------------------------------------------------------
if ($SkipBuild) {
    Write-Step '跳過專案建置 (-SkipBuild)。'
} else {
    Write-Step '建置前後端核心套件與 Web 前端 (pnpm build)...'
    Push-Location $MonorepoRoot
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm build 失敗 (Exit Code: $LASTEXITCODE)"
        }
        $WebDistIndex = Join-Path $WebDir "dist\index.html"
        if (-not (Test-Path $WebDistIndex)) {
            throw "Web 前端產物遺失: 找不到 $WebDistIndex"
        }
        Write-Success '前後端建置完成 (前端靜態檔確認存在)。'
    } finally {
        Pop-Location
    }
}

# -----------------------------------------------------------------------------
# 6. (選用) 重新編譯原生模組 (node-pty)
# -----------------------------------------------------------------------------
if ($RebuildNodePty) {
    Write-Step '重新編譯原生模組 node-pty (@electron/rebuild)...'
    Push-Location $DesktopDir
    try {
        & npx "@electron/rebuild" -f -w node-pty
        if ($LASTEXITCODE -ne 0) {
            Write-Warn '原生模組重建失敗，可能需要 Visual Studio C++ 建置工具。若打包後正常執行可忽略此警訊。'
        } else {
            Write-Success 'node-pty 原生模組重建完成。'
        }
    } finally {
        Pop-Location
    }
}

# -----------------------------------------------------------------------------
# 7. 編譯 Desktop TypeScript 並打包 (electron-builder)
# -----------------------------------------------------------------------------
Write-Step '開始打包桌面應用程式 (pnpm --filter @harni/desktop dist)...'

Push-Location $MonorepoRoot
try {
    & pnpm --filter @harni/desktop dist
    if ($LASTEXITCODE -ne 0) {
        throw "桌面版打包失敗 (Exit Code: $LASTEXITCODE)"
    }
    Write-Success '桌面版打包流程執行成功！'
} finally {
    Pop-Location
}

# -----------------------------------------------------------------------------
# 8. 產物驗證與結果統計
# -----------------------------------------------------------------------------
Write-Step '驗證產出安裝檔...'

$Installers = Get-ChildItem -Path $ReleaseDir -Filter "*.exe" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*blockmap*" }

if (-not $Installers -or $Installers.Count -eq 0) {
    Write-Err "在 $ReleaseDir 中未找到產出的 .exe 安裝檔！"
    exit 1
}

$Stopwatch.Stop()
$Elapsed = $Stopwatch.Elapsed

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "                  打包完成 (BUILD SUCCESS)              " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green

foreach ($file in $Installers) {
    $sizeMB = [math]::Round($file.Length / 1MB, 2)
    $hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
    
    Write-Host "檔案名稱 : $($file.Name)" -ForegroundColor White
    Write-Host "檔案大小 : $sizeMB MB ($($file.Length) bytes)" -ForegroundColor White
    Write-Host "完整路徑 : $($file.FullName)" -ForegroundColor White
    Write-Host "SHA256   : $hash" -ForegroundColor Yellow
    Write-Host "--------------------------------------------------------" -ForegroundColor Gray

    if ($OutputDir) {
        if (-not (Test-Path $OutputDir)) {
            New-Item -Path $OutputDir -ItemType Directory -Force | Out-Null
        }
        $DestFile = Join-Path $OutputDir $file.Name
        Copy-Item -Path $file.FullName -Destination $DestFile -Force
        Write-Success "已複製安裝檔至自訂目錄: $DestFile"
    }
}

Write-Info "總耗時: $($Elapsed.Minutes) 分 $($Elapsed.Seconds) 秒"
Write-Host ""
