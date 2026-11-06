# Changelog

All notable changes to this project are documented in this file.

## [Unreleased] — 2026-11-06 final offline round

### Security and reliability
- Kept ChatGPT, Claude and Gemini forbidden across runtime policy, settings, IPC, uploads and UI, including attempts to override local policy.
- Confined the dashboard bridge to its exact local top-level frame; blocked external navigation and popups. Preserved sandboxing, context isolation, encrypted-only runtime vaults and all approval gates.
- Hardened URL/JSON/session redaction, metadata-only diagnostics, origin checks, staged file uploads and verified loopback Edge import. Removed page-body xray previews and raw discussion prompt/answer status logs.
- Added provider send/response deadlines, closed-view detection and readable UI failure states so healthy providers can continue. Released view/listener/timer resources; fixed Electron entry/import detection for login and vault utilities without running either live.
- Fixed quota analysis that always passed, retained sanitized probe error causes, retried only transient navigation-frame failures, and strengthened rejected-body privacy checks and offline failure reporting.

### Dependencies and responsiveness
- Updated `electron-builder` to `^26.18.1`; retained current Electron `^45.2.3`. Both GitHub Actions use their newest major (`checkout@v7`, `setup-node@v7`).
- Resolved the six moderate minimatch audit entries with range-specific `^11.0.5` overrides for vulnerable 9/10 callers. Corrected the inherited broad override, which left `npm ls` invalid; callable 3.x/5.x consumers retain patched compatible APIs. Clean `npm ci`, `npm ls` and Windows packaging pass.
- Replaced dashboard hot-path synchronous disk reads with batched async/coalesced loading; bounded trace retention and used turn notifications instead of transcript polling.
- Offline 1,200-file fixture, five alternating warm trials: median dashboard load **929.49 → 278.31 ms**, median maximum heartbeat gap **930.34 → 6.06 ms**, synchronous filesystem calls **1,229 → 0**. These are local fixture measurements, not live-provider latency claims.

### Verification
- `npm test`: **43/43**; offline endurance/modes/chaos, stress suite and all five orchestration benchmark scenarios pass. Both full and production `npm audit`: **0 vulnerabilities**.
- Real Electron **45.2.3** offline dashboard opened with **11 provider cards**, **0 console/preload/runtime errors**, **0 external requests**, and forbidden-roster rejection. A fresh isolated profile and normal Windows access were required for OS crypto/AppContainer startup; Electron sandbox settings stayed enabled.
- Windows NSIS build passes; installer remains unsigned. Live providers, login, real uploads/cookie import and external selectors remain unverified and were not run.
- Recorded all **321** fleet cluster decisions and raw evidence pointers in [the final review](docs/FINAL_ROUND_FLEET_REVIEW.md): **183 applied/resolved, 138 rejected**, including prior-run fixes. No commits, pushes or tags were made by this continuation.

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
