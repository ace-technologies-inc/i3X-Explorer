# i3X Explorer Project

## Overview

i3X Explorer is a cross-platform desktop application for browsing and monitoring I3X (Industrial Information Interface eXchange) API servers. Similar to MQTT Explorer but for the I3X protocol.

**Stack:** Electron + React + TypeScript + Vite + Tailwind CSS

## Project Structure

```
i3x-explorer/
├── electron/                # Electron main process
│   ├── main.ts             # App entry, window management
│   └── preload.cjs         # Context bridge for IPC (CommonJS, loaded by Electron)
├── src/                    # React renderer
│   ├── main.tsx            # React entry
│   ├── App.tsx             # Root component
│   ├── api/                # I3X API client
│   │   ├── client.ts       # HTTP client (fetch-based)
│   │   ├── types.ts        # TypeScript interfaces
│   │   └── subscription.ts # SSE subscription handler
│   ├── components/         # UI components
│   │   ├── layout/         # Toolbar, Sidebar, MainPanel, BottomPanel
│   │   ├── tree/           # TreeView for hierarchy browsing
│   │   ├── details/        # Detail panels (Namespace, ObjectType, Object)
│   │   ├── connection/     # ConnectionDialog
│   │   └── subscriptions/  # SubscriptionPanel
│   ├── stores/             # Zustand state management
│   │   ├── connection.ts   # Server connection state
│   │   ├── explorer.ts     # Tree/selection state
│   │   └── subscriptions.ts# Active subscriptions & live values
│   └── styles/             # Tailwind CSS
├── build/                  # Build resources (icons, entitlements)
├── scripts/                # Build helper scripts
├── release/                # Built installers (not in git)
├── electron-builder.json   # Packaging configuration
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## Development

```bash
# Prerequisites: Node.js 18+ (project has .nvmrc file)
nvm use

# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Type checking
npm run typecheck
```

## Building Installers

**Important:** Use Node.js 18+ before building. The project includes an `.nvmrc` file.

```bash
# First, switch to the correct Node version
nvm use 20  # or: nvm use (if .nvmrc is configured)

# Generate icons (uses build/icon-1024.png by default)
./scripts/generate-icons.sh

# Build for all platforms (best way, recommended for releases)
./scripts/build-all.sh [mac|win|linux|web|all]

# Platform-specific builds
npm run build:all          # All
npm run build:mac          # macOS (Intel + Apple Silicon)
npm run build:mac:x64      # macOS Intel only
npm run build:mac:arm64    # macOS Apple Silicon only
npm run build:win          # Windows (x64 + x86 + portable)
npm run build:linux        # Linux (AppImage + tar.gz)
npm run build:web          # Web (static files → dist-web/, zip → release/{version}/)
```

### macOS Notarization

For notarized macOS builds (required to avoid "app is damaged" on Apple Silicon downloads), create `scripts/set-apple-vars.sh` (git-ignored) with:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # from appleid.apple.com
export APPLE_TEAM_ID="XXXXXXXXXX"                          # from developer.apple.com/account
```

Also requires a **Developer ID Application** certificate (not "Mac Installer Distribution") in the keychain — create via Xcode → Settings → Accounts → Manage Certificates.

`build-all.sh` sources this file automatically. If absent or vars unset, the build completes unsigned with a warning. Notarization logic lives in `scripts/notarize.cjs` (afterSign hook).

### Windows Signing

Windows signing uses **Azure Trusted Signing** (Microsoft-managed CA, ~$10/month). It fully suppresses the SmartScreen "Unknown publisher" warning. Signing must be done on a Windows machine — `signtool.exe` (a Windows-only binary) does the Authenticode embedding; there is no viable cross-platform path for this step.

**To sign a Windows build**, run on a Windows box:
```powershell
.\scripts\build-sign-win.ps1
```

