# i3X Explorer Project

## Overview

i3X Explorer is a cross-platform desktop application for browsing and monitoring I3X (Industrial Information Interface eXchange) API servers. Similar to MQTT Explorer but for the I3X protocol.

**Stack:** Electron + React + TypeScript + Vite + Tailwind CSS

## Project Structure

```
i3x-explorer/
├── electron/                # Electron main process
│   ├── main.ts             # App entry, window management
│   └── preload.ts          # Context bridge for IPC
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
./scripts/build-all.sh [mac|win|linux|all]

# Platform-specific builds
npm run build:all          # All
npm run build:mac          # macOS (Intel + Apple Silicon)
npm run build:mac:x64      # macOS Intel only
npm run build:mac:arm64    # macOS Apple Silicon only
npm run build:win          # Windows (x64 + x86 + portable)
npm run build:linux        # Linux (AppImage + tar.gz)
```

**Output:** `release/{version}/`

| Platform | Artifacts |
|----------|-----------|
| macOS | `.dmg`, `.zip` (x64 & arm64) |
| Windows | `.exe` installer, portable `.exe` |
| Linux | `.AppImage`, `.tar.gz` (x64 & arm64) |

### Icon Generation

The `scripts/generate-icons.sh` script generates platform-specific icons:
- Uses `build/icon-1024.png` as the source by default
- Generates `.ico` (Windows), `.icns` (macOS), and various `.png` sizes (Linux)
- Requires ImageMagick (`brew install imagemagick`)
- Run before building to ensure icons are up to date

## Features

- Connect to I3X servers (default: https://i3x.cesmii.net)
- Browse hierarchical tree: Namespaces → ObjectTypes → Objects
- Browse flat Objects list (lazy-loaded)
- Expand compositional objects to see children
- View object details, metadata, and current values
- Relationship graph visualization for non-compositional relationships
- Subscribe to objects for real-time updates (polling or SSE)
- Trend chart for numeric subscription values
- Search/filter tree nodes

## Key Resources

- **API Documentation**: https://i3x.cesmii.net/docs (OpenAPI spec at /openapi.json)
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
Configure CORS in **either** the reverse proxy (nginx) **or** the application (FastAPI), **not both**. Duplicate headers cause browsers to reject responses.

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

### Trend View
- Stores up to 60 data points per elementId
- Only displays for numeric values
- Updates in real-time during active subscriptions
