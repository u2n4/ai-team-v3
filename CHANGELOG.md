# Changelog

All notable changes to this project are documented in this file.

## [Unreleased] — 2026-11-05

### Changed
- Upgraded `electron` from `^42.3.0` to `^45.2.3` and `electron-builder` from `^26.8.1` to `^26.18.0`.
- Resolved all critical and high `npm audit` vulnerabilities via package updates (`1` critical and `13` high reduced to `0` critical and `0` high).
- Updated `src/core/dashboard-state.js` and `src/electron/renderer.js` to gracefully handle the absence of removed `FINAL_STATUS.md` and `coordination/*` files without `UNKNOWN` badges, errors, or empty/broken report rows.
- Updated `discoverV2SessionReferences` in `src/providers/provider-session-policy.js` to fall back to `config/provider-session-policy.json` when running as a standalone repository clone without a parent V2 directory.
- Refreshed `README.md`, `docs/INSTALL_AND_RUN.md`, and `docs/TROUBLESHOOTING.md` to document current requirements, offline verification, human-gated live flows, and what was not tested live after the refresh.

### Added
- Added `"test": "node tests/run-all.js"` script in `package.json`.
- Added `.github/workflows/ci.yml` running `npm ci` and offline tests across `ubuntu-latest` and `windows-latest` with live environment variables unset.
- Added `.github/dependabot.yml` for weekly `npm` and `github-actions` updates.
- Added `SECURITY.md`, `CHANGELOG.md`, and `LICENSE` (MIT).

## [0.1.0] — 2026-06-22

### Added
- Initial AI Team V3 multi-AI orchestrator with delta-only prompt context, per-provider character budgets, quota guard, and transcript firewall.
- Separate reasoning/thinking capture (`ReasoningStore`) distinct from public transcript answers (`TranscriptStore`).
- Hardened Electron runtime (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`) with per-provider `WebContentsView` partitions and two-signal live open gate.
- `safeStorage`-encrypted localStorage vault (`src/electron/localstorage-vault.js`), CDP network redaction monitor, file upload controller, and allowlist-only Edge cookie importer.
- 42 offline unit, integration, mode, chaos, and endurance test suites.
