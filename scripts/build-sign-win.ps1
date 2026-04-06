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

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Paths ─────────────────────────────────────────────────────────────────────

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$DlibDir    = Join-Path $ScriptDir '.azure-signing'    # cached, not committed

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
    Abort "npm not found. It should come with Node.js — reinstall Node from https://nodejs.org."
}

# ── Check: signtool.exe ───────────────────────────────────────────────────────

$signtool = $null

# Search Windows SDK locations (newest first)
$sdkBinRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
if (Test-Path $sdkBinRoot) {
    $signtool = Get-ChildItem "$sdkBinRoot\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending |
                Select-Object -First 1 -ExpandProperty FullName
}

# Also check VS build tools path
if (-not $signtool) {
    $vsPaths = @(
        'C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build'
        'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build'
        'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build'
        'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build'
    )
    foreach ($p in $vsPaths) {
        $candidate = Join-Path $p 'signtool.exe'
        if (Test-Path $candidate) { $signtool = $candidate; break }
    }
}

if (-not $signtool) {
    Write-Fail "signtool.exe not found."
    Write-Host ""
    Write-Host "  Install either:" -ForegroundColor Yellow
    Write-Host "    A) Windows 10/11 SDK  →  https://developer.microsoft.com/windows/downloads/windows-sdk/"
    Write-Host "       (check 'Windows SDK Signing Tools for Desktop Apps' during install)"
    Write-Host "    B) Visual Studio Build Tools  →  https://visualstudio.microsoft.com/downloads/"
    Write-Host "       (include the 'MSVC build tools' workload)"
    Write-Host ""
    exit 1
}

Write-Ok "signtool.exe: $signtool"

# ── Check/Download: Azure Trusted Signing dlib ────────────────────────────────

$DlibPackage = 'Microsoft.Trusted.Signing.Client'
$DlibVersion = '1.0.60'                       # update when new versions ship
$DlibDll     = Join-Path $DlibDir 'bin\x64\Azure.CodeSigning.Dlib.dll'

if (-not (Test-Path $DlibDll)) {
    Write-Warn "Azure Trusted Signing dlib not cached — downloading from NuGet..."

    New-Item -ItemType Directory -Force -Path $DlibDir | Out-Null
    $nupkgUrl  = "https://api.nuget.org/v3-flatcontainer/$($DlibPackage.ToLower())/$DlibVersion/$($DlibPackage.ToLower()).$DlibVersion.nupkg"
    $nupkgPath = Join-Path $DlibDir 'dlib.nupkg.zip'

    try {
        Invoke-WebRequest -Uri $nupkgUrl -OutFile $nupkgPath -UseBasicParsing
        Expand-Archive -Path $nupkgPath -DestinationPath $DlibDir -Force
        Remove-Item $nupkgPath
    } catch {
        Abort "Failed to download dlib from NuGet: $_`nCheck your internet connection or download manually from:`n  https://www.nuget.org/packages/$DlibPackage"
    }
}

if (-not (Test-Path $DlibDll)) {
    Abort "dlib DLL not found at expected path after extraction: $DlibDll`nThe NuGet package layout may have changed — inspect $DlibDir manually."
}

Write-Ok "Azure Trusted Signing dlib: $DlibVersion"

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

npm run clean
if ($LASTEXITCODE -ne 0) { Abort "npm run clean failed." }

npm run build:vite
if ($LASTEXITCODE -ne 0) { Abort "Vite build failed." }

$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'    # suppress electron-builder cert search
npx electron-builder --win --publish never
if ($LASTEXITCODE -ne 0) { Abort "electron-builder failed." }

# ── Sign ──────────────────────────────────────────────────────────────────────

Write-Header "Signing Windows artifacts"

# Write metadata.json that signtool/dlib reads
$MetadataFile = Join-Path $DlibDir 'metadata.json'
@{
    Endpoint                 = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
    CodeSigningAccountName   = $env:AZURE_TRUSTED_SIGNING_ACCOUNT
    CertificateProfileName   = $env:AZURE_TRUSTED_SIGNING_PROFILE
} | ConvertTo-Json | Set-Content -Path $MetadataFile -Encoding UTF8

$ReleaseDir = Join-Path $ProjectDir "release\$version"
$exeFiles   = Get-ChildItem -Path $ReleaseDir -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue

if ($exeFiles.Count -eq 0) {
    Abort "No .exe files found in $ReleaseDir — did the build succeed?"
}

$allSigned = $true
foreach ($exe in $exeFiles) {
    Write-Host "  Signing $($exe.Name) ..." -ForegroundColor DarkGray
    & $signtool sign `
        /fd   SHA256 `
        /tr   http://timestamp.acs.microsoft.com `
        /td   SHA256 `
        /dlib $DlibDll `
        /dmdf $MetadataFile `
        $exe.FullName

    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Signing failed for $($exe.Name)"
        $allSigned = $false
    } else {
        Write-Ok $exe.Name
    }
}

# Clean up metadata.json (contains account names; dlib dir is git-ignored anyway)
Remove-Item $MetadataFile -ErrorAction SilentlyContinue

if (-not $allSigned) {
    Abort "One or more files failed to sign."
}

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Header "Done"
Write-Host "  Signed artifacts in:" -ForegroundColor Green
Write-Host "    $ReleaseDir" -ForegroundColor White
Write-Host ""
Get-ChildItem $ReleaseDir -Filter '*.exe' | ForEach-Object {
    $size = '{0:N1} MB' -f ($_.Length / 1MB)
    Write-Host "    $($_.Name)  ($size)" -ForegroundColor White
}
Write-Host ""
