# AI Team V3 — Install And Run

**Status:** Offline test suites and dashboard are verified with Electron `45.2.3`. Live provider commands are strictly human-gated and were not run during the 2026-11-05 repository refresh.

## Requirements

- Node.js `>=22.12.0`
- Windows PowerShell (or POSIX shell for offline tests)
- Dependencies installed in `C:\path\to\ai-team-v3`

## Setup

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm install
```

If Windows silently skips extracting `electron.exe` during `npm install`, run:

```powershell
npm run fix:electron
```

## Offline Verification

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm test
npm run test:v3-all
npm run smoke:two-provider
npm run smoke:three-provider
npm run smoke:multi-provider
npm run report:viewer
```

These commands use fake providers only and do not contact Qwen, Kimi, or any other live provider.

## Dashboard

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run app
```

Dashboard safety:

- Does not open provider web sessions on startup.
- Handles absent legacy status files (`FINAL_STATUS.md`, `coordination/*`) cleanly without errors or broken table rows.
- Shows provider state, health, approval gates, and separated answer + thinking blocks.
- Keeps live open actions blocked behind both UI confirmation and `AI_TEAM_V3_CONFIRM_SAFE_SESSION`.
- Uses Electron `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, and `webviewTag: false`.

## Human-Gated Live Commands (Not Run During 2026-11-05 Refresh)

Live commands open real provider pages and must only be executed interactively by a human operator after confirming a safe logged-in session.

### Selector Doctor

Run only when a human operator is present to inspect `qwen` or `kimi` without sending a prompt:

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run doctor:provider -- qwen
```

The doctor does not send a message. It writes `docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md` and a redacted trace (both gitignored).

### One-Provider Smoke

Run only after `qwen` or `kimi` is safely logged in, Selector Doctor passes, and the human explicitly sets the live confirmation variables:

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
npm run smoke:one-provider
```

Never run `chatgpt` or `claude` live (both are hard-blocked by policy).

## Packaging Readiness

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm test
npm run dist:dir
```

Never package or commit `.env`, cookies, browser profiles, `.tmp/`, `traces/`, `release/`, or generated `docs/*REPORT*` files.
