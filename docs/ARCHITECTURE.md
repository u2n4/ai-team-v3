# Architecture

## Data Flow

```text
Orchestrator
  -> PromptBuilder
  -> BudgetGuard
  -> ProviderActor
  -> Provider.send / Provider.waitForResponse
  -> ResponseNormalizer
  -> TranscriptStore or DiagnosticsStore
  -> TraceStore
```

## Core Stores

- `TranscriptStore`: only public user/AI messages.
- `DiagnosticsStore`: failures, budget blocks, provider limits, capture rejects.
- `TraceStore`: state transitions and budget/CDP events.
- `PromptLedger`: per-provider `briefingDelivered` and `lastDeliveredTurnId`.
- `QuotaGuard`: send counts, failed sends, prompt chars, consecutive failures, limit flags, run disablement.

## ProviderActor State Machine

States:

`IDLE -> PREPARING_PROMPT -> BUDGET_CHECK -> READY_TO_SEND -> SENDING -> SEND_VERIFIED -> WAITING_RESPONSE -> CAPTURE_CANDIDATE -> NORMALIZING_RESPONSE -> CAPTURED -> COOLDOWN`

Failure states:

`FAILED_DIAGNOSTIC`, `DISABLED_FOR_RUN`.

Every transition is logged to `TraceStore`. Budget failures stop before send. Capture failures go to diagnostics. A broken provider does not stop the room.

## Prompt Invariants

- `SESSION_BRIEFING` is included once per provider session.
- Later turns are delta-only.
- `lastDeliveredTurnId` advances only after verified send.
- Diagnostics never enter prompt deltas.
- A provider does not receive its own prior response as new context.

## Provider Config Schema

Each provider definition owns:

- `id`, `name`, `url`, `partition`
- `inputSelectors`
- `sendSelectors`
- `responseSelectors`
- `responseCountSelector`
- `thinkingSelectors`
- `stopSelectors`
- `errorSelectors`
- `limitSelectors`
- `challengeSelectors`

## Electron Foundation

V3 follows the research in `docs/RESEARCH.md`:

- Prefer `WebContentsView`.
- Keep persistent provider partitions such as `persist:ai-team-v3-qwen`.
- Disable `webviewTag`.
- Use `contextIsolation`, `sandbox`, `nodeIntegration: false`, and `webSecurity: true`.
- Keep CDP events redacted before storage.

## Test Strategy

Fake providers are mandatory before live providers. The tests prove:

- briefing once,
- delta-only context,
- final prompt budget block,
- transcript firewall,
- quota disablement,
- failure isolation,
- 7-provider 4-cycle fake room,
- trace transitions.
