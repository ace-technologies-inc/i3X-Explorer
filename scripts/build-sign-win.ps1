# build-sign-win.ps1
# Build i3X Explorer for Windows and sign with Azure Trusted Signing.
#
# Usage (from project root):
#   .\scripts\build-sign-win.ps1
#
# Required environment variables (or set them in scripts\set-azure-vars.ps1):
#   AZURE_TENANT_ID                    – Entra tenant ID
#   AZURE_CLIENT_ID                    – App registration client ID
#   AZURE_CLIENT_SECRET                – App registration client secret
#   AZURE_TRUSTED_SIGNING_ENDPOINT     – e.g. https://eus.codesigning.azure.net
#   AZURE_TRUSTED_SIGNING_ACCOUNT      – Signing account name
#   AZURE_TRUSTED_SIGNING_PROFILE      – Certificate profile name
#
# Signing happens INSIDE electron-builder (win.azureSignOptions, passed below as
# --config.* overrides), so the app exe is signed before it is packed into the NSIS
# installer and portable exe, and the uninstaller is signed too. Signing the finished
# installers afterwards (what this script used to do) leaves the installed
# "i3X Explorer.exe" unsigned, which Windows 11 Smart App Control blocks outright.
# electron-builder installs the TrustedSigning PowerShell module on first use and
# authenticates with the AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET vars.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Symlink privilege check ────────────────────────────────────────────────────
# electron-builder extracts winCodeSign which contains macOS symlinks.
# Windows requires either admin rights or Developer Mode to create symlinks.

