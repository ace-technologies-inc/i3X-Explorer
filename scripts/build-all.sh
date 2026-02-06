#!/bin/bash
# Build i3X Explorer for all platforms
# Usage: ./scripts/build-all.sh [mac|win|linux|all]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Ensure correct Node version
if command -v nvm &> /dev/null; then
    source ~/.nvm/nvm.sh
    nvm use 20 2>/dev/null || nvm install 20
fi

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js 18+ required (found v$NODE_VERSION)"
    echo "Install with: nvm install 20 && nvm use 20"
    exit 1
fi

TARGET="${1:-all}"
VERSION=$(node -p "require('./package.json').version")

echo "========================================"
echo "Building i3X Explorer v${VERSION}"
echo "Target: $TARGET"
echo "========================================"

# Clean and build Vite once (avoid redundant rebuilds per platform)
npm run clean
npm run build:vite

# Run electron-builder for selected target(s)
case "$TARGET" in
    mac)
        npx electron-builder --config electron-builder.json --mac
        ;;
    win)
        npx electron-builder --config electron-builder.json --win
        ;;
    linux)
        npx electron-builder --config electron-builder.json --linux
        ;;
    all)
        npx electron-builder --config electron-builder.json --mac --win --linux
        ;;
    *)
        echo "Usage: $0 [mac|win|linux|all]"
        exit 1
        ;;
esac

echo ""
echo "========================================"
echo "Build complete! Artifacts in:"
echo "  $PROJECT_DIR/release/${VERSION}/"
echo "========================================"
ls -lh "$PROJECT_DIR/release/${VERSION}/" 2>/dev/null || true
