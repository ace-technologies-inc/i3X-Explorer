#!/bin/bash
# Generate app icons for all platforms
# Requires: ImageMagick (brew install imagemagick)
#
# Usage: ./scripts/generate-icons.sh [source-image.png]
#
# If no source image provided, generates a simple placeholder icon.
# For production, replace with a proper 1024x1024 PNG icon.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build"
SOURCE_IMAGE="${1:-}"

mkdir -p "$BUILD_DIR"

# Check for ImageMagick
if ! command -v magick &> /dev/null && ! command -v convert &> /dev/null; then
    echo "ImageMagick not found. Install with: brew install imagemagick"
    echo "Skipping icon generation - electron-builder will use defaults."
    exit 0
fi

# Use 'magick' if available (ImageMagick 7+), otherwise 'convert'
if command -v magick &> /dev/null; then
    CONVERT="magick"
else
    CONVERT="convert"
fi

# Generate placeholder if no source provided
if [ -z "$SOURCE_IMAGE" ]; then
    echo "Generating placeholder icon..."
    SOURCE_IMAGE="$BUILD_DIR/icon-source.png"

    # Create a simple blue gradient icon with "I3X" text
    $CONVERT -size 1024x1024 \
        -define gradient:angle=135 \
        gradient:'#3b82f6-#1e40af' \
        -gravity center \
        -font Helvetica-Bold \
        -pointsize 400 \
        -fill white \
        -annotate 0 "I3X" \
        "$SOURCE_IMAGE"
fi

echo "Source image: $SOURCE_IMAGE"

# Generate PNG icon (for Linux)
echo "Generating PNG icons for Linux..."
for size in 16 24 32 48 64 128 256 512 1024; do
    $CONVERT "$SOURCE_IMAGE" -resize ${size}x${size} "$BUILD_DIR/icon-${size}.png"
done
cp "$BUILD_DIR/icon-256.png" "$BUILD_DIR/icon.png"

# Generate ICO icon (for Windows)
echo "Generating ICO icon for Windows..."
$CONVERT "$SOURCE_IMAGE" \
    -define icon:auto-resize=256,128,64,48,32,16 \
    "$BUILD_DIR/icon.ico"

# Generate ICNS icon (for macOS)
echo "Generating ICNS icon for macOS..."
ICONSET_DIR="$BUILD_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

$CONVERT "$SOURCE_IMAGE" -resize 16x16     "$ICONSET_DIR/icon_16x16.png"
$CONVERT "$SOURCE_IMAGE" -resize 32x32     "$ICONSET_DIR/icon_16x16@2x.png"
$CONVERT "$SOURCE_IMAGE" -resize 32x32     "$ICONSET_DIR/icon_32x32.png"
$CONVERT "$SOURCE_IMAGE" -resize 64x64     "$ICONSET_DIR/icon_32x32@2x.png"
$CONVERT "$SOURCE_IMAGE" -resize 128x128   "$ICONSET_DIR/icon_128x128.png"
$CONVERT "$SOURCE_IMAGE" -resize 256x256   "$ICONSET_DIR/icon_128x128@2x.png"
$CONVERT "$SOURCE_IMAGE" -resize 256x256   "$ICONSET_DIR/icon_256x256.png"
$CONVERT "$SOURCE_IMAGE" -resize 512x512   "$ICONSET_DIR/icon_256x256@2x.png"
$CONVERT "$SOURCE_IMAGE" -resize 512x512   "$ICONSET_DIR/icon_512x512.png"
$CONVERT "$SOURCE_IMAGE" -resize 1024x1024 "$ICONSET_DIR/icon_512x512@2x.png"

# Create ICNS (macOS only)
if command -v iconutil &> /dev/null; then
    iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"
    rm -rf "$ICONSET_DIR"
else
    echo "iconutil not found (macOS only). ICNS not generated."
    echo "On macOS, run: iconutil -c icns $ICONSET_DIR -o $BUILD_DIR/icon.icns"
fi

echo ""
echo "Icons generated in $BUILD_DIR:"
ls -la "$BUILD_DIR"/*.{png,ico,icns} 2>/dev/null || true
echo ""
echo "Done! To use custom icons, run:"
echo "  ./scripts/generate-icons.sh /path/to/your/icon.png"
