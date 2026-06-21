# AI Team V3 — Install And Run

**Status:** offline-safe commands are ready. Live provider commands are human-gated.

## Requirements

- Node.js 20+
- Windows PowerShell
- Dependencies installed in `C:\path\to\ai-team-v3`

## Setup

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm install
```

## Offline Verification

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run test:v3-all
npm run smoke:two-provider
npm run smoke:three-provider
npm run smoke:multi-provider
npm run report:viewer
```

These commands do not contact qwen, kimi, Claude, Perplexity, or any other live provider.

## Dashboard

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run app
```

Dashboard safety:

- Does not open provider web sessions on startup.
- Reads local status/report/trace files.
- Shows mock/fake provider state and health.
- Keeps live open actions blocked behind approval gates.
- Uses Electron `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`.

## Selector Doctor

Run only when the human is awake and ready to inspect qwen without sending a prompt:

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run doctor:provider -- qwen
```

The doctor should not send a message. It writes `docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md` and a redacted trace.

## One-Provider Smoke

Run only after qwen is safely logged in, Selector Doctor is ready, and the human explicitly confirms:

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
npm run smoke:one-provider
```

Never run Claude or Perplexity live. Never run a full seven-provider live run.

## Packaging Readiness

No production installer is built yet. Current safe build readiness gate is:

```powershell
npm run test:v3-all
npm run app
```

Do not package cookies, browser profiles, traces with secrets, provider session data, or V2 runtime data.
