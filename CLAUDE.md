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
│   │   ├── layout/         # Toolbar, Sidebar, MainPanel, StatusBar
│   │   ├── main/           # Home shell, element detail, tabs, breadcrumb
│   │   ├── graph/          # Relationships tab: RelationshipList (nested list), RelationshipGraph (depth-N map)
│   │   ├── tree/           # TreeView for hierarchy browsing
│   │   ├── details/        # Namespace/ObjectType detail, ValueDisplay, ElementStatus
│   │   ├── connection/     # ConnectionDialog
│   │   └── subscriptions/  # SubscriptionTransport, SubscriptionsDrawer/View, TrendView
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

# Type checking (covers src/ AND electron/ + vite configs, two tsc projects)
npm run typecheck

# Lint (ESLint 9 flat config, eslint.config.js; exhaustive-deps is an error)
npm run lint

# Unit tests (vitest, standalone vitest.config.ts; *.test.ts alongside sources)
npm test
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test, and a `build:vite` smoke on every push and PR.

### Tests

Most tests are pure-logic and run in the default `node` environment. A few are
**component render tests**, which opt in per file with a `// @vitest-environment jsdom`
docblock on line 1 (`jsdom`, `@testing-library/react` and `@testing-library/dom` are
devDependencies). jsdom computes no layout, so `src/testing/jsdomLayout.ts` installs the
minimum stand-in: `ResizeObserver`, `matchMedia`, `scrollIntoView`, and an `offsetHeight`
that makes a max-height-bounded scroll container as tall as its content. That is exactly
what virtualized lists measure, and it is what lets these tests catch a list that renders
zero rows (see the height contract in `insights/WindowedList.tsx`).

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

Also requires a **Developer ID Application** certificate (not "Mac Installer Distribution") in the keychain, create via Xcode → Settings → Accounts → Manage Certificates.

`build-all.sh` sources this file automatically. If absent or vars unset, the build completes unsigned with a warning. Notarization logic lives in `scripts/notarize.cjs` (afterSign hook).

### Windows Signing

Windows signing uses **Azure Trusted Signing** (Microsoft-managed CA, ~$10/month). It fully suppresses the SmartScreen "Unknown publisher" warning. Signing must be done on a Windows machine, `signtool.exe` (a Windows-only binary) does the Authenticode embedding; there is no viable cross-platform path for this step.

**To sign a Windows build**, run on a Windows box:
```powershell
.\scripts\build-sign-win.ps1
```

