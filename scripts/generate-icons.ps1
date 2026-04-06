# generate-icons.ps1
# Generate app icons for Windows (and Linux PNG sizes) from a source PNG.
# Requires: ImageMagick (https://imagemagick.org/script/download.php#windows)
#
# Usage (from project root):
#   .\scripts\generate-icons.ps1 [path\to\source.png]
#
# If no source image is provided, uses build\icon-1024.png by default.

param(
    [string]$SourceImage = ""
)

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BuildDir   = Join-Path $ProjectDir 'build'

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

# ── Check for ImageMagick ──────────────────────────────────────────────────────

$magick = Get-Command magick -ErrorAction SilentlyContinue
if (-not $magick) {
    Write-Host "  [!!]  ImageMagick not found." -ForegroundColor Yellow
    Write-Host "        Install from: https://imagemagick.org/script/download.php#windows" -ForegroundColor White
    Write-Host "        Make sure to check 'Add to PATH' during installation." -ForegroundColor White
    exit 1
}

# ── Resolve source image ───────────────────────────────────────────────────────

$DefaultIcon = Join-Path $BuildDir 'icon-1024.png'

if (-not $SourceImage) {
    if (Test-Path $DefaultIcon) {
        Write-Host "  Using default icon: $DefaultIcon" -ForegroundColor DarkGray
        $SourceImage = $DefaultIcon
    } else {
        Write-Host "  [XX]  No source image provided and $DefaultIcon not found." -ForegroundColor Red
        Write-Host "        Run: .\scripts\generate-icons.ps1 path\to\your\icon.png" -ForegroundColor White
        exit 1
    }
}

Write-Host "  Source image: $SourceImage" -ForegroundColor DarkGray

# ── Generate PNG sizes (for Linux) ────────────────────────────────────────────

Write-Host "  Generating PNG icons..." -ForegroundColor DarkGray
foreach ($size in @(16, 24, 32, 48, 64, 128, 256, 512, 1024)) {
    magick $SourceImage -resize "${size}x${size}" (Join-Path $BuildDir "icon-${size}.png")
}
Copy-Item (Join-Path $BuildDir 'icon-256.png') (Join-Path $BuildDir 'icon.png') -Force

$IconsDir = Join-Path $BuildDir 'icons'
New-Item -ItemType Directory -Force -Path $IconsDir | Out-Null
foreach ($size in @(16, 24, 32, 48, 64, 128, 256, 512)) {
    Copy-Item (Join-Path $BuildDir "icon-${size}.png") (Join-Path $IconsDir "${size}x${size}.png") -Force
}

# ── Generate ICO (for Windows) ────────────────────────────────────────────────

Write-Host "  Generating ICO icon for Windows..." -ForegroundColor DarkGray
magick $SourceImage -define icon:auto-resize=256,128,64,48,32,16 (Join-Path $BuildDir 'icon.ico')

Write-Host "  [OK]  Icons generated in $BuildDir" -ForegroundColor Green
