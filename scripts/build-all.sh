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

# Load Apple credentials if the local file exists (not committed to git)
if [ -f "$SCRIPT_DIR/set-apple-vars.sh" ]; then
    source "$SCRIPT_DIR/set-apple-vars.sh"
fi

# Check macOS signing/notarization readiness (informational only — steps fail gracefully)
if [ "$TARGET" = "mac" ] || [ "$TARGET" = "all" ]; then
    HAS_CERT=false
    HAS_NOTARIZE=false

    if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
        HAS_CERT=true
    fi

    if [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
        HAS_NOTARIZE=true
    fi

    echo ""
    if [ "$HAS_CERT" = true ] && [ "$HAS_NOTARIZE" = true ]; then
        echo "✓ macOS: code signing + notarization enabled"
    elif [ "$HAS_CERT" = true ]; then
        echo "⚠  macOS: code signing enabled, notarization skipped"
        echo "   Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID to notarize"
    else
        echo "⚠  macOS: unsigned build — arm64 users will see 'app is damaged' when downloaded"
        echo "   Requires a 'Developer ID Application' certificate in your keychain"
        echo "   and APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID env vars"
        # Suppress electron-builder's signing auto-discovery to avoid spurious errors
        export CSC_IDENTITY_AUTO_DISCOVERY=false
    fi
    echo ""
fi

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
