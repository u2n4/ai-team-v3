# AI Team V3 — Troubleshooting

## `npm test` or `npm run test:v3-all` runs from the wrong folder

Use an explicit PowerShell location:

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm test
```

## Electron binary missing after `npm install` on Windows

On some Windows systems, `npm install` reports success without extracting `node_modules/electron/dist/electron.exe`. Run the self-healing postinstall script or Electron's installer:

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run fix:electron
# If the zip is not yet in the local Electron cache:
node node_modules/electron/install.js
```

## Dashboard status and optional report files

The dashboard works out of the box without `FINAL_STATUS.md` or `coordination/CURRENT_STATUS.md` (which were removed when preparing the repository for public release), defaulting to `OFFLINE_READY` and `HUMAN_GATED`. If optional local reports (`docs/ONE_PROVIDER_REPORT.md`, `traces/**/*.json`) are generated locally, refresh the dashboard to view them.

## Dashboard does not open providers

Correct. The dashboard is offline-safe by default. Opening a provider web session requires both explicit UI confirmation and `AI_TEAM_V3_CONFIRM_SAFE_SESSION=1`.

## Selector Doctor reports challenge, login wall, paid wall, or rate limit

Stop that provider immediately. Do not retry blindly. Never attempt to bypass CAPTCHA, Cloudflare, login checks, rate limits, paid access, or account limits.

## One-provider smoke says `BLOCKED_SAFE_SESSION_REQUIRED`

This is expected unless all three environment variables are explicitly set by a human operator:

```powershell
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
```

## ChatGPT or Claude live is refused (`BLOCKED_PROVIDER_FORBIDDEN`)

Correct. ChatGPT and Claude live sessions are forbidden before page open by policy (`config/provider-session-policy.json`).

## Trace/report viewer shows no traces

Generate the viewer after local traces exist:

```powershell
npm run report:viewer
```

The viewer stores counts, statuses, lengths, and sanitized URLs only. It never persists cookies, tokens, `Authorization` headers, emails, account IDs, session IDs, raw headers, prompt text, or raw response text.

## Fake ladder has diagnostics

Inspect the specific fake mode and provider. Diagnostics stay in `DiagnosticsStore` and never enter the public transcript or subsequent prompts.