The script builds the installer, auto-downloads the Azure Trusted Signing dlib from NuGet on first run (cached in `scripts\.azure-signing\`, git-ignored), then signs and verifies all `.exe` files.

The dlib version is pinned in `$DlibVersion` near the top of the script. Microsoft releases updates periodically — if SmartScreen warnings reappear on a previously-clean build, bump this value to the latest on [NuGet](https://www.nuget.org/packages/Microsoft.Trusted.Signing.Client). The script automatically detects a version mismatch, wipes the cache, and re-downloads.

Credentials go in `scripts\set-azure-vars.ps1` (git-ignored; template at `scripts\set-azure-vars.example.ps1`):
```powershell
$env:AZURE_TENANT_ID                = "..."   # Entra ID → Overview → Tenant ID
$env:AZURE_CLIENT_ID                = "..."   # Entra ID → App registrations → your app → Application (client) ID
$env:AZURE_CLIENT_SECRET            = "..."   # same app → Certificates & secrets → Client secrets → Value
$env:AZURE_TRUSTED_SIGNING_ENDPOINT = "..."   # Trusted Signing account → Overview → URI
$env:AZURE_TRUSTED_SIGNING_ACCOUNT  = "..."   # Trusted Signing account → Overview → Name
$env:AZURE_TRUSTED_SIGNING_PROFILE  = "..."   # Trusted Signing account → Certificate profiles → profile name
```

The app registration needs the **Trusted Signing Certificate Profile Signer** role assigned on the signing account (Azure portal → signing account → Access control (IAM)).

Full setup walkthrough: see `WINDOWS-SIGNING.md`.

**Output:** `release/{version}/`

| Platform | Artifacts |
|----------|-----------|
| macOS | `.dmg`, `.zip` (x64 & arm64) |
| Windows | `.exe` installer, portable `.exe` |
| Linux | `.AppImage`, `.tar.gz` (x64 & arm64) |
| Web | `-web.zip` (extract to any static web server) |

### Linux AppImage Compatibility

The Linux build uses a post-pack hook (`scripts/afterPackLinux.cjs`) that wraps the Electron binary with a small shell script. This is necessary because:

- **SUID sandbox**: AppImages mount squashfs as a regular user, so `chrome-sandbox` loses its SUID bit. The wrapper injects `--no-sandbox` so Chromium doesn't abort.
- **Wayland**: The wrapper sets `ELECTRON_OZONE_PLATFORM_HINT=auto` so Electron uses the native Wayland backend when `WAYLAND_DISPLAY` is present, rather than defaulting to XWayland (which GNOME on Wayland often fails to display).

**GPU / VM environments**: `electron/main.ts` calls `app.disableHardwareAcceleration()` on Linux to avoid VA-API initialization failures on systems without working GPU drivers (e.g. VMware SVGA II). `ready-to-show` depends on the GPU compositor for first-paint and won't fire when hardware acceleration is disabled, so a `did-finish-load` fallback is used to show the window instead.

**inotify watches**: If the app hangs silently on a Linux machine with many file-watching tools running (VS Code, JetBrains, Dropbox), the system inotify limit may be exhausted. Fix with:
```bash
sudo sysctl -w fs.inotify.max_user_watches=524288
sudo sysctl -w fs.inotify.max_user_instances=512
```

### Icon Generation

The `scripts/generate-icons.sh` script generates platform-specific icons:
- Uses `build/icon-1024.png` as the source by default
- Generates `.ico` (Windows), `.icns` (macOS), and various `.png` sizes (Linux)
- Requires ImageMagick (`brew install imagemagick`)
- Run before building to ensure icons are up to date

## Features

- Connect to I3X servers (default: https://api.i3x.dev/v1)
- Ignore certificate errors checkbox in connection dialog (Electron only) — for self-signed / dev servers; persisted across restarts
- Browse hierarchical tree: Namespaces → ObjectTypes → Objects
- Browse flat Objects list (lazy-loaded)
- Expand compositional objects to see children
- Tree auto-refresh: expanding a branch always re-fetches from the server; 30s background poll refreshes all expanded branches
- View object details, metadata, and current values
- Current Value pane has a **Parsed / Raw** toggle — Raw shows the untouched HTTP response body; for composition objects the component rows middle-truncate the elementId and round numeric values, with full id/value/timestamp on hover
- Copy-to-clipboard floating icon on every JSON pane (object data, schema, raw value, etc.)
- Relationship graph visualization for non-compositional relationships; click any node to navigate and expand it in the sidebar tree; hover nodes for full-name tooltip. The canvas sizes to its content and keeps the node cluster centered
- Subscribe to objects for real-time updates (polling or SSE); subscriptions auto-recover transparently on server-side expiry (HTTP 404/410)
- Trend chart for numeric subscription values
- Search/filter tree nodes (inline sidebar filter); tree scrolls horizontally for long/deeply-nested labels
- Collapse/expand the tree (sidebar) panel via the panel-toggle button at the left of the toolbar
- Global object search modal (🔍 toolbar icon or ⌘K / Ctrl+K) — searches all objects by name or elementId, shows breadcrumb path, navigates to and expands the match in the tree (Hierarchy preferred, Objects flat as fallback)
- Light/dark theme toggle (persists across restarts; falls back to OS preference)
- Web deployment: `dist-web/` can be served as a static site; `config.json` pre-populates the server URL and recent connections list on first visit

## Key Resources

- **API Documentation**: https://api.i3x.dev/v1/docs (OpenAPI spec at /openapi.json)
- **RFC Specification**: https://github.com/cesmii/API/blob/main/RFC%20for%20Contextualized%20Manufacturing%20Information%20API.md
- **Reference Implementation**: ~/Projects/API/demo (Python FastAPI server + test client)

## I3X API Concepts

### Core Entities

| Entity | Description |
|--------|-------------|
| **Namespace** | Logical scope organizing related types/instances (identified by URI) |
| **ObjectType** | Schema definition for objects (JSON Schema) |
| **ObjectInstance** | Actual data point with elementId, typeId, parentId, relationships |
| **RelationshipType** | Defines how objects relate (HasParent, HasChildren, HasComponent) |
| **ElementId** | Platform-specific persistent unique identifier for any entity |

### Data Model

**VQT (Value-Quality-Timestamp)** — Standard envelope for all values:
```json
{
  "value": <data>,
  "quality": "Good" | "GoodNoData" | "Bad",
  "timestamp": "<RFC 3339>"
}
```

**Composition** — Objects with `isComposition: true` contain nested children traversable via `maxDepth`:
- `maxDepth=0`: Infinite recursion
- `maxDepth=1`: No recursion (default)
- `maxDepth=N`: Recurse N levels through HasComponent

## API Endpoints

### Explore (Discovery)
- `GET /namespaces` — List all namespaces
- `GET /objecttypes?namespaceUri=` — List object types
- `POST /objecttypes/query` — Query types by elementId(s)
- `GET /relationshiptypes?namespaceUri=` — List relationship types
- `POST /relationshiptypes/query` — Query relationships by elementId(s)
- `GET /objects?typeId=&includeMetadata=` — List object instances
- `POST /objects/list` — Query objects by elementId(s)
- `POST /objects/related` — Get related objects by relationship type

### Query (Values)
- `POST /objects/value` — Get last known values (supports maxDepth)
- `POST /objects/history` — Get historical values (startTime, endTime, maxDepth)

### Update (Write)
- `PUT /objects/{elementId}/value` — Update current value
- `PUT /objects/{elementId}/history` — Update historical values

### Subscribe (Real-time)
- `POST /subscriptions` — Create subscription
- `GET /subscriptions` — List all subscriptions
- `GET /subscriptions/{id}` — Get subscription details
- `DELETE /subscriptions/{id}` — Delete subscription
- `POST /subscriptions/{id}/register` — Register monitored items (elementIds, maxDepth)
- `POST /subscriptions/{id}/unregister` — Remove monitored items
- `GET /subscriptions/{id}/stream` — SSE stream (QoS0)
- `POST /subscriptions/{id}/sync` — Poll queued updates (QoS2)

## Request Patterns

### Single vs Batch
Most endpoints accept either single `elementId` or array `elementIds`:
```json
{"elementId": "single-id"}
// or
{"elementIds": ["id1", "id2", "id3"]}
```

### Batch Response Format
Value endpoints return keyed responses for batch requests:
```json
{
  "elementId1": {"data": [{"value": 123, "quality": "GOOD", "timestamp": "..."}]},
  "elementId2": {"data": [{"value": 456, "quality": "GOOD", "timestamp": "..."}]}
}
```

## Reference Implementation (~/Projects/API/demo)

### Server (FastAPI)
```
server/
├── app.py              # Main app, lifecycle, config loading
├── models.py           # Pydantic models (RFC-compliant)
├── config.json         # Current config (cnc-mock data source)
├── routers/
│   ├── namespaces.py   # RFC 4.1.1
│   ├── typeDefinitions.py  # RFC 4.1.2-4.1.5
│   ├── objects.py      # RFC 4.1.5-4.2.2
│   └── subscriptions.py    # RFC 4.2.3
└── data_sources/
    ├── data_interface.py   # Abstract I3XDataSource
    ├── factory.py          # Data source factory
    ├── manager.py          # Multi-source routing
    ├── mock/               # Generic manufacturing mock
    ├── cnc_mock/           # CNC machine mock (CESMII profile)
    └── mqtt/               # Real MQTT broker integration
```

### Data Source Interface
Key methods any data source must implement:
- `get_namespaces()`, `get_object_types()`, `get_relationship_types()`
- `get_instances()`, `get_instance_by_id()`, `get_related_instances()`
- `get_instance_value()`, `get_instance_history()`
- `update_instance_value()`, `update_instance_history()`
- `start(callback)`, `stop()` — Lifecycle with update callbacks

### Running the Demo
```bash
# Server (port 8080)
cd ~/Projects/API/demo/server && python app.py

# Client (interactive CLI)
cd ~/Projects/API/demo/client && python test_client.py

# Swagger UI
open http://localhost:8080/docs
```

## Design Principles (from RFC)

1. **Abstraction over implementation** — Unified interface regardless of backend
2. **Platform independence** — Works on OPC UA, MQTT, historians, cloud
3. **Separation of concerns** — Explore vs Query vs Update vs Subscribe
4. **Application portability** — Apps work across different platforms unchanged

## Authentication

- Minimum: API key
- Optional: JWT, OAuth
- Production: Encrypted transport (HTTPS) required

## Common Patterns

### Subscription Flow
1. `POST /subscriptions` → Get subscriptionId
2. `POST /subscriptions/{id}/register` → Add elementIds to monitor
3. Either:
   - `GET /subscriptions/{id}/stream` → SSE for real-time (QoS0)
   - `POST /subscriptions/{id}/sync` → Poll for updates (QoS2)
4. `DELETE /subscriptions/{id}` → Cleanup

### Hierarchical Browsing
1. `GET /namespaces` → Find namespace URI
2. `GET /objecttypes?namespaceUri=` → Find type definitions
3. `GET /objects?typeId=` → Find instances of type
4. `POST /objects/related` → Navigate relationships
5. `POST /objects/value` with maxDepth → Get nested values

## Implementation Notes

### API Response Format
POST endpoints for values return **keyed responses** where each elementId maps to its data:
```json
{
  "elementId1": {"data": [{"value": 123, "quality": "GOOD", "timestamp": "2024-01-01T00:00:00Z"}]},
  "elementId2": {"data": [{"value": 456, "quality": "GOOD", "timestamp": "2024-01-01T00:00:00Z"}]}
}
```
The client extracts values by looking up `response[elementId].data[0]`.

### Tree Navigation Structure
The explorer uses two top-level folders:
- **Namespaces** → ObjectTypes → Objects (hierarchical by type)
- **Objects** → Flat list of all objects (lazy-loaded)

### Relationship Types for Tree vs Graph
- **Tree children**: Only show objects where `relationshipType === "HasComponent"` AND `isComposition === true` AND `parentId === currentObject.elementId`
- **Graph relationships**: All other relationships shown in RelationshipGraph component
- Without these filters, cycles cause infinite loops/hangs

### Multi-version Support
The client handles three spec generations transparently. `ApiVersion = 'v0' | 'v1-beta' | 'v1'` is detected at connect time and drives all branching in `src/api/client.ts`.

**Detection** — `detectVersion()` probes `GET /info`:
- No `/info` (or non-2xx) → `'v0'`
- `/info` OK, `result.specVersion` (or `version`/`apiVersion`) parses to ≥ 1.0 → `'v1'`
- `/info` OK but no recognisable version field → `'v1-beta'`

The toolbar badge shows **v0** (yellow), **v1 Beta** (blue), or **v1** (green).

**Wire-format differences handled by the client:**

| Concern | v0 (Alpha) | v1-beta (Beta) | v1 (Release) |
|---------|-----------|----------------|--------------|
| Response envelope | bare array/object | `{success, result}` | `{success, result}` |
| Bulk results | keyed `{elementId: {data:[...]}}` | `{results:[{elementId,result}]}` | same as Beta |
| Error body | `{error:{code,message}}` | `{problemDetail:{title,status,detail}}` | `{responseDetail:{title,status,detail}}` |
| Subscription endpoints | `/{id}/register`, `DELETE /{id}` | `/register` + id in body, `POST /delete` | same as Beta |
| Metadata extensions field | — | `extendedAttributes` | `schemaExtensions` |
| `/sync` partial response | — | — | HTTP 206 = queue overflow, logs warning |

`isV1()` (private helper) returns true for both `'v1-beta'` and `'v1'` — all v1 wire-format branching goes through it so Beta and Release share the same code paths. The `extendedAttributes` → `schemaExtensions` rename is normalised in `normalizeV1Object()`: both field names are accepted and always surfaced as `schemaExtensions` on `ObjectInstance`.

### SSE vs Polling
- **SSE (QoS0)** is the default — real-time streaming via `GET /subscriptions/{id}/stream`
- **Polling (QoS2)** available as fallback — uses `POST /subscriptions/{id}/sync`
- Both use the same keyed response format

### SSE/Sync Response Format
Both SSE and sync endpoints return arrays of keyed objects:
```
data: [{"elementId": {"data": [{"value": 123, "quality": "GOOD", "timestamp": "..."}]}}]

data: [{"elementId": {"data": [{"value": 456, "quality": "GOOD", "timestamp": "..."}]}}]

```
SSE format requirements:
1. `data: ` prefix
2. Two newlines (`\n\n`) after each message
3. `Content-Type: text/event-stream` header

### CORS Configuration
The Electron app sets `webSecurity: false` in `BrowserWindow`, which disables CORS enforcement in the renderer entirely. This is appropriate for a trusted desktop app and avoids preflight failures against servers with incomplete CORS headers. All HTTP requests are made directly from the renderer process (visible in DevTools Network tab).

For server-side reference only — if building a web-based client, configure CORS in **either** the reverse proxy (nginx) **or** the application (FastAPI), **not both**. Duplicate headers cause browsers to reject responses.

**FastAPI (recommended):**
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**nginx (if not using FastAPI CORS):**
```nginx
location / {
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;

    if ($request_method = 'OPTIONS') {
        return 204;
    }

    # SSE settings
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    proxy_http_version 1.1;
    proxy_set_header Connection '';

    proxy_pass http://localhost:8080;
}
```

### Tree Refresh
- Expanding any branch always re-fetches from the server (no stale cache)
- Hierarchy nodes (`hier:` prefix) re-fetch `allObjects` on expand — important for MQTT adapters that discover objects dynamically as topics arrive
- A 30-second background poll refreshes all currently-expanded branches while connected (controlled by `BACKGROUND_POLL_ENABLED` in `TreeView.tsx`)

### Theme System
- Colors are defined as CSS custom properties (space-separated RGB channels) in `src/styles/index.css`
- Light theme is the default (`:root`); dark theme activates via `@media (prefers-color-scheme: dark)` or `[data-theme="dark"]` on `<html>`
- The toolbar sun/moon button sets `document.documentElement.dataset.theme` and persists the choice to `localStorage`
- Tailwind tokens use `rgb(var(--i3x-...) / <alpha-value>)` format so opacity modifiers (`/20`, `/50`) continue to work
- SVG chart components (TrendView, HistoryPanel, RelationshipGraph) use `rgb(var(--i3x-...))` strings in their `COLORS` objects

### Trend View
- Stores up to 60 data points per elementId
- Only displays for numeric values
- Updates in real-time during active subscriptions

### Global Object Search
- Component: `src/components/search/SearchModal.tsx`
- Triggered by 🔍 toolbar button or ⌘K / Ctrl+K (disabled when not connected)
- Searches `allObjects` by `displayName` or `elementId` (case-insensitive substring); fetches from server if store is empty
- Results capped at 50; sorted hierarchy-first, then alphabetical
- **Tree preference**: an object is shown with a "Hierarchy" badge if it is a hierarchical root or has a non-empty `parentId` (not `/`); otherwise "Objects" badge
- **Navigation** on result select: batch-expands `folder:hierarchical` + every `hier:{ancestorId}` up the `parentId` chain, then calls `selectItem` with the `hier:{elementId}` id. Falls back to expanding `folder:objects` and selecting `obj:{elementId}` for non-hierarchy objects
- Ancestor expansion uses `useExplorerStore.setState({ expandedNodes })` in one write to avoid multiple re-renders

### Relationship Graph Navigation
- Clicking a node in `RelationshipGraph` navigates to that object in the sidebar tree
- Uses the same atomic ancestor expansion pattern as SearchModal: reads fresh state via `useExplorerStore.getState()` (not stale closure), builds a complete `newExpanded` Set from the current `expandedNodes`, then commits in one `setState` call before invoking `selectItem`
- Guards `allObjects` and `hierarchicalRoots` independently — either can be empty without triggering the other's fetch

### Relationship Graph Layout
- The SVG canvas is **derived from content**, not fixed. A single `useMemo` measures each node's circular offset (`halfX`/`halfY` = furthest horizontal/vertical reach), then computes `width`/`height`, the cluster center, node `positions`, and legend position. Sparse or vertically-stacked layouts don't reach the full `RADIUS`, so the canvas shrinks to fit
- The node cluster is **always centered both axes**: `centerX = width/2`, `centerY = CANVAS_PAD + halfY`. Because center is *defined* as the canvas center, nodes can't drift to one side. The legend is a fixed-size band (`LEGEND_WIDTH`/`LEGEND_HEIGHT`) centered along the bottom (`legendX = (width - LEGEND_WIDTH)/2`) so it no longer skews horizontal centering
- The SVG is responsive: `viewBox="0 0 {width} {height}"` with `style={{ maxWidth: '100%', height: 'auto' }}`, so it scales down when the pane is cramped while the column sizes to the graph's natural width
- Changing node box size / spacing only requires editing `BOX_WIDTH`, `BOX_HEIGHT`, `RADIUS`; legend sizing via the `LEGEND_*` constants

### Object Detail Pane (`ObjectDetail` / `ValueDisplay`)
- **Parsed / Raw value toggle**: a segmented control in the Current Value header (state `valueView` in `ObjectDetail`). Raw renders `value.rawResponse` (the untouched HTTP body) via `JsonViewer`. `client.getValue` retains that body on `LastKnownValue.rawResponse` for both v1 and v0; the batch `getValues` does **not** (only the single-object detail pane needs it)
- **Component rows** (composition values): the elementId is middle-truncated with a two-span flex trick (head ellipsizes, last `COMPONENT_ID_TAIL` chars stay pinned); numeric values are rounded via `formatComponentValueShort` (`toPrecision(6)` → `Number()` to strip trailing zeros, keeps exponential form). Full id / full-precision value / full timestamp are all in `title` tooltips
- **Copy-to-clipboard**: `CopyButton` (`src/components/details/CopyButton.tsx`) is a floating corner icon embedded in `JsonViewer`, so every JSON pane gets it for free. Uses `navigator.clipboard`, `stopPropagation` (so it doesn't trigger the collapsed-view expand), and fails silently in insecure contexts
- **Responsive layout**: graph + value sit side-by-side and stack below **1140px** via Tailwind's arbitrary `min-[1140px]:` variant. The value column carries `min-w-0` so it can shrink and let `ValueDisplay`'s internal truncation engage instead of forcing the pane wide (a classic flexbox `min-width:auto` overflow); the metadata bar uses `flex-wrap`

### Sidebar Collapse & Tree Horizontal Scroll
- **Collapse**: `sidebarCollapsed` + `toggleSidebar()` live in the explorer store; the panel-toggle button is at the left of the `Toolbar`. `Sidebar` returns `null` when collapsed but stays mounted, so its drag-`width` state is preserved and restored on expand
- **Horizontal scroll**: tree labels use `whitespace-nowrap` (not `truncate`) so rows grow to natural width; the tree body is a both-axes scroll area with an inner `w-max min-w-full` wrapper (rows share a uniform width — highlights and count leader-lines stay correct — and overflow horizontally). The filter input is a fixed header above the scroll body so it neither stretches nor scrolls away

### Subscription Recovery
- `src/api/subscription.ts` exports `HttpStatusError` (carries `.status: number`) and `isSubscriptionGoneError(error)` helper
- HTTP 404/410 on the SSE stream calls `onError` directly instead of entering the reconnect loop — retrying a gone subscription always fails
- `SubscriptionPanel` catches these via `isSubscriptionGoneError()` and calls `handleRecovery()`: tears down the stale subscription, creates a fresh one, re-registers monitored items, resumes streaming, and updates `activeSubscriptionId`
- Recovery is capped at 3 attempts (`recoveryAttemptsRef`); the counter resets to 0 on the first successful data delivery
- Polling path errors from `client.sync()` use string-prefix matching as fallback (those errors come from `client.ts`, not `subscription.ts`)

### Subscribe Error Handling
- `ObjectDetail.handleSubscribe` shows an inline error below the Subscribe button if `registerMonitoredItems` throws; the button is disabled and relabelled "Subscribing..." during the async call
- If a subscription was freshly created by `createSubscription` but `registerMonitoredItems` then fails, the new subscription is removed from the store and a best-effort `deleteSubscription` is fired to avoid leaving an empty orphan on the server
- The error message clears automatically when the user navigates to a different object

### Ignore Certificate Errors (Electron only)
- Checkbox in the connection dialog, hidden in web mode (`window.electronAPI` guard)
- Stored as `ignoreCertErrors: boolean` in the connection store (persisted to localStorage)
- On save: calls `window.electronAPI.setIgnoreCertErrors(flag)` → IPC send → module-level flag in `electron/main.ts`
- On app startup: `App.tsx` syncs the persisted value to the main process via the same IPC call so the setting survives restarts
- Main process registers `app.on('certificate-error', ...)` at startup; when the flag is set it calls `event.preventDefault(); callback(true)` to bypass the error

### Web Build
- Config: `vite.web.config.ts` — must use `base: './'` so all asset paths in `index.html` are document-relative, allowing deployment to any subdirectory path
- The `index.html` source uses relative (no leading `/`) hrefs for favicon and icons for the same reason
- Runtime server config: `src/main.tsx` fetches `./config.json` on startup; if no `localStorage` state exists yet, `serverUrl` and `recentUrls` from that file are applied as defaults
- On a git-synced server, put overrides in `config.local.json` at the repo root — `scripts/deploy-web.sh` copies it to `dist-web/config.json` after each build
- `scripts/deploy-web.sh` runs `git pull` then `npm ci` then `npm run build:web` then optionally reloads nginx; triggered by `sudo systemctl restart i3x-explorer-web`
- Live deployment: https://explorer.i3x.dev (nginx serving `dist-web/` from the cloned repo at `/home/cesmii/repos/i3X-Explorer`)

### SVG Tooltips in Electron
- Electron's Chromium suppresses native SVG `<title>` tooltips — they never appear
- Use a React state + HTML overlay approach instead: track `{ label, x, y }` state, set it on `onMouseEnter` of each SVG `<g>` node, update position on `onMouseMove` of the wrapper div, clear on `onMouseLeave`, render as an absolutely-positioned `<div>` with `pointerEvents: none`
