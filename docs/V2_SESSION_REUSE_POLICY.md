# V2 Session Reuse Policy

V3 may reuse existing V2 Electron partitions only for providers that the human explicitly allowed: qwen and kimi.

## What V3 Reuses

- V3 reuses an Electron partition reference such as `persist:ai-team-shared`.
- V3 does not export, copy, print, or inspect cookies.
- V3 does not read session storage or local storage.
- V3 does not log account data, emails, Authorization headers, tokens, or query secrets.

## Forbidden Providers

Claude and ChatGPT live automation are disabled by human instruction (D20, 2026-06-21). V3 refuses those two providers before opening any page or touching a session. Every other provider — including Perplexity, Gemini, DeepSeek, Grok, Z.ai, Meta, and Manus — is live-allowed at the room-policy level but stays human-gated per the gates below. This is the room policy only: the one-provider live smoke, Selector Doctor, and live ladder remain strict to qwen/kimi.

## Allowed First (staged ladder — unchanged by D20)

Qwen and Kimi remain the only providers used for the Selector Doctor and the one-provider live smoke, and only when the explicit human-confirmation gates are satisfied. D20 widened the room policy but deliberately left the first live gate strict to qwen/kimi (`LIVE_PROVIDER_ALLOWLIST` in `src/providers/provider-contract.js`): prove one safe provider live before widening. V2 shared-partition reuse (`persist:ai-team-shared`) also stays qwen/kimi-only.

## Gates

Selector Doctor can verify qwen/kimi sessions without sending prompts:

```powershell
npm run doctor:provider -- qwen
```

One-provider smoke still requires explicit confirmation:

```powershell
$env:AI_TEAM_V3_LIVE='1'
$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'
$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
npm run smoke:one-provider
```

## Current Discovery

V2 references a shared Electron partition, `persist:ai-team-shared`, in runtime configuration. V3 treats this as a partition name only. Cookies and tokens are never read.
