# AI Team V3

AI Team V3 is an Electron desktop orchestrator that coordinates multi-AI discussions across web UIs using isolated `WebContentsView` partitions, a local `safeStorage`-encrypted session vault, a transcript firewall, per-provider prompt budgets, and fake-first offline safety gates.

## Requirements

- Node.js `>=22.12.0`
- npm (with Electron `45.2.3` and `electron-builder` `26.18.1`)

## Install

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm install
```

On Windows, if `npm install` ever skips extracting the Electron binary, `scripts/postinstall-electron.js` repairs it from the local `@electron/get` cache. You can also run the check manually:

```powershell
npm run fix:electron
```

## Run Offline Tests & Dashboard

Run the full 43-suite offline test harness (no live provider sessions or network calls):

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm test
# or:
npm run test:v3-all
```

Launch the local offline dashboard (does not contact or open any live provider on startup):

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run app
```

## Human-Gated Live Execution

Live provider sessions never start automatically:

- **Two-signal open gate:** Opening a live provider view from the app requires both explicit UI confirmation (`approval.confirmed === true`) and the environment variable `AI_TEAM_V3_CONFIRM_SAFE_SESSION=1`.
- **Forbidden providers:** `chatgpt`, `claude` and `gemini` are hard-blocked before any page or session can open (`BLOCKED_PROVIDER_FORBIDDEN`). Do not add or enable them, and do not import cookies for `chatgpt`, `claude`, or `gemini` / shared Google or Microsoft identity domains.
- **Selector Doctor (read-only DOM check, no prompt sent):**
  ```powershell
  Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
  npm run doctor:provider -- qwen
  ```
- **One-provider live smoke (human-gated to `qwen` or `kimi`):**
  ```powershell
  Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
  $env:AI_TEAM_V3_LIVE='1'
  $env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
  $env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
  npm run smoke:one-provider
  ```

## Verification Status (2026-11-06 Final Refresh)

- **Verified offline:** All 43 offline test suites (`npm test` / `npm run test:v3-all`) pass with Electron `45.2.3` and `electron-builder` `26.18.1`, covering core invariants, delta prompts, budget & quota guards, transcript firewall, redaction, vault encryption gates, IPC open gates, and dashboard state when legacy `FINAL_STATUS.md` / `coordination/*` files are absent.
- **Not tested live after this refresh:** Live provider sessions, `npm run login`, `npm run import:edge-cookies`, `npm run doctor:provider`, `npm run smoke:one-provider`, and live multi-AI webview discussions were intentionally not executed during this refresh. Live provider DOM selectors may drift as external web UIs change and must be re-verified with `doctor:provider` by a human operator before live use.

## Final offline refresh evidence

See [the finding-by-finding review](docs/FINAL_ROUND_FLEET_REVIEW.md). The real Electron 45 dashboard was launched with an isolated profile and external requests blocked. Windows NSIS packaging was verified; live providers were not exercised.

Offline checks also include `npm run validate:offline-real`, `npm run stress:suite`, `npm run benchmark:ui` and `npm run test:electron-offline`. The UI benchmark uses 1,200 synthetic trace files and writes raw trials under `.tmp/final-round/`.

## Architecture

- `src/core/` — Orchestrator, delta prompt builder, budget guard, quota guard, transcript firewall, reasoning store, redaction, and offline dashboard state.
- `src/providers/` — Fake provider and `WebviewProviderAdapter`, provider contracts, and session/partition policies.
- `src/electron/` — Hardened Electron main/preload/renderer, `WebContentsView` manager, CDP network redaction monitor, DOM capture, send verification, file upload controller, Edge cookie importer, and `safeStorage` localStorage vault.
- `tests/` — 43 offline unit and integration test suites.
- `docs/` — Architecture, installation, security, and troubleshooting documentation.

## License

[MIT](LICENSE)
