# i3X Explorer

A cross-platform desktop application for browsing and monitoring I3X (Industrial Information Interface eXchange) API servers. Similar to [MQTT Explorer](https://mqtt-explorer.com/) but for the I3X protocol.

![i3X Explorer](build/icon.png)

## Features

- Connect to any I3X-compliant server
- Browse hierarchical data: Namespaces → Object Types → Objects
- View object details, metadata, and current values
- Subscribe to objects for real-time updates via SSE
- Search and filter the object tree

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

```bash
# Best way to build
./scripts/build-all.sh [mac|win|linux|all]

# Manually Build for current platform
npm run build

# Manually Build Platform-specific
npm run build:mac          # macOS (Intel + Apple Silicon)
npm run build:win          # Windows (x64, x86, portable)
npm run build:linux        # Linux (AppImage x64 + ARM64)
npm run build:all          # All platforms
```

Build artifacts are output to `release/{version}/`.

### Updating the Icon

```bash
# Requires ImageMagick: brew install imagemagick
./scripts/generate-icons.sh /path/to/your/icon.png

# Then rebuild
npm run build
```

## Usage

1. Launch i3X Explorer
2. Enter the server URL (default: `https://i3x.cesmii.net`)
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

- [I3X API Documentation](https://i3x.cesmii.net/docs)
- [I3X RFC Specification](https://github.com/cesmii/API/blob/main/RFC%20for%20Contextualized%20Manufacturing%20Information%20API.md)
- [CESMII - The Smart Manufacturing Institute](https://www.cesmii.org/)

## License

MIT License - see [LICENSE](LICENSE) for details.
