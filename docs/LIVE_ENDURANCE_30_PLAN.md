# Live Endurance 30 Plan

Status: HUMAN-GATED

This is the operational counterpart to `docs/LIVE_LADDER_30_REAL_DISCUSSION_PLAN.md`.

Allowed initial providers: qwen and kimi only. Deepseek is optional later only if already configured safe. Claude, ChatGPT, and Perplexity are blocked.

Required gates before any live 30-message run:

1. qwen Selector Doctor PASS.
2. qwen one-provider smoke PASS.
3. kimi Selector Doctor PASS.
4. kimi one-provider smoke PASS.
5. qwen+kimi 3-message live discussion PASS.
6. qwen+kimi 10-message live discussion PASS.
7. explicit human confirmation for 30-message live endurance.

Required env:

```powershell
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
$env:AI_TEAM_V3_LIVE_PROVIDERS='qwen,kimi'
$env:AI_TEAM_V3_LIVE_MAX_MESSAGES='30'
npm run live:endurance:30
```

The script refuses if doctor/smoke evidence is missing or if any challenge, login wall, rate limit, paid wall, contamination, prompt overflow, forbidden provider, or secret risk appears.
