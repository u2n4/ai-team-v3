# Live Ladder 30 Real Discussion Plan

Status: HUMAN-GATED

No live provider was contacted by Codex. This plan defines the only allowed live path after the human confirms a safe qwen/kimi session.

## Ladder

1. `npm run doctor:provider -- qwen`
2. qwen one-provider smoke:

```powershell
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
npm run smoke:one-provider
```

3. `npm run doctor:provider -- kimi`
4. kimi one-provider smoke with the same confirmation gate.
5. qwen+kimi 3-message live discussion.
6. qwen+kimi 10-message live discussion.
7. qwen+kimi 30-message realistic discussion.
8. Optional deepseek only after qwen/kimi pass and only if configured safe.

## Required Live Endurance Env

```powershell
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
$env:AI_TEAM_V3_LIVE_PROVIDERS='qwen,kimi'
$env:AI_TEAM_V3_LIVE_MAX_MESSAGES='30'
npm run live:endurance:30
```

## Refusal Rules

The live ladder refuses if Claude, ChatGPT, Perplexity, or another unsupported provider is requested; doctor has not passed; one-provider smoke has not passed; the session is not safe/logged in; CAPTCHA, Cloudflare, login wall, rate limit, or paid wall appears; prompt budget overflows; transcript contamination appears; or a secret-risk appears in traces/reports.

`scripts/live-mode-validation.js` writes `docs/LIVE_ENDURANCE_30_REPORT.md`. Without the required live gates it writes a safe `NOT_RUN` or `BLOCKED_*` report and exits without contacting providers.
