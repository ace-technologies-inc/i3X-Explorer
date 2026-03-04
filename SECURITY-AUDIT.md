# Security Audit — To Be Addressed for 1.0

Run `npm audit` on 2026-03-03. All 8 vulnerabilities require breaking version bumps — `npm audit fix` (non-breaking) resolves nothing.

## Vulnerabilities

| Package | Current | Safe Version | Severity | Context |
|---------|---------|-------------|----------|---------|
| `electron-builder` | ^24.9.1 | ^26.8.1 | **High** (tar CVEs) | Build tool only |
| `vite` | ^5.0.12 | ^7.3.1 | Moderate (esbuild dev server) | Dev only |
| `electron` | ^28.1.3 | ^35.7.5+ | Moderate (ASAR bypass) | Runtime |

### tar CVEs (via electron-builder)
- GHSA-r6q2-hw4h-h46w — Race condition via Unicode ligature collisions on macOS APFS
- GHSA-34x7-hfp2-rc4v — Arbitrary file creation/overwrite via hardlink path traversal
- GHSA-8qq5-rm4j-mr97 — Arbitrary file overwrite and symlink poisoning
- GHSA-83g3-92jg-28cx — Arbitrary file read/write via hardlink target escape through symlink chain

### esbuild dev server (via vite)
- GHSA-67mh-4wv8-2f99 — Any website can send requests to the dev server and read responses

### Electron ASAR integrity bypass
- GHSA-vmqv-hx8q-j7mg — ASAR integrity bypass via resource modification

## Fix Plan

### Phase 1 — `electron-builder` ^26.8.1 (Low Risk)
Build-tool only; doesn't affect runtime or dev experience.
- Update `electron-builder` to `^26.8.1`
- Run a test build to verify output
- Check `electron-builder.json` for any deprecated config options between v24 and v26

### Phase 2 — `vite` ^7.3.1 (Medium Risk)
Only affects the dev server. Related plugins will need compatible version bumps.
- Update `vite` to `^7.3.1`
- Update `@vitejs/plugin-react`, `vite-plugin-electron`, `vite-plugin-electron-renderer` to compatible versions
- Review `vite.config.ts` for API changes introduced in Vite 6 and 7

### Phase 3 — `electron` ^35.7.5 (High Risk)
Largest jump (v28 → v35+); most likely to require code changes.
- Target `^35.7.5` as the minimum safe version (npm suggests 40.x, but 35.7.5 is sufficient)
- Review the Electron changelog for deprecated/removed APIs between v28 and v35
- Test all IPC communication, the preload context bridge, and window management
- Verify `vite-plugin-electron` supports the target Electron version

## Severity Context

- The `tar` CVEs are **high** but only exploitable during builds (e.g., in a compromised CI environment)
- The esbuild dev server issue is **moderate** and only relevant when running `npm run dev` — not in production builds
- The Electron ASAR bypass is **moderate** and requires an attacker to already have local file access
