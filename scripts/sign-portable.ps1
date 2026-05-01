# sign-portable.ps1
# Signs just the portable .exe -- run this if the full build-sign-win.ps1 fails at the signing step.
#
# Usage (from project root or scripts folder):
#   .\scripts\sign-portable.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$DlibDir    = Join-Path $ScriptDir '.azure-signing'
$DlibDll    = Join-Path $DlibDir 'bin\x64\Azure.CodeSigning.Dlib.dll'
$MetaFile   = Join-Path $DlibDir 'metadata.json'

Set-Location $ProjectDir

# Load credentials ------------------------------------------------------------------

$AzureVarsFile = Join-Path $ScriptDir 'set-azure-vars.ps1'
if (Test-Path $AzureVarsFile) {
    . $AzureVarsFile
} else {
    Write-Host "set-azure-vars.ps1 not found -- expecting credentials already in environment" -ForegroundColor Yellow
}

# Validate --------------------------------------------------------------------------

if (-not (Test-Path $DlibDll)) {
    Write-Host "dlib DLL not found: $DlibDll" -ForegroundColor Red
    Write-Host "Run the full build-sign-win.ps1 first to download it." -ForegroundColor Yellow
    exit 1
}

$version  = node --% -p "require('./package.json').version"
$Portable = Join-Path $ProjectDir "release\$version\i3X Explorer-$version-portable.exe"

if (-not (Test-Path $Portable)) {
    Write-Host "Portable not found: $Portable" -ForegroundColor Red
    exit 1
}

# Find signtool ---------------------------------------------------------------------

$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1 -ExpandProperty FullName

if (-not $signtool) {
    Write-Host "signtool.exe not found -- install the Windows 10/11 SDK." -ForegroundColor Red
    exit 1
}

# Write metadata and sign -----------------------------------------------------------

$meta = @{
    Endpoint               = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
    CodeSigningAccountName = $env:AZURE_TRUSTED_SIGNING_ACCOUNT
    CertificateProfileName = $env:AZURE_TRUSTED_SIGNING_PROFILE
} | ConvertTo-Json

[System.IO.File]::WriteAllText($MetaFile, $meta, (New-Object System.Text.UTF8Encoding $false))

Write-Host "Signing $([System.IO.Path]::GetFileName($Portable)) ..." -ForegroundColor Cyan

& $signtool sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $DlibDll /dmdf $MetaFile $Portable

Remove-Item $MetaFile -ErrorAction SilentlyContinue

if ($LASTEXITCODE -ne 0) {
    Write-Host "Signing failed." -ForegroundColor Red
    exit 1
}

Write-Host "Done." -ForegroundColor Green