$isAdmin     = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$devModeKey  = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
$devModeOn   = (Get-ItemProperty -Path $devModeKey -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense -eq 1

if (-not $isAdmin -and -not $devModeOn) {
    Write-Host ""
    Write-Host "  [!!]  Symlink privileges required" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  electron-builder downloads a toolkit that contains macOS symlinks." -ForegroundColor White
    Write-Host "  Windows needs one of the following to extract them:" -ForegroundColor White
    Write-Host ""
    Write-Host "    A) Run this script as Administrator (right-click PowerShell -> Run as administrator)" -ForegroundColor Cyan
    Write-Host "    B) Enable Developer Mode: Settings -> Privacy & Security -> For developers -> Developer Mode" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# ── Paths ─────────────────────────────────────────────────────────────────────

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

Set-Location $ProjectDir

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Header($text) {
    Write-Host ""
    Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Ok($text)   { Write-Host "  [OK]  $text" -ForegroundColor Green  }
function Write-Warn($text) { Write-Host "  [!!]  $text" -ForegroundColor Yellow }
function Write-Fail($text) { Write-Host "  [XX]  $text" -ForegroundColor Red    }

function Abort($text) {
    Write-Fail $text
    Write-Host ""
    exit 1
}

# ── Load local credential file if present ─────────────────────────────────────

$AzureVarsFile = Join-Path $ScriptDir 'set-azure-vars.ps1'
if (Test-Path $AzureVarsFile) {
    Write-Host "  Loading Azure credentials from set-azure-vars.ps1 ..." -ForegroundColor DarkGray
    . $AzureVarsFile
}

# ── Check: Node.js ────────────────────────────────────────────────────────────

Write-Header "Checking dependencies"

try {
    $nodeVersion = (node --version 2>$null).TrimStart('v')
    $nodeMajor   = [int]($nodeVersion -split '\.')[0]
    if ($nodeMajor -lt 18) {
        Abort "Node.js 18+ required (found v$nodeVersion). Install from https://nodejs.org or use nvm-windows."
    }
    Write-Ok "Node.js v$nodeVersion"
} catch {
    Abort "Node.js not found. Install from https://nodejs.org (LTS recommended)."
}

# ── Check: npm ────────────────────────────────────────────────────────────────

try {
    $npmVersion = (npm --version 2>$null)
    Write-Ok "npm v$npmVersion"
} catch {
    Abort "npm not found. It should come with Node.js, reinstall Node from https://nodejs.org."
}

# ── Check: Azure credentials ──────────────────────────────────────────────────

$missingVars = @()
foreach ($v in @('AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET',
                  'AZURE_TRUSTED_SIGNING_ENDPOINT','AZURE_TRUSTED_SIGNING_ACCOUNT',
                  'AZURE_TRUSTED_SIGNING_PROFILE')) {
    if (-not [System.Environment]::GetEnvironmentVariable($v)) { $missingVars += $v }
}

if ($missingVars.Count -gt 0) {
    Write-Fail "Missing Azure environment variables:"
    $missingVars | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "  Create scripts\set-azure-vars.ps1 (it is git-ignored) with:" -ForegroundColor Yellow
    Write-Host '    $env:AZURE_TENANT_ID                = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"'
    Write-Host '    $env:AZURE_CLIENT_ID                = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"'
    Write-Host '    $env:AZURE_CLIENT_SECRET            = "your-secret"'
    Write-Host '    $env:AZURE_TRUSTED_SIGNING_ENDPOINT = "https://<account>.codesigning.azure.net"'
    Write-Host '    $env:AZURE_TRUSTED_SIGNING_ACCOUNT  = "your-account-name"'
    Write-Host '    $env:AZURE_TRUSTED_SIGNING_PROFILE  = "your-profile-name"'
    Write-Host ""
    Write-Host "  The app registration needs the 'Trusted Signing Certificate Profile Signer'" -ForegroundColor DarkGray
    Write-Host "  role on the signing account (Azure portal → signing account → Access control)." -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}

Write-Ok "Azure credentials present"

# ── Build ─────────────────────────────────────────────────────────────────────

$version = node --% -p "require('./package.json').version"
Write-Header "Building i3X Explorer v$version (Windows)"

& (Join-Path $ScriptDir 'generate-icons.ps1')
if ($LASTEXITCODE -ne 0) { Abort "Icon generation failed." }

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue dist, dist-electron

npx vite build
if ($LASTEXITCODE -ne 0) { Abort "Vite build failed." }

Copy-Item electron\preload.cjs dist-electron\preload.cjs

$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'    # no local cert search; Azure signs instead
# publisherName is required by electron-builder's schema but only used to verify
# auto-updates (this app publishes none); keep it equal to the certificate's CN.
npx electron-builder --win --publish never `
    "--config.win.azureSignOptions.publisherName=Ace Technologies, Inc" `
    "--config.win.azureSignOptions.endpoint=$($env:AZURE_TRUSTED_SIGNING_ENDPOINT)" `
    "--config.win.azureSignOptions.codeSigningAccountName=$($env:AZURE_TRUSTED_SIGNING_ACCOUNT)" `
    "--config.win.azureSignOptions.certificateProfileName=$($env:AZURE_TRUSTED_SIGNING_PROFILE)"
if ($LASTEXITCODE -ne 0) { Abort "electron-builder failed (building or signing)." }

# electron-builder's portable target spawns a child process (7-zip sfx) that may still be
# writing the file when the main process exits. Give it a moment to finish.
Start-Sleep -Seconds 3

# ── Verify ────────────────────────────────────────────────────────────────────
# Checks the shipped installers AND the app exe in each *-unpacked folder. The unpacked
# exe is the same file that was packed into the installers, so if it is signed, so is
# what users end up running.

Write-Header "Verifying signatures"

$ReleaseDir = Join-Path $ProjectDir "release\$version"
$exeFiles   = @(Get-ChildItem -Path $ReleaseDir -Filter '*.exe' -ErrorAction SilentlyContinue)
$appExes    = @(Get-ChildItem -Path $ReleaseDir -Filter 'i3X Explorer.exe' -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.DirectoryName -like '*-unpacked' })

if ($exeFiles.Count -eq 0) { Abort "No installer .exe files found in $ReleaseDir, did the build succeed?" }
if ($appExes.Count -eq 0)  { Abort "No unpacked 'i3X Explorer.exe' found under $ReleaseDir, cannot verify the app itself was signed." }

$allVerified = $true
foreach ($exe in $exeFiles + $appExes) {
    $label = $exe.FullName.Substring($ReleaseDir.Length + 1)
    $sig   = Get-AuthenticodeSignature -FilePath $exe.FullName
    if ($sig.Status -ne 'Valid') {
        Write-Fail "$label  ·  $($sig.Status): $($sig.StatusMessage)"
        $allVerified = $false
    } elseif (-not $sig.TimeStamperCertificate) {
        # Trusted Signing certs live ~3 days; without a timestamp the signature expires with them.
        Write-Fail "$label  ·  signed but NOT timestamped"
        $allVerified = $false
    } else {
        Write-Ok "$label  ·  $($sig.SignerCertificate.Subject)"
    }
}

if (-not $allVerified) {
    Abort "One or more files failed signature verification, do NOT distribute these builds."
}

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Header "Done"
Write-Host "  Signed artifacts in:" -ForegroundColor Green
Write-Host "    $ReleaseDir" -ForegroundColor White
Write-Host ""
$exeFiles | ForEach-Object {
    $size = '{0:N1} MB' -f ($_.Length / 1MB)
    Write-Host "    $($_.Name)  ($size)" -ForegroundColor White
}
Write-Host ""