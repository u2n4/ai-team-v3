# Security And Quota

## Legitimate Session Only

V3 automates only normal logged-in user sessions. It must not bypass Cloudflare, CAPTCHA, rate limits, account limits, paid access, or provider terms. A challenge or limit becomes a diagnostic and disables that provider for the run.

## Electron Security

The Electron foundation uses:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- restrictive local CSP
- `webviewTag: false`

Remote provider pages are isolated in provider-specific persistent sessions.

## Quota Guard

Tracked per provider:

- `sendCount`
- `failedSendCount`
- `promptCharsSent`
- `consecutiveFailures`
- `limitDetected`
- `disabledForRun`

Three consecutive failures disable a provider for the current run. Limit detection disables immediately.

## Prompt Budgets

Offline/fake character caps (a budget entry does not grant live permission):

- chatgpt: 12000
- claude: 8000
- perplexity: 8000
- gemini: 12000
- deepseek: 12000
- qwen: 12000
- kimi: 12000

Over-budget prompts create `PROMPT_OVER_BUDGET` and are blocked before provider send.

## Transcript Firewall

Only clean public answers enter `TranscriptStore`. Diagnostics, UI text, challenge pages, limit pages, prompt/briefing echo, stale duplicate responses, empty captures, and partial tails are rejected into `DiagnosticsStore`.

## Metadata-Only Traces, Reports, and Diagnostics

Traces, reports, and diagnostics store METADATA ONLY — never raw prompt or response text, never cookies, tokens, headers, account data, or query secrets. Rejected captures store a length (`rejectedLength`) instead of a text preview; send-verification diagnostics keep verification metadata only (`verified`/`verifyReason`/counts) and drop the composer text; errors keep `name` + redacted `message`, never a full stack. CDP body fields (SSE `data`, WS `payloadData`, `postData`/`body`/`payload`) are redacted before storage. `src/core/redact.js` is the single source of truth for all redaction patterns; `report-viewer.js` and `provider-actor.js` consume it.

## Live Provider Policy (D20)

`chatgpt`, `claude` and `gemini` are hard-blocked before any page opens, including when a local policy file attempts to enable them. Other configured providers can be room candidates after approval; this does not mean they are validated or eligible for the first smoke step. Every live provider stays human-gated; the one-provider smoke, Selector Doctor, and live ladder remain strict to qwen/kimi.

The dashboard bridge accepts IPC only from the local top-level dashboard frame; external navigation and popup windows are denied. Runtime vault injection accepts encrypted envelopes only and checks the page origin inside the injection script. Legacy plaintext is readable only by the explicit local migration utility, never by provider opening.
