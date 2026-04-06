# i3X Explorer

A cross-platform desktop application for browsing and monitoring I3X (Industrial Information Interface eXchange) API servers. Similar to [MQTT Explorer](https://mqtt-explorer.com/) but for the I3X protocol.

![i3X Explorer](website/icon-64.png)

## Features

- Connect to any I3X-compliant server
- Browse hierarchical data: Namespaces → Object Types → Objects
- Tree auto-refresh: expanding a branch re-fetches from the server; 30s background poll keeps data current
- View object details, metadata, and current values
- Subscribe to objects for real-time updates via SSE
- Search and filter the object tree
- Light and dark theme with toggle button (follows OS preference by default)

## Installation

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | `i3X Explorer-x.x.x-mac-arm64.dmg` |
| macOS (Intel) | `i3X Explorer-x.x.x-mac-x64.dmg` |
| Windows (64-bit) | `i3X Explorer-x.x.x-win-x64.exe` |
| Windows (32-bit) | `i3X Explorer-x.x.x-win-ia32.exe` |
| Windows (Portable) | `i3X Explorer-x.x.x-portable.exe` |
| Linux (x64) | `i3X Explorer-x.x.x-linux-x86_64.AppImage` |
| Linux (ARM64) | `i3X Explorer-x.x.x-linux-arm64.AppImage` |

### Linux AppImage

```bash
chmod +x "i3X Explorer-x.x.x-linux-x86_64.AppImage"
./"i3X Explorer-x.x.x-linux-x86_64.AppImage"
```

**Ubuntu 22.04+ / Debian:** AppImages require FUSE 2, which is not installed by default on newer distributions. If the AppImage fails to launch, install the required library:

```bash
sudo apt install libfuse2
```

Optionally, consider using [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) to integrate into your Launcher.

## Development

### Prerequisites

- Node.js 18+ (recommend using [nvm](https://github.com/nvm-sh/nvm))
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/cesmii/I3X-Explorer.git
cd I3X-Explorer

# Use correct Node version
nvm use 20

# Install dependencies
npm install

# Generate app icons (requires ImageMagick: brew install imagemagick)
./scripts/generate-icons.sh build/icon-1024.png

# Start Electron app in development mode (with hot reload)
npm run dev
```

### Browser-Only Mode

You can also run just the React UI in a browser without Electron, which is useful for quick testing or development:

```bash
npx vite
```

This starts a Vite dev server at http://localhost:5173/ where you can access the full UI in your browser.

### Build Commands

Note: The best environment to build for all platforms is a modern macOS, however to sign the Windows binaries, you will have to build on Windows.

```bash
# Best way to build (mac/linux/all)
./scripts/build-all.sh [mac|win|linux|all]

# Manually Build for current platform
npm run build

# Manually Build Platform-specific
npm run build:mac          # macOS (Intel + Apple Silicon)
npm run build:win          # Windows (x64, x86, portable) — unsigned
npm run build:linux        # Linux (AppImage x64 + ARM64)
npm run build:all          # All platforms
```

Build artifacts are output to `release/{version}/`.

> **Note:** `build-all.sh win` and `npm run build:win` produce unsigned Windows builds. For signed Windows builds (required to suppress SmartScreen), use the dedicated PowerShell script on a Windows machine — see [Windows Signing](#windows-signing) below.

### macOS Notarization

To produce notarized macOS builds (required for arm64 downloads to open without a "app is damaged" error), you need an [Apple Developer account](https://developer.apple.com/) and a **Developer ID Application** certificate in your keychain.

1. **Create the certificate** — Xcode → Settings → Accounts → your Apple account → Manage Certificates → `+` → **Developer ID Application**

2. **Create an app-specific password** at [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords

3. **Find your Team ID** at [developer.apple.com/account](https://developer.apple.com/account) (top-right, 10 characters)

4. **Create `scripts/set-apple-vars.sh`** (this file is git-ignored):

   ```bash
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="XXXXXXXXXX"
   ```

5. **Build** — `./scripts/build-all.sh mac` will source the file automatically and notarize both Intel and Apple Silicon DMGs.

If `set-apple-vars.sh` is absent or the env vars are unset, the build completes unsigned with a warning.

### Windows Signing

To produce signed Windows builds (which fully suppress the SmartScreen "Unknown publisher" warning), run on a **Windows machine**:

```powershell
.\scripts\build-sign-win.ps1
```

This script builds the app, generates icons, and signs all `.exe` files using **Azure Trusted Signing**. It requires:

- [ImageMagick](https://imagemagick.org/script/download.php#windows) installed and on PATH
- [Windows Developer Mode](ms-settings:developers) enabled (or run as Administrator)
- Azure Trusted Signing credentials in `scripts\set-azure-vars.ps1` (git-ignored)

See [WINDOWS-SIGNING.md](WINDOWS-SIGNING.md) for full Azure setup instructions.

If you don't have signing set up, unsigned builds still work — users just need to click **More info → Run anyway** in the SmartScreen dialog.

### Updating the Icon

**macOS / Linux** (requires ImageMagick: `brew install imagemagick`):
```bash
./scripts/generate-icons.sh /path/to/your/icon.png
```

**Windows** (requires [ImageMagick for Windows](https://imagemagick.org/script/download.php#windows)):
```powershell
.\scripts\generate-icons.ps1 path\to\your\icon.png
```

Both scripts write to `build/` and are called automatically by the respective build scripts. After updating icons, rebuild the app.

## Usage

1. Launch i3X Explorer
2. Enter the server URL (default: `https://api.i3x.dev/v0`)
3. Click **Connect**
4. Browse the tree to explore namespaces, object types, and objects
5. Click any object to view its details and current value
6. Click **Subscribe** on an object to monitor real-time updates
7. Use the bottom panel to manage subscriptions and view live values

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **React** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool with hot reload
- **Tailwind CSS** - Utility-first styling
- **Zustand** - Lightweight state management

## Related Resources

- [I3X Information](https://i3x.dev)
- [I3X API Documentation](https://i3x.dev/sdk)
- [CESMII - The Smart Manufacturing Institute](https://www.cesmii.org/)

## License

MIT License - see [LICENSE](LICENSE) for details.