The script builds the installer, auto-downloads the Azure Trusted Signing dlib from NuGet on first run (cached in `scripts\.azure-signing\`, git-ignored), then signs and verifies all `.exe` files.

The dlib version is pinned in `$DlibVersion` near the top of the script. Microsoft releases updates periodically, if SmartScreen warnings reappear on a previously-clean build, bump this value to the latest on [NuGet](https://www.nuget.org/packages/Microsoft.Trusted.Signing.Client). The script automatically detects a version mismatch, wipes the cache, and re-downloads.

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
- Ignore certificate errors checkbox in connection dialog (Electron only), for self-signed / dev servers; persisted across restarts
- Browse hierarchical tree: Namespaces → ObjectTypes → Objects
- Relationship types under a namespace expand too: their source objects (via the vendor-extension `POST /objects/related-by-type`, all `Link: rel="next"` cursor pages followed), each expanding to the objects it relates to. Source rows use `relobj:{encodedRelTypeId}:{sourceId}` ids; sources are resolved from `objectIndex`, then `/objects/list`
- **The entire sidebar tree is virtualized**, every folder (Namespaces, Objects, Hierarchy) flattens into one windowed list, so only rows near the viewport are mounted no matter how many are visible; tens of thousands of objects (or children under one parent) stay responsive
- Huge child lists are **paged**: a parent with more than 50 children shows the first page plus a "Show 50 more · N hidden · show all" row. Right-click that row for "Show a specific number…" (a dialog) or "Show all children" (the flat Objects folder is exempt, browsing everything is its point)
- **Sticky ancestor header**: scrolling deep inside a big expansion pins the nearest ancestors at the top of the tree (VS Code-style); click a pinned row to jump back to it
- All UI icons are **inline SVGs** (`src/components/common/icons.tsx`), no emojis anywhere, so icons render identically on every platform and honor the theme
- Expand compositional objects to see children
- Tree auto-refresh: expanding a type/composition branch re-fetches from the server (hierarchy nodes read the already-loaded catalog); 30s background poll refreshes all expanded branches
- View object details, metadata, and current values
- Current Value pane has a **Parsed / Raw** toggle, Raw shows the untouched HTTP response body; for composition objects the component rows middle-truncate the elementId and round numeric values, with full id/value/timestamp on hover
- Copy-to-clipboard floating icon on every JSON pane (object data, schema, raw value, etc.)
- Home shell shows a **statistical model overview** built to be a launchpad, not a poster: largest containers and entry points (both clickable), objects by type (click to open the type), a hierarchy depth histogram, and a warning strip that appears only when the catalog has problems. Not a whole-model graph: at catalog scale that is an unreadable hairball
- Relationships tab puts **a nested relationship list and a depth-N tree in one full-width panel** (Fusion 360 style: browser list on the left, tree on the right). **Both draw one walk**, so the depth control moves them together: whatever the map draws is in the list, nested under the node it hangs off, each level capped/faded and paged 50 at a time. The tree walks out to a configurable depth (pills for 1 and 2, plus a "+" that reveals one deeper hop per click, default 1), drawn left-to-right with the root in the middle, parents in columns to the left and children to the right (the column is the generation, not the hop count), and every node on its own row so labels never overlap. A **Tree / Rings toggle** in the header switches between this tree and the older radial map (rings = hops); the tree is the default. Hover a list row to spotlight its node on the map; a row's **focus button zooms the map to that node and its children** and lights that branch (a view change only, nothing is re-fetched or selected), while **dragging** a row onto the map re-roots the walk there. **Right-click any row or group header** for open/focus/root, expand-all-below, show-all and the copy actions. A **header search box** filters the list as you type and autocompletes over it; picking a match zooms the map to that node and spotlights it (a locator, not a navigation)
- **Subtree tab** (next to History), the same left-to-right tree, but dedicated to deep nesting: the whole panel, descendants only (no parent leaf, no non-hierarchy fan-out off the root), its own depth setting (default 3) so drilling deep here doesn't drag the Relationships map along
- **Full screen on both map panels** (Relationships and Subtree): the maximize button in the card header hands the panel the whole window, Esc or the button brings it back, and nothing is lost on the way, the zoom, the focused branch and the list's expansion are all still there
- **Back / Forward walk pages, not just selections** (toolbar arrows, and the X1/X2 mouse buttons in Electron): a history stop is the element *plus the tab you were on* (Overview / Relationships / History / Subtree) *plus the full-panel page* (Model Insights, snapshot diff), so leaving an object's Subtree tab and coming back lands on that tab, and Back from a row you opened out of Model Insights returns to Model Insights
- Bottom status bar: connection state, server URL, object/namespace counts, subscription count (click to toggle the subscriptions drawer), and Developer tools
- Subscribe to objects for real-time updates (polling or SSE); subscriptions auto-recover transparently on server-side expiry (HTTP 404/410)
- Trend chart for numeric subscription values
- **Keyboard-first tree** (ARIA tree pattern): ↑/↓ move, → expands (or steps to first child), ← collapses (or jumps to parent), Home/End, Enter/Space select and toggle, and type-ahead, type letters to jump to the next matching row
- **Right-click context menu** on every tree row (also Shift+F10 / Menu key on the focused row, and on sticky-header rows). Actions adapt to the row: objects get Open / Open Relationships / Open Subtree / Open History (deep-links the detail tab), Expand all + Collapse subtree (Hierarchy view, capped at 1,000 branches), cross-view Reveal in Hierarchy ⇄ Reveal in Objects, and Copy name / element ID / object JSON / **subtree JSON** (nested `{…object, children: […]}`, count shown in the item). Types add Copy type JSON / instances JSON; namespaces Copy URI / types JSON; folders Copy namespaces / all objects / **whole hierarchy JSON**; "Show more" rows get their paging actions
- Search/filter tree nodes (inline sidebar filter); the filter matches against a prebuilt lowercase index (built once per catalog fetch) and runs deferred, so typing never stutters on huge catalogs; while filtering, the three root folders show live match-count pills in the accent color
- Tree visuals: VS Code-style indent guides at every depth (the selected node's subtree guide is accented), counts as rounded pills, newly expanded children ease in (disabled under reduced motion), hovering a row reveals a copy-element-ID action (copy-URI on namespaces), and rows span the sidebar's full width edge-to-edge (collapse-all and reveal-selection live in the right-click menu)
- Long tree labels truncate with an ellipsis (full name in the tooltip), so count pills stay pinned at the panel's right edge at any sidebar width, widening the sidebar reveals more of each name
- Collapse/expand the tree (sidebar) panel via the panel-toggle button at the left of the toolbar
- Global object search modal (toolbar Search button or ⌘K / Ctrl+K), searches all objects by name or elementId, shows breadcrumb path, navigates to and expands the match in the tree (Hierarchy preferred, Objects flat as fallback)
- **Model Insights**, a full main-panel page (opened from a Home summary card) built around what an engineer asks a single source of truth: the **type atlas** (the schema the instances imply, per type: placement distribution, composition with cardinality, depth, naming pattern), **conventions** (norms phrased affirmatively, auto-generated modeling documentation, and only when the type is meaningfully more constrained than the catalog at large; the rest fold away), **deviations** (exceptions to those conventions, Wilson-ranked and *explained*: outliers grouped by where they actually sit), **splits** (types whose placement is legitimately two populations, shown as distributions), a **data-quality hub** (orphans / untyped / duplicate ids, with unused types listed separately as information rather than an issue), and **most-anomalous objects** (count of independent norms broken). Exact counts, no ML, every list virtualized and every row navigable
- **Model snapshots & diff**, capture the loaded catalog to a compressed `.i3xsnap.gz` file (its metadata fetched on capture), load one back as a baseline, and diff it against the live catalog or a second snapshot. Added / removed / re-parented / re-typed / renamed / moved-namespace categories (+ opt-in metadata compare), provenance banner for cross-server comparisons, most-changed-subtrees summary, virtualized category lists with copy-as-JSON; rows that still exist live are clickable, removed rows visibly aren't
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

**VQT (Value-Quality-Timestamp)**: standard envelope for all values:
```json
{
  "value": <data>,
  "quality": "Good" | "GoodNoData" | "Bad",
  "timestamp": "<RFC 3339>"
}
```

**Composition**: objects with `isComposition: true` contain nested children traversable via `maxDepth`:
- `maxDepth=0`: Infinite recursion
- `maxDepth=1`: No recursion (default)
- `maxDepth=N`: Recurse N levels through HasComponent

## API Endpoints

### Explore (Discovery)
- `GET /namespaces`: list all namespaces
- `GET /objecttypes?namespaceUri=`: list object types
- `POST /objecttypes/query`: query types by elementId(s)
- `GET /relationshiptypes?namespaceUri=`: list relationship types
- `POST /relationshiptypes/query`: query relationships by elementId(s)
- `GET /objects?typeId=&includeMetadata=`: list object instances
- `POST /objects/list`: query objects by elementId(s)
- `POST /objects/related`: get related objects by relationship type

### Query (Values)
- `POST /objects/value`: get last known values (supports maxDepth)
- `POST /objects/history`: get historical values (startTime, endTime, maxDepth)

### Update (Write)
- `PUT /objects/{elementId}/value`: update current value
- `PUT /objects/{elementId}/history`: update historical values

### Subscribe (Real-time)
- `POST /subscriptions`: create subscription
- `GET /subscriptions`: list all subscriptions
- `GET /subscriptions/{id}`: get subscription details
- `DELETE /subscriptions/{id}`: delete subscription
- `POST /subscriptions/{id}/register`: register monitored items (elementIds, maxDepth)
- `POST /subscriptions/{id}/unregister`: remove monitored items
- `GET /subscriptions/{id}/stream`: SSE stream (QoS0)
- `POST /subscriptions/{id}/sync`: poll queued updates (QoS2)

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
- `start(callback)`, `stop()`: lifecycle with update callbacks

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

1. **Abstraction over implementation**: Unified interface regardless of backend
2. **Platform independence**: Works on OPC UA, MQTT, historians, cloud
3. **Separation of concerns**: Explore vs Query vs Update vs Subscribe
4. **Application portability**: Apps work across different platforms unchanged

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

### i3X 1.0 Only
The client speaks the i3X 1.0 release wire format and nothing else. Servers that implement an earlier spec generation (the Alpha `v0` API or the v1 Beta) are refused at connect time.

**Detection**: `verifyServer()` (in `src/api/client.ts`, run by `testConnection()`) probes `GET /info` and hands the result to `readInfoResponse()` in `src/api/normalize.ts`:
- `/info` OK, `result.specVersion` (or `version`/`apiVersion`) parses to ≥ 1.0 and `serverVersion` does not contain "beta" → connected; the capabilities matrix is kept (`getCapabilities()`)
- `/info` answers 401 or 403 → `AuthRequiredError` (the server never got to say what it is): "The server requires authentication (HTTP 401). Check the Authentication settings and try again." Shown as the connection error; no unsupported-server dialog
- anything else (any other non-2xx, an unreadable body, no recognisable version field, a version below 1.0, a beta `serverVersion`) → `UnsupportedServerError`, whose message says what was found: `This server does not implement i3X 1.0 (found: …). i3X Explorer 1.1 supports 1.0 servers only.`

`performConnect` (`services/connection.ts`) catches it, sets `connection.error` and `connection.unsupportedServer` (the `found` text), and the Toolbar shows the "Unsupported API Version" dialog. A hung or unreachable server is not "unsupported": a timeout surfaces as itself and any other network failure is the generic "Failed to connect".

**Wire format the client relies on:**

| Concern | 1.0 |
|---------|-----|
| Response envelope | `{success, result}` (unwrapped by `unwrapV1Envelope`) |
| Bulk results | `{success, results:[{elementId, success, result}]}` |
| Error body | `{responseDetail:{title,status,detail}}` |
| Subscription endpoints | `/subscriptions/register`, `/unregister`, `/sync`, `/stream`; `clientId` and `subscriptionId` in the body; `POST /subscriptions/delete` |
| Metadata extensions field | `schemaExtensions` |
| `/sync` partial response | HTTP 206 = queue overflow, logs warning |

The catalog cache tags every entry with `CATALOG_CACHE_FORMAT` (`'v1'`); an entry with any other tag (or none) was written by a build that spoke another format and `CatalogEngine.readCache` ignores it. Snapshot files written by earlier builds carry an `apiVersion` field; it is ignored on load and no longer written.

### Error Reporting (whole requests and per-element results)
The 1.0 spec allows a request to succeed while individual elements fail: each `BulkResultItem` is `{ success, elementId?, result?, responseDetail?: { title, status, detail } }`. Nothing a server reports as failed may be shown as empty.
- **Whole-request failures throw `HttpStatusError`** (`src/api/subscription.ts`, message `HTTP <status>: <detail>`): any non-2xx response, and a 2xx non-bulk `{ success: false }` body (`isFailedEnvelope`), typed by its `responseDetail.status`. A failed body without a status throws a plain `Error`. `requestEnvelope` (register/unregister) bypasses this and reads the envelope itself through `bulkOutcome`
- **Single-element reads** (`getValue`, `getHistory`, `getObject`, `getRelatedObjects`) go through `singleBulkResult` (`normalize.ts`), which throws the element's `responseDetail`. It accepts a lone result with a null `elementId`, since the spec allows it
- **Multi-element reads return failures beside results**: `getObjectDetails` → `{ objects, failures }`, `getRelatedObjectsBatch` → `{ related, failures }` (failed ids are absent from `related`), `getRelatedObjectsByType` → `{ entries, failures }`. Every requested id is accounted for: a lone result with a null `elementId` answers a lone requested id (as in `singleBulkResult`); otherwise an id the server never answered fails with the reason of a failed item that carried no `elementId`, else the top-level envelope's `responseDetail` (a `{ success: false, results: [] }` body), else "Not returned by the server". `getRelatedObjectsByType` requests no ids, so a failed page with no results throws the envelope's error
- **Where they surface**: the Current Value card and History tab show the thrown message; the Relationships and Subtree tabs show `RelatedFailuresNotice` (`graph/RelatedFailuresNotice.tsx`, fed by `EgoGraph.failures`), which lists each element and reason while the walk still draws it as a leaf; the tree shows marker rows (see Tree Refresh)
- **The SSE stream** treats a 2xx JSON reply as the server's answer, not a dropped connection: a failure with status 404/410 (or a fail-fast status) recovers like the real status, other statuses retry, and a non-failure JSON body or a failure without a status fails fast to `onError`

### SSE vs Polling
- **SSE (QoS0)** is the default, real-time streaming via `GET /subscriptions/{id}/stream`
- **Polling (QoS2)** available as fallback, uses `POST /subscriptions/{id}/sync`
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

For server-side reference only, if building a web-based client, configure CORS in **either** the reverse proxy (nginx) **or** the application (FastAPI), **not both**. Duplicate headers cause browsers to reject responses.

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
- Expanding relationship-type and compositional-object rows fetches their children from the server. Object-type rows do too only until the full catalog is loaded; after that they read `catalogObjectsByType` (built with the other catalog indexes) and expanding or polling one refreshes the catalog off the main thread instead, because a per-type `GET /objects?typeId=` list of 250k objects took ~5 s to parse on the main thread every poll.
- Hierarchy nodes (`hier:` prefix) do **not** fetch on expand: their children come from the store's `childrenByParent` index. Connect, search, and folder expansion all use `ensureAllObjectsLoaded`, which owns the single client-scoped in-flight catalog load. If the initial load has not started or failed, opening either folder loads/retries it; an in-progress prefetch is shared without consulting the generic `isLoading` flag. Freshness comes from the background poll while either folder is open and from the manual Refresh now action; both force a fresh `refreshAllObjects` (unforced calls skip a fetch within `ALL_OBJECTS_REFETCH_TTL_MS`).
- A 30-second background poll refreshes all currently-expanded branches while connected (controlled by `BACKGROUND_POLL_ENABLED` in `TreeView.tsx`)
- **Failed lookups show as marker rows, from two separate error maps** in the explorer store, because two different `/objects/related` lookups feed the tree. `compositionErrors` holds the `HasComponent` children lookup that `obj:` rows use (`resolveCompositionFlags`, expanding a composition row, the poll); an expanded row shows "(failed to load children: …)", and only composition objects read it. `relationshipErrors` holds the all-relationships lookup that `hier:` rows use (`resolveRelationshipGroups`); an expanded row shows "(failed to load relationships: …)". A failed element keeps its chevron and stays unresolved, but the visible-window resolvers skip it, so scrolling never re-requests it (a whole batch that throws records every element in it). Expanding the row retries it (`fetchChildrenFor`, with the row's spinner), and the forced poll retries expanded ones; any success clears the entry. A relationship type whose sources partly failed shows "(failed to load X: … (+N more))" above the sources that loaded
- **Hierarchy roots go through the engine too.** The server's `root=true` list decides the Hierarchy folder's roots, and every load of it (connect prefetch, folder expand, poll, search) is `loadHierarchicalRoots` in `services/catalog.ts`: one in-flight load per client, the body parsed by the engine (`roots`) and installed as skeletons that reuse the catalog's instances (or the previous roots'), so an unchanged refresh leaves `hierarchicalRoots` as-is and `setHierarchicalRoots` compares by identity. The main thread used to parse the ~13 MB body (5,653 roots with metadata), then JSON-stringify both root arrays to compare them, then ask `/objects/related` for every composition root: about a second blocked on the first Hierarchy click. Roots are never composition-resolved: Hierarchy rows read `childrenByParent`, not `compositionCache`.
- **The full catalog runs through the catalog data layer (`src/data/`).** `client.getObjectCatalogBytes()` downloads the `/objects` body **without metadata** (`includeMetadata=false`: on a server with per-object provenance the metadata body was 568 MB against 60 MB), and `services/catalog.ts` transfers it (zero-copy) to the `CatalogEngine` in `data/catalogEngine.worker.ts`, reached through Comlink (`data/catalogData.ts` falls back to an in-process engine when the worker can't start). The engine fingerprints the bytes, parses, normalizes, gives each object its type's namespace (a typeId → namespaceUri map from `GET /objecttypes`, since no `metadata.typeNamespaceUri` is listed), and keeps the objects for the insights. It returns only a **light columnar skeleton** (`data/catalogColumns.ts`: typed arrays plus one flat deduplicated string), and `installCatalogColumns` (`data/catalogInstaller.ts`) materializes that in ~8 ms slices that yield to the browser, building the indexes as it goes, then writes the store once. Measured at 223k objects: about 5 s of parsing in the worker, and a 0.6 s install on the main thread whose longest slice is ~25 ms. **Unchanged bytes** return no columns, so nothing is installed. Better still, a refresh revalidates with `If-None-Match` (the ETag of the last ingested body, sent only while store and engine both hold it), so an unchanged server answers `304` and nothing is downloaded at all. **Changed bytes** reuse every unchanged skeleton instance (identity preserved), and a change only to heavy fields keeps every store collection as-is. Store objects are therefore skeletons (`isCatalogSkeleton`): `metadata`, `relationships`, `description` and `schemaExtensions` are fetched from the server when a feature needs them (`fullObjects(ids)`: `POST /objects/list` with metadata, 500 ids a request). `useObjectDetails` (detail view), `catalogValueJson` / `catalogObjectsJson` / `catalogSubtreeJson` (copy menus), `catalogSnapshotBlob` (snapshots), and `catalogMetadataKeyer` (the diff's metadata compare) all fetch that way; the last two fetch the whole catalog's metadata, so they are slow on a heavy server but never run on a refresh. A store written through `setAllObjects` already holds full objects and is used directly. **Cache-first connect**: with the persisted `catalogCacheEnabled` preference on, the engine stores the last columns per server URL in IndexedDB (`data/catalogCache.ts`, `idb-keyval`; light fields only, never credentials). A reconnect installs them before the network body arrives, and the status bar says "cached, refreshing…" until the server copy lands. Settings has the toggle and *Clear cached catalogs*. `objectTypes` is indexed into `typeIndex` (shared by every node for icon bucketing). Tree rows use narrow store selectors so a single row's select doesn't re-render the whole tree.
- `I3XClient` coalesces concurrent identical read requests by method, canonical URL/query, canonical JSON body, and response processing mode. The in-flight entry is removed on completion or failure, so later refreshes still run. POST coalescing uses an explicit read-only endpoint allowlist; subscription mutations and `/sync` are not coalesced, and the separate long-lived SSE/polling transports remain independent.
- **Per-element reads go through a TanStack Query cache** (`data/queryClient.ts`, `data/queries.ts`): `useObjectValue` (detail view), `useObjectHistory` (History tab, fetched on Load and cached per element and range), and `useEgoGraph` (Relationships and Subtree walks, fresh for 60 s, previous drawing kept while a different walk loads). A revisited element renders its last result at once and revalidates in the background. Keys start with the server base URL, and `clearServerQueries` runs on connect and disconnect. Retries and refetch-on-focus are off.
- The tree is split into focused modules under `src/components/tree/`: `treeData.ts` (non-JSX shared logic, `buildTreeRows`, `resolveCompositionFlags`, `hasCompositionChildren`, `getObjectLabel`, `isScalarSchemaType`, folder-id/`MAX_TREE_DEPTH` constants), `TreeNode.tsx` (the row renderers: `TreeNode`, `TreeMoreNode`, `TreeRowIcon`), and `TreeView.tsx` (the shell: virtualizer, sticky header, keyboard navigation, background refresh). Full-catalog loading and refresh ownership lives in `src/services/catalog.ts`, shared by tree, search, and connection workflows.
- **The whole tree is one flattened, virtualized list.** `buildTreeRows` (pure, memoized) walks all three folders, Namespaces → types → objects, the flat Objects forest, and the Hierarchy parent/child walk, applying expansion, filtering (with ancestor keep-alive), per-parent paging, and cycle/depth guards in a single pass, and emits one ordered `TreeRow[]` where each row carries its `parentIndex`. `TreeView` windows that array with a single `@tanstack/react-virtual` virtualizer against the tree scroll container. Nothing renders recursively: a hierarchy node with 20k children costs the same DOM as one with 2. Rows render in normal flow with top/bottom spacer padding (not absolute positioning) so hover, selection, and count pills behave like plain DOM; row height is measured once from the first mounted row. Rows are exactly the panel width (no horizontal scroll, no width measurement): labels are `flex-1 min-w-0 truncate` with the full name in a `title` tooltip. Reveal-selected is pure index math (`scrollToIndex`), no DOM probing. Expansion state lives in the store, so expanded rows survive being scrolled out of the window.
- **Huge child lists are paged** (`CHILD_PAGE_SIZE` = 50 / `CHILD_PAGE_SLACK` = 10 in `stores/explorer.ts`, reveal state in `childPageLimits`): past 50 children (60 with the slack, since a "Show 6 more" row costs more attention than the 6 rows it hides) a parent emits a "Show 50 more · N hidden · show all" row instead of dumping everything. Virtualization makes rendering cheap regardless, the cap is for the *reader*, so one parent's 20k children don't bury its siblings. Collapsing a parent resets its paging. The flat Objects folder's top level is deliberately exempt. **The selection path is also paging-exempt**: `buildTreeRows` takes `selectedId` and force-emits any paged-out row on the path to it (after the "Show more" row), so reveal-from-search and Back/Forward always find the selected row even at position 1,200 of a paged list.
- **The "Show more" row has its own right-click menu** (`treeMenu.tsx`, `row.kind === 'more'`): show one more page, "Show a specific number…", or show all children. The custom count opens `common/NumberPromptDialog` rather than `window.prompt`, which Electron's renderer does not implement; `TreeView` owns that dialog state and passes a `promptForChildCount` callback into `buildTreeMenu`, because menus are built as plain data and can't render UI themselves.
- **Sticky ancestor header** (in `TreeView.tsx`): while scrolled deep inside one parent's children, up to `MAX_STICKY_ROWS` nearest ancestors stay pinned at the top of the viewport (computed from `parentIndex` chains with a small fixed-point iteration so the header accounts for its own height). Clicking a pinned row jumps back so the target lands just below the remaining pinned rows. The overlay is positioned outside the scroll content, above the windowed rows.
- **Composition chevrons resolve lazily for the visible window.** `hasCompositionChildren` shows a chevron optimistically for any unresolved `isComposition` object; `TreeView` then resolves the real qualifying-child count for the `obj:` rows currently in view (small debounced `resolveCompositionFlags` batch), so a composition object whose components are all leaves loses its (dead) chevron without the user clicking. The whole catalog is never resolved in one batch (that batch is slow/unreliable at 58k and left chevrons wrong). Expanding an object also writes its real child count back to the cache, so a click self-corrects the chevron as a backstop.
- **Tree icons are SVGs** from `src/components/common/icons.tsx`: distinct shapes for the three root folders (layers / grid / org-tree), globe = namespace (blue), document = object type (green), folder = FolderType (amber), cube = branch object (slate), activity trace = scalar "variable" leaf (violet, `--i3x-violet`). The leaf test is the shared `isScalarSchemaType` (schema.type scalar per the Implementation Guide), also used by the search modal so both surfaces always agree.
- **Keyboard navigation** lives in `TreeView.handleKeyDown` (roving focus on the container via `aria-activedescendant`, `focusedIndex` state, `tree-row-{index}` DOM ids). Mouse and keyboard share one activation path: `activateRow` / `expandRow` / `loadChildrenFor` in `treeData.ts` hold the select/toggle/fetch behavior, so a click and Enter are literally the same code. Type-ahead scans labels wrapping from the focused row (`findTypeAhead`).
- **Filter is index-backed and deferred**: the index builder (`createObjectIndexBuilder`, used by the catalog installer and `setAllObjects`) builds `searchIndex` (elementId → lowercased `name id namespaceUri` blob) so per-keystroke matching is one `.includes()` per object instead of three `toLowerCase()` calls; objects fetched outside `allObjects` fall back inline. `TreeView` filters on `useDeferredValue(searchQuery)` so the input stays responsive while the rebuild lags a frame behind. Folder rows carry `filtered: true` while a filter is active and show match counts (accent-colored pills).
- **Indent guides** (`IndentGuides` in `TreeNode.tsx`) are absolutely-positioned 1px columns over each row's left padding, so they connect across rows; the guide under the selected node is accented for its descendants (`activeGuideFor` walks `parentIndex` chains of mounted rows only). **Expansion animation**: `TreeView` tracks the most recently expanded node id; its direct children get `.tree-row-enter` (staggered, 400ms window), scroll-driven mounts never animate, and reduced-motion disables it.
- **Context menu**: `common/ContextMenu.tsx` is the generic panel (fixed-position, viewport-clamped after an invisible measuring frame, arrow/Enter/Esc keyboard support, takes focus while open and the tree refocuses on close); `tree/treeMenu.tsx` builds the entries per row kind. Counts in item labels are surveyed at open time (iterative `surveySubtree` walk), but heavy payloads, nested subtree JSON, are built only when the action is clicked. Tab deep-links are `selectItem(item, tab)`, the tab is part of the history stop, so Back lands right back on it. Bulk expand ("Expand all") is Hierarchy-only by design, composition nodes fetch children per expand, and bulk-expanding them would fire a request storm. The menu closes on tree scroll (rows shift under it).

### Render Performance Tracing (`src/diagnostics/`)
Opt-in, for finding what blocks the UI. Turn it on from Settings ("Trace render performance", persisted), with `?perf` in the URL, or `__i3xPerf.enable()` in the console. While on, every long animation frame that blocked input is logged as a collapsed `[perf]` group: the scripts the browser blames (LoAF attribution, falling back to `longtask` where LoAF is missing), the named spans that ran inside it, and the React commits that landed in it. `__i3xPerf.report()` tables everything recorded, aggregated by name; spans and commits also appear as `i3x …` User Timing measures in the DevTools Performance panel.
- `traceSpan(name, work)` times synchronous work and is free while tracing is off. Spans wrap tree row building, response parsing (`parse METHOD /path`), the insights report, and both graph layouts; add one around any new heavy computation
- `PerfProfiler` (a React `<Profiler>`) wraps the Toolbar, Sidebar, MainPanel, Subscriptions drawer and StatusBar, and inside MainPanel each view (Home, Insights, Diff, Object detail) and each detail tab, so a slow commit names the part that rendered. React only reports commits in development builds, where StrictMode also runs every render and memo twice (so a span listed twice in one frame is one real computation)
- **Virtualizer options must be stable.** `@tanstack/virtual-core` re-measures every row whenever `getItemKey` changes identity, so an inline key function made every Sidebar render O(rows): 223k with the Objects folder open. `TreeView` and `WindowedList` memoize it (and `TreeView` calls `measure()` when the measured row height changes, since the estimate alone doesn't invalidate)
- A frame with long time but no attributed script and no span is usually garbage collection after a large body; the cure is not allocating it on the main thread

### Theme System
- Colors are defined as CSS custom properties (space-separated RGB channels) in `src/styles/index.css`
- Light theme is the default (`:root`); dark theme activates via `@media (prefers-color-scheme: dark)` or `[data-theme="dark"]` on `<html>`
- The toolbar sun/moon button sets `document.documentElement.dataset.theme` and persists the choice to `localStorage`
- Tailwind tokens use `rgb(var(--i3x-...) / <alpha-value>)` format so opacity modifiers (`/20`, `/50`) continue to work
- SVG chart components (TrendView, HistoryTab, RelationshipGraph, ModelOverview) use `rgb(var(--i3x-...))` strings rather than raw hex

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

### Model Overview (`src/components/main/ModelOverview.tsx` + `modelStats.ts`)
**There is deliberately no whole-model graph.** The Home shell used to draw one (force-directed SVG, then a GPU/cosmos.gl variant). At the scale this app browses, catalogs of tens of thousands of objects, a node-link map of everything is a hairball: it looks like structure but you cannot read one actionable fact off it. Both were removed, along with the `@cosmos.gl/graph` dependency. A graph earns its place only when it is *rooted* somewhere and *bounded* by depth, which is what the Relationships tab does.

The overview is statistical instead, and derived **entirely from the store, no requests, no caps, no sampling** (100k objects computes in ~70ms).

**Every row is a way IN.** At 100k objects the counts alone are wallpaper, "100,000 objects" tells you nothing you can act on. So the panel is built to be a launchpad, and nothing on it is a dead end:
- **Largest containers**, the objects holding the most direct children. On a big model this is where the structure actually is; click one to open it. This, not the tree, is where you start
- **Entry points**, the roots, clickable. A model with thousands of roots is *flat*, not hierarchical, which you want to know before hunting for a tree that isn't there
- **Objects by type**, each bar opens that type (`selectType` in `navigation.ts`)
- **Worth knowing**, a warning strip that renders *only when something is wrong* (orphans / untyped objects). A permanent "0 issues" panel trains people to ignore the space it occupies. **Declared types with no instances are deliberately not in this strip**: in I3X a namespace is a type library, so publishing a profile the server doesn't fully instantiate is normal and correct, and it was routinely the biggest number in a strip that means "something is wrong". The list is still browsable, on the Model Insights page, filed as information

Implementation notes:
- `modelStats.ts` is pure (`computeModelStats(objects, objectTypes, namespaceCount)`). `topBy()` does a **partial selection** for the top-8 lists, sorting a 100k array to read eight rows is O(n log n) for nothing
- **A root is an object you cannot navigate UP from**: no `parentId`, *or* a `parentId` naming something outside the catalog (an orphan). Counting only the former would contradict the depth histogram, which has to place orphans at level 0 for want of anywhere else to put them, the card would read "1 root" above a Root bar of 2. Orphans are still tallied separately and surfaced under *Worth knowing*
- `computeDepths` memoises each object's level and carries an in-progress set: some servers emit `parentId` cycles, which would otherwise spin forever
- **Everything here is `parentId`-derived**, because those are the only edges knowable without a per-object round trip. That caveat lives behind an `InfoHint`, not in body copy
- Charts follow the `dataviz` skill: **one hue for every bar** (a value-ramp on nominal categories would double-encode length as hue) and no colour-only encoding

### Model Insights (`src/components/main/insightsReport.ts` + `src/components/insights/`)
The model's structure implies norms nobody wrote down: if 96% of Pump instances contain a VibrationSensor child, that *is* the site's modeling convention. The first cut of this idea (a Home card listing norm-breakers as chips) failed against a real 25k-object catalog in two instructive ways: a bare outlier list is *lint, not insight* (eight chips all reading "Pump" explain nothing), and "+N more / weaker patterns not shown" were dead ends. Model Insights is the rebuild around what an engineer actually asks a single source of truth: where does this kind of data live, what does the model promise, what breaks the promise and *why*, and what can't be trusted.

- **One engine, one report, two surfaces.** `computeInsightsReport(objects, objectTypes)` is pure; `getInsightsReport(objects, objectTypes, namespaceCount)` wraps it in a one-slot memo keyed on the store arrays' reference identity and also runs `computeModelStats`, so the Home card, the stat row, and the full page all read one computation, the page rendering after the card is a cache hit, and their numbers can never disagree. Measured ~100ms over 100k objects (the perf test prints it; one shared `scanCatalog`, index, dedupe, depths, feeds both computations instead of each building its own, and pass 2 buckets each object's placement and name signature once for both the per-type stats and the catalog-wide base rates). Recomputes only when the catalog reference changes; the explorer store's `setNamespaces`/`setObjectTypes` skip content-identical writes so the 30s background poll doesn't invalidate it while you sit on Home or the insights page. **It runs off the main thread**: both surfaces read `useInsightsReport` (`data/useInsightsReport.ts`), which asks `catalogInsightsReport` (`data/catalogData.ts`) for it. When the engine holds the catalog on screen it computes there (`CatalogEngine.insights`, returning only `{ stats, report }`, about 0.1 MB at 223k objects) and the result primes the same memo; store-held full objects (`setAllObjects`) compute in-process. On a real 223k catalog this was 1.3 s blocking the main thread on every catalog change; it is ~2.7 s in the worker now and nothing on the main thread. The Home overview shows its skeleton until the first result, and later catalogs keep the previous result on screen until theirs is ready
- **Findings are classified, not just counted.** A norm needs `MIN_NORM_INSTANCES` (8) agreeing at `NORM_THRESHOLD` (90%). 100% coverage → a **Convention** (positive documentation, not silence, "Every Pump contains exactly 1 VibrationSensor", with cardinality prose when tight). Below 100%: if the exceptions are few → a **Deviation**; if they are a *population* (≥8, ≥5% of the type, ≥50% concentrated in one alternative placement) → a **Split**, rendered as a distribution, calling 710 concentrated objects "outliers" is a misread, and a split never double-reports as a deviation. Root / orphan / untyped-parent buckets never establish a norm but may appear as split populations (a split is descriptive, not normative)
- **A norm must also be informative (`MIN_NORM_LIFT` = 1.5).** "Do 90% agree?" is only half a test: if the model has one container type, "Every Pump sits under a Station" is true of everything and documents the catalog's shape rather than a rule about Pumps. Shipping without this check produced 51 flat, mostly-tautological conventions on a real catalog, which is how a findings list becomes wallpaper. So `normLift(typeCount, typeTotal, globalCount, globalTotal)` compares the type's coverage against the base rate over the **rest** of the catalog (its own instances excluded, or a dominant type sets its own baseline and never looks surprising) for all three families: placement against the catalog-wide tally of parent-type buckets, containment against how many objects anywhere hold a child of that type, naming against the catalog-wide tally of name signatures. `lift = coverage / baseRate`; **only notable norms (`lift >= MIN_NORM_LIFT`) produce Deviations and score anomalies**, since exceptions to an unremarkable pattern are not evidence of anything. Unremarkable norms are still emitted with `notable: false` (they are true) and the page folds them away rather than deleting them. A base rate of 0, or no comparison population at all, yields `lift = Infinity`: the gate fires only on positive evidence that a pattern is unremarkable. Conventions sort notable-first, then by lift
- **Summary tiles are disjoint or say they aren't.** `summary.conventions` counts notable norms only; `trivialConventions` counts the folded rest; `conventionsWithExceptions` is the exact overlap with `deviations` (every notable near-norm emits one of each) and the Conventions tile prints it. `dataQualityIssues` is orphans + untyped + duplicate ids; **unused types are their own `summary.unusedTypes` field and are not an issue** (see the Model Overview note above)
- **Deviations are ranked by `wilsonLower(conforming, total)`**, a Wilson 95% lower bound, so 990/1000 outranks 9/10, and **explained**: outlier groups carry where the members actually sit (their real parent type for placement norms, their subtree root for containment norms, cycle-safe memoized walks), so "19 sit elsewhere" reads "19 sit under Cell instead, all within Site A". Member lists are **never capped in the engine**; the UI windows them
- **Three norm families**: placement (`unusual-parent`), containment (`missing-child`, with per-child-type cardinality histograms, min/max/modal), and **naming** (`nameSignature` collapses letter runs→`A`, digit runs→`9`, keeps separators; "PMP-999"→"A-9"; a bare `A` matches any word and is suppressed as uninformative). Per-object **anomaly scores** count independent norms broken (≥`MIN_ANOMALY_SCORE` ranks, top-`TOP_ANOMALIES` via `topBy`), each point a named reason. Every `AnomalyEntry` carries a `context` (where it sits) and the row also prints the elementId, because on a real catalog two rows rendered character for character identically, which is precisely the failure this list exists to fix
- **The page** (`src/components/insights/InsightsView.tsx`) is a third main-panel state with the diff view's exact lifecycle: both are **stops in the navigation history** (`activePage`, see Navigation history above), so navigating leaves the page, Back returns to it, and only one can be open at a time. Content survives closing (it lives in the report memo), so reopening is instant. Sections: summary tiles, the **type atlas** (the centerpiece, a windowed browsable inferred schema, NOT a node-link graph; stacked placement mini-bars are one hue with rank→opacity, labels in tooltips, never color-only), conventions (notable ones, plus a fold for the unremarkable), deviations (expandable, chips ≤8 else inner windowed lists, lazy copy-as-JSON via the shared `common/CopyJsonButton`), splits, the **data-quality hub** (orphans/untyped/duplicate ids as issues, unused types below the divider as information, all with fully browsable windowed lists; the Home *Worth knowing* strip stays as the quick signal), and most-anomalous objects. All navigation goes through `useElementNavigation`
- **A tile does more than scroll.** Each section is a focusable jump target (`tabIndex={-1}`); a tile scrolls to it, moves keyboard focus into it so the next Tab lands inside, and flashes a ring for `FLASH_MS`. The previous version's only behaviour was `scrollIntoView` on a page that barely overflowed, which is a control styled like a KPI that visibly does nothing
- **`insights/WindowedList.tsx` has a height contract, and it once shipped broken.** Every call site bounds the list with `max-h-*` only, so the container takes its height from its content. `@tanstack/virtual-core` bails when the scroll container measures zero (`calculateRange`: `outerSize === 0` → `range = null`), an empty range renders no rows, no rows means zero content height, and the container stays at zero: a stable fixed point that the ResizeObserver never breaks because nothing ever changes size. Four of the six sections drew nothing on every catalog from the day the feature shipped. **The fix is `minHeight: getTotalSize()` on the inner spacer**, the full virtual height, which is derived from the size estimates and does not depend on the range; the container then measures `min(max-height, virtual height)` on the first layout and the range resolves. Do **not** "fix" a recurrence by swapping `max-h-*` for a fixed `h-*`: the max-height bound is what lets a three-item list shrink to fit instead of drawing a 32rem empty box. `WindowedList.test.tsx` and `InsightsView.test.tsx` are the guards (jsdom, see Tests above); both fail against the pre-fix component
- **The Home card** (`ModelInsightsCard`) is a summary and a door: health line, top-3 strongest deviations as one-liners, "Open model insights". It renders whenever a catalog is loaded, a deliberate departure from render-only-when-broken, because the atlas is positive content and this is its only entry point. No chips, no dead ends
- Everything derives **from the store only**, `parentId` links and display names, no requests, no sampling, no ML; the methodology (and that limit) lives behind InfoHints on the page and card. Duplicate elementIds are last-wins (matching every other index in the app) and surfaced in the quality hub
- **Follow-up worth building, deliberately not built here: declared-schema conformance.** The app already holds `ObjectType.schema` (real JSON Schema from the server, `src/api/types.ts`) and this engine never reads it. Comparing declared against observed ("Pump declares `serialNumber`; 40% of instances don't carry it", "this instance's typeId isn't declared at all") is a strictly stronger claim than an inferred norm, because it checks the model against what the server itself promised rather than against its own habits. Also out of scope so far: value/quality/staleness analysis, and relationships other than `parentId`

### InfoHint (`src/components/main/InfoHint.tsx`)
The "?" marker next to anything that isn't self-explanatory: hover for a one-line tooltip, click for a dismissible popup with the full explanation (Esc / outside-click to close).

**Explanations do not go in body copy.** A paragraph under a chart is read once, by nobody, and it pushes the actual content down the page. Caveats, definitions and "how is this counted" go behind an `InfoHint` instead, used on Containment links, Entry points, Hierarchy shape, and each issue in the *Worth knowing* strip.

### Chevron (`src/components/common/Chevron.tsx`)
The **one** disclosure marker in the app. There used to be three, `›`/`⌄` in the tree (two different glyphs at two different optical baselines, so the mark visibly *jumped* when a node opened), a `▶` in the Overview tab, and a third in the relationships list. A drawn chevron **rotates** rather than swaps, so open/closed is one shape in two positions.

It is driven two ways, because the app toggles disclosures both ways:
- `<Chevron open={isOpen} />`: React state (tree rows, relationship groups)
- `<details className="group"><summary><Chevron /></summary>`, the browser, via `group-open:rotate-90` (Overview tab's Object Data)

`group-open:rotate-90` is inert outside a `group`, so one component serves both without a variant flag. Note the `<summary>` must stay `display:flex`, that is what suppresses the browser's own native marker triangle.

Breadcrumb and search-result path separators also use `›`, but those are separators, not disclosure markers, and are left alone.

### Relationships Tab (one panel: list + depth-N tree)
The list and the tree share a single card, laid out like a Fusion 360 workspace: the browser list on the left, the tree (the depth-N walk) on the right. The tab spans the full window width; the other detail tabs stay capped at 960px.

**One walk, two surfaces.** The list used to fetch its own single `/objects/related` while each canvas walked to the chosen depth, so raising the depth grew the drawing and left the list stranded at one hop. `useEgoGraph(root, depth)` now owns the walk in `RelationshipsTab`, and both panes render what it returns, one round trip per hop for the whole tab, and no way for the two to disagree, because there is only one walk to disagree about. `SubtreeTab` uses the same hook with `descendantsOnly`. The canvases take `graph` / `isLoading` / `error` as props and no longer fetch; `depth` survives on them only to describe the drawing in its accessible label.

**Two views, toggled.** The same ego graph is drawn either as a left-to-right tree (default) or the radial rings map. A `Tree / Rings` `SegmentedControl` in the header sets `relationshipView` in the store (persists across selections). The split is by file: `TreeGraph.tsx` + `treeLayout.ts` and `RadialGraph.tsx` + `radialLayout.ts` are each self-contained (own pan/zoom, hover, drop); `RelationshipGraph.tsx` is a thin switcher that renders one based on the store, and `dragType.ts` holds the shared `ELEMENT_DRAG_TYPE` so nothing imports across the two. Toggling remounts the chosen view; the walk itself lives above them, so switching views no longer re-fetches it.

**Why the tree is the default.** The tree labels every node on its own row with no zooming required, the drawing grows to fit, so a 100-node depth-2 walk is a tall, scrollable, readable tree. The rings view is **semantic-zoom**: ring radii are fixed and compact (rings = hops; geometry never depends on content or label text), while dots, labels and strokes render at constant *screen* size (calibrated to the measured pane via ResizeObserver, so 11px text is really 11px) and labels are culled by each node's weighted angular slot (`slot` on `radialLayout.ts` nodes), hubs own wide slots and label first, zooming in reveals the rest, and each ring's caption carries its per-hop count ("1 hop · 1,240"). The zoom ceiling adapts to the densest slot (MAX_SCALE is the floor, not a cap), so any crowd can separate and label at some zoom; hover targets shrink to their node's slot on crowded rings so hover picks the nearest node. Dense edge fans get reduced opacity. **The DOM is bounded by the pane, not the walk**: only the root, the hovered node, and labeled (or focus-lit) nodes inside the viewport plus `CULL_MARGIN_PX` are interactive elements; every other node is a zero-length round-capped stroke in a shared per-style path (`vector-effect: non-scaling-stroke`, so zooming never rebuilds them), and edges are one path per bucket/opacity. Dots have no handlers, so the svg's `pointermove` picks the node whose hover target covers the cursor (`hitRadius`), which promotes it to a full element. `RadialGraph.test.tsx` guards this. That keeps the fitted view a readable overview at any fan-out, but reading *every* name still takes zooming, so rings stay the secondary view, a compact spatial sense of where things sit.

- **`egoGraph.ts`** is the data layer. `expandEgoGraph()` walks BFS from a root over `POST /objects/related` (no type filter, so all relationship kinds come back). One round trip per hop: the client takes a whole frontier via `getRelatedObjectsBatch`. There are **no node or fan-out caps**: the walk renders everything reachable within the chosen depth. Depth is the only bound, so a deep custom walk on a dense model can be heavy
- **The walk only ever descends past the root.** The root fans out to all its direct relationships (parent, children, other links), but level 2+ follows **downstream edges only**, the parent shown one level up is never expanded, so there are no grandparents and no siblings. It's a `parent → self → children → grandchildren → …` view; to go further up, root the map on the parent and drill down. Both views (tree and radial) share this walk, so both obey it. What counts as downstream depends on the **Hierarchy / + References** toggle in the tab header (`relationshipTraversal` in the store, default `'hierarchy'`): `'hierarchy'` descends through composition/child edges only (`bucket === 'child'`, the I3X `maxDepth` meaning of depth), while `'references'` also follows lateral `'other'` edges (custom `Has*` relationship types) downward, so context modeled on graph edges deepens with the depth control. Neither mode ever walks back **up** (`parent`/`inherits`) — direction, not a name allowlist, is what keeps a deep reference walk from exploding sideways. The Subtree tab is always `'hierarchy'`
- `directNeighbors()` unions the server's related objects with the compositional parent/children **already in the store**, because servers differ in what `/objects/related` reports. The API entry wins on conflict: it carries the true `sourceRelationship`, where the store can only infer `HasParent`/`HasComponent` from `parentId`. Both the list and the walk go through it, so they can never disagree
- **`egoTree.ts`** (pure, tested) turns the walk's flat node/edge arrays into the BFS tree they already imply, every node carries the `via` it was reached from, sorted the way the list reads (parent, children, inherits, other; alphabetical within a bucket, via the shared `BUCKET_ORDER` in `relationshipColors.ts`) and counted, so a collapsed row can say how many objects are inside it. Only level 1 groups by relationship type: past the root the walk follows child edges only, so a group header further down would say nothing. It also holds `planAutoExpand` (the row budget) and `filterEgoTree` (search with ancestor keep-alive)
- **`RelationshipList.tsx`** renders that tree, and **containment is the whole design problem**. A nested list that expands freely is worse than the flat one it replaced: a single container with 2,000 children pushes everything after it off the panel, and the nesting meant to show structure hides it. Three independent limits: **`planAutoExpand`** opens rows breadth-first until `AUTO_EXPAND_ROWS` (200) is spent, so a small model opens fully and matches the map 1:1 while a hub opens its top and leaves the rest behind counts (a branch too big to fit is *skipped*, not a full stop, so one giant node can't close the whole level); **`PAGE_SIZE`** (50) rows per level with a `Show N more` below the block; and each block past `MAX_BLOCK_ROWS` (8) scrolls inside a capped container whose bottom dissolves under a `mask-image` gradient, the mask lifts once you scroll to the end, since a permanently half-faded last row reads as a rendering bug. Manual open/collapse overrides the budget and is never undone by it; a new walk resets both, since the old plan described a shape that no longer exists. Every row at every depth keeps drag-to-re-root, the focus button, the right-click menu and hover-spotlight
- **Three things you can do with a row, kept visibly separate because they cost wildly different amounts.** *Focus* (the frame button, `onFocus`) is a pure view request: the map frames that node with its children and lights the branch, nothing is fetched, re-rooted or selected. *Root the map here* (drag the row onto the canvas, or the menu item) re-walks from that element and redraws both panes, one round trip per hop. *Open* (click the name) navigates away. Conflating focus with re-root was the original bug: the ◎ button re-fetched and redrew the whole picture when all that was wanted was a closer look at part of it
- **Right-click menu on every row and group header** (`relationshipMenu.tsx` builds the entries, `RelationshipList` owns the `ContextMenu`, Shift+F10 / Menu key also open it and focus returns to the row on close). Rows: Open / Open Relationships / Open Subtree / Open History (tab deep-links, so Back returns to that tab), Focus on map, Root the map here, Expand / Collapse, **Expand all below** (breadth-first, capped at `EXPAND_BELOW_CAP` = 500 branches so a hub can't mount its whole subtree into a 340px column), Collapse all below, Show all children (only while the block is on screen), and Copy name / element ID / type ID / object JSON / **branch JSON** (the branch *as drawn*, so it is bounded by the depth the map is set to). Group headers: expand/collapse every row, show all rows, copy element IDs / objects JSON / branches JSON. Same discipline as the tree menu, counts surveyed at open time, payloads built only when an action is clicked
- **Edges are deduped by pair + relationship *family*** (`edgeKey`). `HasComponent(A→B)` and `ComponentOf(B→A)` are one physical edge seen from both ends; without the collapse, every hierarchy edge gets drawn twice in two different colors once the walk reaches its far end. The survivor is the one discovered from the shallower node, so an edge always reads outward from the root
- **`treeLayout.ts`** is pure and deterministic. It lays the BFS tree (each node's `via` is its parent) left-to-right. The column (x) is the **generation**, not the hop count: a node's column is its parent's ± 1 by the *direction* of the edge it was reached through, `egoGraph` records that on each node as `viaBucket`, and a `'parent'` edge steps left (upstream), everything else steps right (downstream). So parents land in columns before their children instead of sharing a hop column. A leaf takes the next row (`ROW_HEIGHT`); a node centres on its **downstream** children so it lines up with them rather than an upstream parent. Recursion is bounded by depth (≤ `MAX_RELATIONSHIP_DEPTH`). It returns node/edge positions, the `columns` present (for the guides), and the content bbox. Cross-links (non-tree edges) are flagged `tree:false` and drawn as dashed curves; tree edges are solid-ish S-curves in the bucket color
- **`TreeGraph` fits the whole tree on load.** It builds the `viewBox` from the tree's bounding box so every node is visible top-to-bottom, centred, at any depth (a `MIN_VIEW` floor keeps a tiny tree from being blown up; there's no maximum, so a tall tree shrinks to fit rather than being clipped, zoom/pan to read it). Labels and nodes are in diagram units and scale with the map; because each node owns a row, they never collide at any scale. Long names clip to `MAX_LABEL_CHARS`; the hover card carries the full name
- **`TreeGraph` stays responsive at thousands of nodes** (a deep Subtree walk). The DOM cost is bounded by what's on screen, not by the walk: interactive nodes (`GraphNode`, memoized) are **viewport-culled** to the visible rect plus `CULL_MARGIN`; edges are drawn as a handful of **grouped `<path>`s** (one per bucket/tree/opacity), culled the same way; and when a label would render below `MIN_READABLE_LABEL_PX` the map switches to an **overview**: every node becomes a zero-length round-cap stroke in a per-colour path (non-scaling, so dots stay visible), only the root stays interactive, and a hint says how many objects there are and to zoom in. The zoom ceiling adapts (`MAX_PX_PER_UNIT / fit`), so a tall tree can always be zoomed to readable size. `TreeGraph.test.tsx` guards the overview and the small-tree path. The Rings view gets the equivalent treatment in its own geometry (see above)
- **Depth lives in the explorer store** (`relationshipDepth`, 1–10, default 1), not in the tab, since `MainPanel` re-keys the detail view per element. The picker (`DepthControl`, shared from `main/tabs/DepthControl.tsx`) shows a pill per hop from 1 up to `relationshipDepthShown` (also in the store, so revealed pills survive switching elements for the session), plus a "+" that reveals one deeper pill per click up to `MAX_RELATIONSHIP_DEPTH`
- **Subtree tab** (`main/tabs/SubtreeTab.tsx`, after History): the same `TreeGraph`, fed by `useEgoGraph(object, subtreeDepth, true)`, `descendantsOnly` makes `expandEgoGraph` follow child edges from the very first hop, the pure subtree beneath the element, no parent leaf and no side links. Full-panel (no list beside it), rooted on the selected element only. Depth is its own store field (`subtreeDepth`, default `DEFAULT_SUBTREE_DEPTH` = 3) so it doesn't fight the Relationships depth; the two pickers share `relationshipDepthShown`. `TreeGraph.onRootElement` is optional, the Subtree tab omits it (no drag source there), which disables the drop target entirely
- **The panel fills the detail area's height** and grows/shrinks with the window, down to a `min-h-[30rem]` floor (below that the detail area scrolls); the tree pane has a `min-w` floor too
- **Full screen** (`expandable` on `main/primitives.tsx`'s `Card`, used by Relationships and Subtree): the maximize button in the card header takes the panel over the whole window; the button again or Esc comes back. A map is only as readable as the space it has, and the detail area gives it about a third of a laptop screen. On Relationships the *whole* panel expands, list included, because the list is half the workspace (spotlight, focus, drag-to-root all need both panes). Implementation detail that matters: expanding is a **class swap on an always-rendered wrapper** (`display: contents` collapsed → `fixed inset-0` expanded), not a portal and not a conditional wrapper, so nothing remounts and the pan/zoom, the focused branch and the list's expansion survive both directions, which is the entire point of expanding mid-investigation. Esc is ignored while an input, a context menu or a dialog owns the key. `primitives.test.tsx` guards the no-remount contract
- **Hover a list row to spotlight its node on the tree** (`externalHoverId`): the tree highlights it exactly as a real hover does, and the active node gets a focus ring so it is easy to find. A real hover on the tree wins; a row whose node isn't drawn is ignored
- **Header search** (`RelationshipSearch.tsx`, next to the Tree/Rings toggle): one input, two jobs. The text is a live filter on the relationship list (rows match on name/elementId/typeId; a group whose *type* matches keeps all its rows; the count line switches to "X of Y match"). It is also a combobox over **every node in the walk** (derived from the shared `EgoTree` in the tab, not reported up from the list, at depth 3 what you're hunting for is usually further out than one hop); picking a suggestion spotlights that node (same `externalHoverId` channel, held until the text changes) and issues a `LocateRequest` (`locator.ts`, elementId + monotonic token + `scope`) that the active view answers by centring and zooming on the node. Each graph keeps a handled-token ref, so a request fires once, but late if the walk is still loading, and never against a re-rooted map (root change clears spotlight + request). A picked element that isn't drawn (e.g. the map is re-rooted elsewhere) is silently ignored, like `externalHoverId`
- **`LocateRequest.scope` is what "focus" rides on.** `'node'` (the search pick) centres on one node; `'subtree'` (the list's focus button) collects the branch with `descendantIds(nodes, id)` (pure, in `egoGraph.ts`, iterative and visited-guarded), frames its bounding box at `FOCUS_MARGIN` of the pane, and holds it: the graph keeps a `focusId`, dims everything outside the branch, gives the branch root a ring, and shows a `FocusBadge` naming it with a clear button (a focus that only dims looks like a rendering fault and hides its own exit). Both views implement it in their own geometry, the tree over columns/rows, the rings over an arc. A live hover outranks the focus while it lasts; Reset view and a root change clear it; a focus whose node is no longer drawn is dropped rather than dimming the map with nothing lit
- **Drag a row from the list onto the tree** to re-root it on that element *without navigating* (`onRootElement`): the detail view around it stays put, and **the list re-roots with it**, they share one walk, so the pane that shows the connections and the pane that draws them always describe the same element. "Back to <name>" in the header returns both. The drop payload is the `ELEMENT_DRAG_TYPE` MIME carrying an elementId, resolved against `objectIndex`; the menu's "Root the map here" does the same with the whole object in hand, and is the keyboard path. Clicking a tree node navigates (as on the overview map)
- **The loader shows for every walk, not just the first.** Both views gate the `I3xLoader` on `isLoading` alone, and the old drawing is **grayed right out underneath it** (`grayscale opacity-10` on the svg, not a scrim over it) so it reads as the stale thing it is instead of competing with the loader. Gating the loader on "no layout yet" meant a depth change re-walked, one round trip per hop, behind a picture that looked finished

### Main Content Panel (`MainPanel` → `HomeView` / `ObjectDetailView`)
- Four top-level states, read off the **current navigation stop** (`activePage` / `selectedItem` in the explorer store): page `diff` → `DiffView`; page `insights` → `InsightsView`; nothing selected → `HomeView` (the statistical `ModelOverview`); an object selected → `ObjectDetailView` (breadcrumb, title row, and the Overview · Relationships · History · Subtree tabs). Namespace/object-type selections reuse `SimpleDetailView`, the same header frame without tabs. The two full-panel pages are mutually exclusive for free, one `page` field can only name one of them
- **Navigation contract** (`src/components/main/navigation.ts`): `selectElement(elementId, tab?)` resolves the object from `allObjects` (store-only, never fetches), expands the ancestor path in one `setState`, then calls `selectItem`; `showHome()` is `selectItem(null)`. The panel never imports the tree, both sides share `selectItem`, so selection stays in sync. The toolbar's brand and Home button also call `selectItem(null)`, which is enough to leave a page too

#### Navigation history: every page is a stop (`stores/explorer.ts`)
A history entry is a **`NavEntry` = item + detail tab + page**, not a bare selection. The stack used to hold selections only, so Back restored *an element* but not the page you were on: leaving the Subtree tab of an object and coming back landed on Overview, and the Insights and diff pages weren't stops at all (any navigation closed them, and nothing could return to one). So:
- **A tab is a page.** `detailTab` lives in the store and mirrors `history[historyIndex]`; `ObjectDetailView` renders that tab and calls `setDetailTab`, which **pushes a stop**. Deep links (`selectItem(item, 'relationships')`, used by the tree menu) set the tab as they select, replacing the old one-shot `pendingDetailTab` field
- **A full-panel page is a page.** `openPage('insights' | 'diff')` / `closePage()` push stops carrying the selection underneath, so Back from an insights row returns to the insights page rather than skipping past it. `stores/insights.ts` is gone entirely (it held nothing but `viewOpen` plus close-on-navigation subscriptions, all of which this subsumes) and `stores/diff.ts` keeps only data, its `openView`/`closeView` delegate here
- **Re-selecting the element you're on keeps the tab you're reading** and pushes nothing, so a tree click or a poll refresh can't kick you back to Overview. Everything else, a different element, a different tab, opening or leaving a page, is a stop
- `pushEntry` / `gotoIndex` (module-level, not actions) are the only writers; both write `selectedItem`, `detailTab` and `activePage` from the entry, so the three can't drift from the stack. `MAX_HISTORY` = 50, and navigating after going back discards the forward entries, like a browser
- Deliberately **not** in a stop: the Relationships tab's re-rooted map and its depth. Both are explicitly "look at this without navigating", and depth is a session-level preference shared across elements
- **There is no Subscriptions tab.** Subscriptions are global state, not a property of the selected element, so they live in `SubscriptionsDrawer` above the status bar. Subscribing to an element opens the drawer
- `MainPanel` re-keys `ObjectDetailView` on `elementId` so per-element view state (active tab, loaded value, history range) doesn't bleed across selections
- **Breadcrumb** folds the middle of deep chains: `collapseCrumbs()` (exported, pure) keeps the outermost and nearest ancestor and hides the rest behind a "…" button that expands in place. A new selection re-collapses it
- **Identity card** shows exactly five fields (Element ID, Type ID, Parent ID, Namespace URI, Source Type ID) plus Composition/Extended flags. Source Type ID always renders, showing `-` when absent
- **Responsive**: the title row wraps its actions, the tab strip scrolls horizontally, action labels and the "Object Instance" kind collapse to icons/hide below `sm`, and the toolbar hides the app title, the Search label and the connect error as the window narrows. Status-bar segments drop out at `sm`/`md`

### Model Snapshots & Diff (`src/components/diff/` + `stores/diff.ts`)
The explorer's memory: capture the connected server's catalog as a file, load it back later as a **baseline**, and diff it against the live catalog (or a second snapshot). The diff answers the operational question *what changed*, deployment verification (snapshot before, diff after: the diff is the acceptance report), drift detection (disappearing objects and changed parents before dashboards break), and environment comparison (a snapshot from server A diffed while connected to server B, cross-server is legal and labeled, never blocked).

- **Capture fetches the catalog's metadata, nothing else.** A snapshot is the catalog the app shows, with each object's metadata fetched for it: `catalogSnapshotBlob` requests every object through `POST /objects/list` (the listing carries no metadata), then serializes and gzips, plus the store's `objectTypes` and `namespaces`. The catalog itself is not refreshed first; that is the user's choice, not a capture side effect. The toolbar camera menu is the whole surface: save, load baseline, view diff, compare against a second file, clear
- **`snapshot.ts`** (pure, tested) is the file format: a versioned JSON envelope, `formatVersion`, `appVersion`, `serverUrl`, `capturedAt`, counts, then the three collections. A `formatVersion` from the future is refused with a message naming both versions; unknown extra fields are tolerated; entries without an elementId are dropped and counted as a warning. Objects are stored in the client's **normalized `ObjectInstance` shape** (wire differences already flattened)
- **Files, not localStorage**, a 100k catalog is tens of MB of JSON and localStorage caps at ~5MB. Save is an anchor download, load is a file input: identical in Electron and the web build, zero IPC. Gzip via the native `CompressionStream`/`DecompressionStream` (~10× smaller, no dependency); `.i3xsnap.gz` is the default, plain `.json` is accepted, the sniff is the gzip magic bytes, not the file name
- **`diffEngine.ts`** (pure, tested) is `diffCatalogs(baseline, current)`: identity is **elementId, full stop**, in both catalogs = same object (fields compared), only in baseline = removed, only in current = added. One Map build plus one iteration per side, strictly linear; the live side reuses the explorer's prebuilt `objectIndex` instead of building a second map. Field changes are **independent categories** (`parentId` / `typeId` / `displayName` / `namespaceUri`), one object re-parented *and* re-typed appears in both lists, and the counts are labeled that way (an InfoHint says so). `''`, `'/'`, `null` and absent all normalize to "no parent" so servers that spell it differently don't fabricate re-parents. Duplicate elementIds within one side are last-wins and *counted*, surfaced in the banner
- **Metadata compare is opt-in** (`deepCompare`, the Fields / Fields+metadata toggle). It stable-stringifies `metadata`/`schemaExtensions`, but only for objects whose scalars all matched, so the `Metadata` category means "changed in metadata *only*", and objects already in the diff don't pay the stringify. Measured at 100k×2: **scalar 44ms, deep 193ms** (`diffEngine.perf.test.ts` prints the numbers every run). Deep fits the budget on a dev box but 4×'s the diff and scales with payload size, not object count, hence opt-in, with the cost stated in the toggle's InfoHint. The metadata pill is hidden entirely when deep compare hasn't run: a zero there would be a claim the diff never checked
- **The diff result copies nothing.** It holds elementIds and changed field pairs; rows resolve display data at render time through the live `objectIndex` (or the baseline's own map, for removed rows). A loaded baseline *is* a second full catalog in memory (~2× footprint), that's acceptable and said out loud in the summary InfoHint; Clear baseline releases it. `runDiff` defers one tick so the "Computing diff…" frame paints before the synchronous compute (~50–200ms at 100k; a worker would be machinery the numbers don't justify)
- **`topChangedSubtrees`** groups every diff entry under its root-level ancestor (`topBy` partial selection, not a full sort, reused from `modelStats`). Adds/changes walk the current catalog's parent chain, removals the baseline's; the walks are memoized and carry a visited set because some servers emit parentId cycles
- **State lives in its own Zustand store** (`stores/diff.ts`), never the explorer store, loading a baseline leaves the tree completely untouched. Whether the *view* is showing is not in that store at all: `DiffView` is a main-panel state alongside Home and element detail, opened as a **history stop** (`activePage`), so **any navigation leaves it** (a diff row click, tree click, search) and **Back returns to it**. The baseline + result stay loaded so the toolbar reopens it instantly. Row clicks go through `selectElement`, the same navigation contract as everything else; removed objects render from baseline data and are visibly non-navigable
- **Every category list is virtualized** (same `@tanstack/react-virtual` pattern as the tree: windowed rows, top/bottom spacer padding), a real diff can contain 50k added rows. Copy-category-as-JSON builds its payload only on click, like the tree menu's subtree JSON. An identical diff renders an explicit "No differences" state that says what was and wasn't compared
- **Follow-up, deliberately not built:** sidebar change-badges (decorating tree rows with added/removed markers). It touches every tree row's render path and deserves its own pass rather than a half-integration here

### Status Facets (`ElementStatus` / `ValueDisplay`)
- A code like `GoodNoData` conflates two orthogonal facets, so `parseStatusCode()` splits them: **quality** (the prefix → Good/Uncertain/Bad/unknown) is carried by COLOR; **data presence** (code doesn't match `/NoData/`) is carried by SHAPE, solid neutral dot vs hollow neutral ring
- `<StatusFacets code variant="labeled" | "compact" | "dot" />` is the single renderer: `labeled` in Current Value, `compact` in the Subscriptions Quality column, `dot` in the dense composition-component rows. Dots are `aria-hidden` with an `sr-only` sentence, since colour and shape carry the meaning
- **Parsed / Raw value toggle**: a segmented control in the Current Value card header (state `valueView` in `ObjectDetailView`). Raw renders `value.rawResponse` (the untouched HTTP body) via `JsonViewer`. `client.getValue` retains that body on `LastKnownValue.rawResponse`; the batch `getValues` does **not** (only the single-object detail pane needs it)
- **Component rows** (composition values): the elementId is middle-truncated with a two-span flex trick (head ellipsizes, last `COMPONENT_ID_TAIL` chars stay pinned); numeric values are rounded via `formatComponentValueShort` (`toPrecision(6)` → `Number()` to strip trailing zeros, keeps exponential form). Full id / full-precision value / full timestamp are all in `title` tooltips. Each row is a disclosure (`ComponentList`): click it to show the full elementId, timestamp and the value as a `JsonViewer` tree (JSON strings decoded, like the main Parsed view); the header has Expand all / Collapse all
- **Copy-to-clipboard**: `CopyButton` (`src/components/details/CopyButton.tsx`) is a floating corner icon embedded in `JsonViewer`, so every JSON pane gets it for free. Uses `navigator.clipboard`, `stopPropagation` (so it doesn't trigger the collapsed-view expand), and fails silently in insecure contexts

### Sidebar Collapse & Tree Label Truncation
- **Collapse**: `sidebarCollapsed` + `toggleSidebar()` live in the explorer store; the panel-toggle button is at the left of the `Toolbar`. `Sidebar` returns `null` when collapsed but stays mounted, so its drag-`width` state is preserved and restored on expand
- **No horizontal scroll**: the tree body scrolls vertically only (`overflow-x-hidden`); rows are exactly the panel width, labels truncate with an ellipsis (`flex-1 min-w-0 truncate`, full name in the `title` tooltip), so count pills and the copy action stay visible at the right edge at any sidebar width. Dragging the sidebar wider reveals more of each name. The filter input is a fixed header above the scroll body so it neither stretches nor scrolls away

### Subscription Transport
- `SubscriptionTransportProvider` (`src/components/subscriptions/SubscriptionTransport.tsx`) owns the SSE/polling refs and stays mounted for the life of the app, wrapping everything in `App.tsx`. The transport used to live inside the subscriptions panel, so collapsing that panel killed the stream. Now `SubscriptionsDrawer` is purely presentational: closing it hides the UI and the stream keeps running
- Consumers get `startStream` / `stopStream` / `deleteSubscription` / `usePolling` / `streamUnsupported` via `useSubscriptionTransport()`
- The provider reads the subscriptions store through `getState()` rather than hook selectors, subscribing would re-render the whole app on every live value

### Subscription Recovery
- `src/api/subscription.ts` exports `HttpStatusError` (carries `.status: number`) and `isSubscriptionGoneError(error)` helper
- HTTP 404/410 on the SSE stream calls `onError` directly instead of entering the reconnect loop, retrying a gone subscription always fails. A 2xx `{ success: false }` body carrying status 404/410 counts the same, on the stream and on `/sync` (see Error Reporting)
- The recovery logic lives in `src/components/subscriptions/recovery.ts` (`performRecovery`, unit-tested); `SubscriptionTransportProvider.handleRecovery` is a thin wrapper that supplies the transports and the shared `RecoveryHarness` ref
- `performRecovery` is re-entrancy-guarded, stops BOTH transports first (a still-running poller 404-ing was the concurrent-recovery source), captures monitored items before mutating the store, then delete → create → re-register → `startStream` in a bounded retry loop
- Capped at 3 attempts; the budget refunds on data delivery (`handleDataUpdate`) and on a successful recovery, but only when the previous success is >30s old, so a server that insta-expires each new subscription still converges to the cap instead of cycling forever
- SSE reconnects are cancellable: `SSESubscription` stores its reconnect timer and sets a `disposed` flag on `disconnect()`, so deleting a subscription can't leave a zombie timer that re-fetches (and re-recovers) it
- Polling uses a self-rescheduling `setTimeout` chain (never `setInterval`), so a sync slower than the interval can't stack concurrent requests
- Polling path errors from `client.sync()` use string-prefix matching as fallback (those errors come from `client.ts`, not `subscription.ts`)

### Subscribe Error Handling
- `ObjectDetailView.handleSubscribe` shows an inline error under the title row if `registerMonitoredItems` throws; the button is disabled and relabelled "Subscribing…" during the async call. On success it starts the stream (unless one is already live on the subscription, `startStream` is not idempotent) and opens the subscriptions drawer
- If a subscription was freshly created by `createSubscription` but `registerMonitoredItems` then fails, the new subscription is removed from the store and a best-effort `deleteSubscription` is fired to avoid leaving an empty orphan on the server
- The error message clears automatically when the user navigates to a different object

### Ignore Certificate Errors (Electron only)
- Checkbox in the connection dialog, hidden in web mode (`window.electronAPI` guard)
- Stored as `ignoreCertErrors: boolean` in the connection store (persisted to localStorage)
- On save: calls `window.electronAPI.setIgnoreCertErrors(flag)` → IPC send → module-level flag in `electron/main.ts`
- On app startup: `App.tsx` syncs the persisted value to the main process via the same IPC call so the setting survives restarts
- Main process registers `app.on('certificate-error', ...)` at startup; when the flag is set it calls `event.preventDefault(); callback(true)` to bypass the error

### Web Build
- Config: `vite.web.config.ts`, must use `base: './'` so all asset paths in `index.html` are document-relative, allowing deployment to any subdirectory path
- The `index.html` source uses relative (no leading `/`) hrefs for favicon and icons for the same reason
- Runtime server config: `src/main.tsx` fetches `./config.json` on startup; if no `localStorage` state exists yet, `serverUrl` and `recentUrls` from that file are applied as defaults
- On a git-synced server, put overrides in `config.local.json` at the repo root, `scripts/deploy-web.sh` copies it to `dist-web/config.json` after each build
- `scripts/deploy-web.sh` runs `git pull` then `npm ci` then `npm run build:web` then optionally reloads nginx; triggered by `sudo systemctl restart i3x-explorer-web`
- Live deployment: https://explorer.i3x.dev (nginx serving `dist-web/` from the cloned repo at `/home/cesmii/repos/i3X-Explorer`)

### SVG Tooltips in Electron
- Electron's Chromium suppresses native SVG `<title>` tooltips, they never appear
- Use a React state + HTML overlay approach instead: track `{ label, x, y }` state, set it on `onMouseEnter` of each SVG `<g>` node, update position on `onMouseMove` of the wrapper div, clear on `onMouseLeave`, render as an absolutely-positioned `<div>` with `pointerEvents: none`
