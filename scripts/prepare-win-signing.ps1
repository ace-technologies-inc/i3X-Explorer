# prepare-win-signing.ps1
# Dot-source this before running electron-builder on Windows:
#
#   . .\scripts\prepare-win-signing.ps1
#
# It finds signtool.exe, fetches the Azure Trusted Signing dlib from NuGet (cached in
# scripts\.azure-signing\, git-ignored), writes the dlib's metadata.json, and exports
# the three variables scripts/winSign.cjs needs:
#
#   I3X_SIGNTOOL       full path to signtool.exe
#   I3X_SIGN_DLIB      full path to Azure.CodeSigning.Dlib.dll
#   I3X_SIGN_METADATA  full path to metadata.json
#
# electron-builder then calls winSign.cjs for every file it signs (the app exe before it
# is packed, the uninstaller, the installers). Authentication is the dlib's own:
# AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET in the environment.
#
# Used by build-sign-win.ps1 and .github/workflows/build-win.yml. Throws on any failure.

$ErrorActionPreference = 'Stop'

foreach ($v in 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
               'AZURE_TRUSTED_SIGNING_ENDPOINT', 'AZURE_TRUSTED_SIGNING_ACCOUNT',
               'AZURE_TRUSTED_SIGNING_PROFILE') {
    if (-not [Environment]::GetEnvironmentVariable($v)) { throw "Missing environment variable $v" }
}

# ── signtool.exe ──────────────────────────────────────────────────────────────
# Newest Windows SDK first, then Visual Studio build tools.

$signtool = $null
$sdkBinRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
if (Test-Path $sdkBinRoot) {
    $signtool = Get-ChildItem "$sdkBinRoot\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending |
                Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) {
    foreach ($p in 'C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build',
                   'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build',
                   'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build',
                   'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build') {
        $candidate = Join-Path $p 'signtool.exe'
        if (Test-Path $candidate) { $signtool = $candidate; break }
    }
}
if (-not $signtool) {
    throw ("signtool.exe not found. Install the Windows 10/11 SDK (check 'Windows SDK Signing Tools " +
           "for Desktop Apps'): https://developer.microsoft.com/windows/downloads/windows-sdk/")
}

# ── Azure Trusted Signing dlib ────────────────────────────────────────────────
# 1.0.95 is the last release of this package. Its successor is
# Microsoft.ArtifactSigning.Client (Trusted Signing was renamed Artifact Signing).

$DlibPackage   = 'Microsoft.Trusted.Signing.Client'
$DlibVersion   = '1.0.95'
$DlibDir       = Join-Path $PSScriptRoot '.azure-signing'
$DlibDll       = Join-Path $DlibDir 'bin\x64\Azure.CodeSigning.Dlib.dll'
$DlibCacheFile = Join-Path $DlibDir '.version'

$cachedVersion = if (Test-Path $DlibCacheFile) { (Get-Content $DlibCacheFile -Raw).Trim() } else { $null }
if ($cachedVersion -ne $DlibVersion -and (Test-Path $DlibDir)) {
    Remove-Item -Recurse -Force $DlibDir
}
if (-not (Test-Path $DlibDll)) {
    Write-Host "  Downloading $DlibPackage $DlibVersion from NuGet..."
    New-Item -ItemType Directory -Force -Path $DlibDir | Out-Null
    $id        = $DlibPackage.ToLower()
    $nupkgPath = Join-Path $DlibDir 'dlib.nupkg.zip'
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$id/$DlibVersion/$id.$DlibVersion.nupkg" `
                      -OutFile $nupkgPath -UseBasicParsing
    Expand-Archive -Path $nupkgPath -DestinationPath $DlibDir -Force
    Remove-Item $nupkgPath
    Set-Content -Path $DlibCacheFile -Value $DlibVersion -NoNewline
}
if (-not (Test-Path $DlibDll)) {
    throw "dlib not found at $DlibDll after extracting the NuGet package; its layout may have changed."
}

# ── metadata.json ─────────────────────────────────────────────────────────────
# Written WITHOUT a BOM: the dlib rejects one ("'0xEF' is an invalid start of a value").

$MetadataFile = Join-Path $DlibDir 'metadata.json'
$metadata = @{
    Endpoint               = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
    CodeSigningAccountName = $env:AZURE_TRUSTED_SIGNING_ACCOUNT
    CertificateProfileName = $env:AZURE_TRUSTED_SIGNING_PROFILE
} | ConvertTo-Json
[IO.File]::WriteAllText($MetadataFile, $metadata, (New-Object Text.UTF8Encoding $false))

$env:I3X_SIGNTOOL      = $signtool
$env:I3X_SIGN_DLIB     = $DlibDll
$env:I3X_SIGN_METADATA = $MetadataFile

Write-Host "  signtool:  $signtool"
Write-Host "  dlib:      $DlibPackage $DlibVersion"
