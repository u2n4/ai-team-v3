# AI Team V3

AI Team V3 is a clean rebuild of the AI Team room runtime. V2 remains a reference only; V3 is isolated in this folder and starts with fake providers before any live provider is connected.

## Current Gate

Non-live V3 gates are implemented and covered by tests:

```powershell
npm --prefix C:\path\to\ai-team-v3 run test:v3-all
```

Live provider validation is intentionally gated. Run only after a human confirms a safe logged-in Qwen or Kimi session:

```powershell
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
npm --prefix C:\path\to\ai-team-v3 run smoke:one-provider
```

## Architecture

- Core invariants live under `src/core`.
- Fake and webview provider adapters live under `src/providers`.
- Electron foundation lives under `src/electron`.
- Tests live under `tests`.
- Handoff state lives under `coordination`.

V3 never routes diagnostics into the public transcript, never sends over-budget prompts, never retries a provider indefinitely, and never opens ChatGPT or Claude live — both are forbidden before page open by policy (D20, 2026-06-21). All other providers are live-allowed but stay human-gated; the first live validation gate (Selector Doctor + one-provider smoke) is still restricted to Qwen/Kimi.
