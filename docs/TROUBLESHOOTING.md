# AI Team V3 — Troubleshooting

## `npm run test:v3-all` runs from the wrong folder

Use an explicit PowerShell location:

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run test:v3-all
```

## Dashboard opens but shows stale status

The dashboard reads local files:

- `coordination/CURRENT_STATUS.md`
- `FINAL_STATUS.md`
- `docs/ONE_PROVIDER_REPORT.md`
- `traces/**/*.json`

Refresh the app after those files change.

## Dashboard does not open providers

Correct. The dashboard is offline-safe by default. Provider web sessions are blocked until explicit human confirmation and the dedicated doctor/smoke command is used.

## Selector Doctor reports challenge, login wall, paid wall, or rate limit

Stop that provider. Do not retry blindly. Do not bypass CAPTCHA, Cloudflare, login checks, rate limits, paid access, or account limits.

## One-provider smoke says `BLOCKED_SAFE_SESSION_REQUIRED`

This is expected unless all three env vars are present:

```powershell
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
```

## Claude or Perplexity live is refused

Correct. Claude and Perplexity live automation are forbidden by default for the current V3 phase.

## Trace/report viewer shows no traces

Generate the viewer after traces exist:

```powershell
npm run report:viewer
```

The viewer intentionally stores counts, statuses, lengths, and sanitized URLs only. It must never show cookies, tokens, Authorization headers, emails, account ids, session ids, raw headers, prompt text, or raw response text.

## Fake ladder has diagnostics

Inspect the specific fake mode and provider. Diagnostics must stay in `DiagnosticsStore` and must not enter the transcript or later prompts.
