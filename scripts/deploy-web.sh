#!/usr/bin/env bash
# deploy-web.sh — build i3X Explorer web app and reload nginx
# Run manually after a git pull, or automatically via the systemd service.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[i3x] Repo: $REPO_DIR"
echo "[i3x] Node: $(node --version), npm: $(npm --version)"

cd "$REPO_DIR"

echo "[i3x] Installing dependencies..."
npm ci --prefer-offline

echo "[i3x] Building web app..."
npm run build:web

# Restore server-local config.json if one exists outside dist-web.
# Create /home/cesmii/repos/i3X-Explorer/config.local.json to override defaults.
CONFIG_LOCAL="$REPO_DIR/config.local.json"
if [ -f "$CONFIG_LOCAL" ]; then
  echo "[i3x] Applying config.local.json..."
  cp "$CONFIG_LOCAL" "$REPO_DIR/dist-web/config.json"
fi

echo "[i3x] Build complete → $REPO_DIR/dist-web"

# Reload nginx if running (requires passwordless sudo for this command,
# or run the whole script as root)
if systemctl is-active --quiet nginx; then
  echo "[i3x] Reloading nginx..."
  sudo systemctl reload nginx
  echo "[i3x] nginx reloaded."
else
  echo "[i3x] nginx is not running — skipping reload."
fi

echo "[i3x] Done."
