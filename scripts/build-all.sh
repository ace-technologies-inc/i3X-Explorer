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

echo "========================================"
echo "Building i3X Explorer"
echo "Target: $TARGET"
echo "========================================"

case "$TARGET" in
    mac)
        npm run build:mac
        ;;
    win)
        npm run build:win
        ;;
    linux)
        npm run build:linux
        ;;
    all)
        npm run build:mac
        npm run build:linux
        npm run build:win
        ;;
    *)
        echo "Usage: $0 [mac|win|linux|all]"
        exit 1
        ;;
esac

echo ""
echo "========================================"
echo "Build complete! Artifacts in:"
echo "  $PROJECT_DIR/release/"
echo "========================================"
ls -lh "$PROJECT_DIR/release/0.1.0/"*.{dmg,exe,AppImage,tar.gz} 2>/dev/null || true
