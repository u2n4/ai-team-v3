# AI Team V3 Roadmap To 100 Percent

**Date:** 2026-05-17
**Owner:** Codex builder, Claude QA verifier
**Current baseline:** core/offline V3 gates pass; Selector Doctor, qwen/kimi provider contracts, one-provider live smoke driver, condition waits, provider health, and redacted trace paths are implemented. Live doctor and live smoke have not been run because they require human-confirmed safe provider session.

This roadmap keeps V3 moving from the safe fake-first architecture to a production-ready, observable, packaged Electron app. Claude and Perplexity live testing remain forbidden until explicitly authorized later.

---

## Phase 1 — One-Provider Live Driver

**Goal**

Build a safe live smoke path for one provider, starting with Qwen and using Kimi only as fallback.

**Files to change**

- `scripts/smoke-one-provider.js`
- `tests/integration/smoke-one-provider.test.js`
- `docs/ONE_PROVIDER_REPORT.md`
- `docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md`
- `docs/CODEX_BUILD_REPORT.md`
- `coordination/CURRENT_STATUS.md`
- `coordination/TODO_FOR_CODEX.md`
- `FINAL_STATUS.md`

**Acceptance tests**

- `npm run test:v3-all` passes.
- `npm run smoke:one-provider` without live env exits safely as `NOT_RUN`.
- Missing `AI_TEAM_V3_CONFIRM_SAFE_SESSION=1` writes `BLOCKED_SAFE_SESSION_REQUIRED`.
- Claude, Perplexity, and unsupported providers are refused before any Electron launch.
- Challenge, limit, login wall, selector mismatch, and failed send verification write typed blocked reports.

**Risks**

- Live provider DOM changes may break selectors.
- Persistent session may not be logged in.
- Provider may show challenge or rate limit.

**Rollback plan**

- Revert only `scripts/smoke-one-provider.js` and its test.
- Keep reports documenting `NOT_RUN` or `BLOCKED`.
- Do not retry live execution automatically.

---

## Phase 2 — Live Selector Verification

**Goal**

Verify Qwen/Kimi selectors against the current live DOM without logging secrets or account data.

**Files to change**

- `docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md`
- `src/providers/webview-provider-adapter.js`
- `src/electron/dom-capture.js`
- `tests/electron/dom-capture.test.js`

**Acceptance tests**

- Selector xray records input, send, response, response-count, thinking, challenge, and limit counts.
- URLs are recorded as origin plus pathname only.
- Query strings, fragments, cookies, tokens, headers, account IDs, and body text are never written.
- Smoke can proceed only when composer and send path are usable and challenge/limit signals are absent.

**Risks**

- SPA rendering may delay selector availability.
- A login screen may contain misleading text or hidden inputs.
- Selector counts can be stale if the provider lazy-loads UI.

**Rollback plan**

- Restore previous provider selectors.
- Mark selector verification `BLOCKED`.
- Require human-supplied selector snapshot before another live attempt.

---

## Phase 3 — Provider Contract System

**Goal**

Move provider definitions from ad hoc objects to explicit contracts with validation.

**Files to change**

- `src/providers/webview-provider-adapter.js`
- `src/providers/provider-contract.js`
- `tests/providers/provider-contract.test.js`
- `docs/PROVIDER_CAPTURE_STRATEGY.md`

**Acceptance tests**

- Every provider contract declares URL, partition, selectors, stability window, forbidden live status, and safety policy.
- Invalid contracts fail tests before runtime.
- Claude and Perplexity are marked live-disabled unless explicitly re-enabled by policy.

**Risks**

- Over-validation may block harmless selector updates.
- Provider-specific edge cases may not fit a single schema.

**Rollback plan**

- Keep old definitions as compatibility input.
- Gate contract validation behind tests first, then runtime.
- Revert provider-contract module if it blocks existing fake tests.

---

## Phase 4 — Capture Stability

**Goal**

Harden DOM response capture against streaming tails, thinking leaks, prompt echo, old messages, and UI chrome.

**Files to change**

- `src/electron/dom-capture.js`
- `src/electron/lifecycle-monitor.js`
- `src/core/response-normalizer.js`
- `tests/electron/dom-capture.test.js`
- `tests/electron/lifecycle-monitor.test.js`
- `tests/providers/transcript-firewall.test.js`

**Acceptance tests**

- Per-provider `stabilityMs` is honored by both capture and lifecycle layers.
- Response count must advance or a clean new latest response must appear.
- Prompt echo, stale duplicate, partial tail, thinking text, sidebars, and footer text never enter transcript.

**Risks**

- Too-short stability windows capture partial text.
- Too-long windows make the app feel stalled.
- Selector fallback order may pick old messages.

**Rollback plan**

- Revert provider-specific stability values.
- Restore conservative default stability window.
- Fall back to selector xray diagnostics without transcript insertion.

---

## Phase 5 — CDP Diagnostics With Redaction

**Goal**

Use CDP network diagnostics only for metadata and streaming visibility, never for secret capture.

**Files to change**

- `src/electron/cdp-monitor.js`
- `src/core/diagnostics-store.js`
- `tests/electron/cdp-monitor.test.js`
- `docs/SECURITY_AND_QUOTA.md`

**Acceptance tests**

- `requestWillBeSent`, `responseReceived`, `loadingFinished`, `eventSourceMessageReceived`, and `webSocketFrameReceived` are represented as redacted diagnostics.
- Only safe allowlisted headers are kept.
- Cookies, tokens, Authorization headers, account IDs, and payload bodies are redacted or dropped.

**Risks**

- CDP events can expose sensitive data if sinks are not strictly controlled.
- Streaming payloads differ across providers.

**Rollback plan**

- Disable CDP monitor by default.
- Keep DOM capture as primary source.
- Preserve redacted diagnostics only.

---

## Phase 6 — Provider Health Score

**Goal**

Track provider reliability and disable unhealthy providers for the current run.

**Files to change**

- `src/core/quota-guard.js`
- `src/core/provider-health.js`
- `src/core/orchestrator.js`
- `tests/core/quota-guard.test.js`
- `tests/core/provider-health.test.js`

**Acceptance tests**

- Health score reflects sends, failures, timeouts, challenge/limit detections, prompt budget blocks, and clean captures.
- Repeated failures disable only that provider for the current run.
- One broken provider does not block the room.

**Risks**

- Overly aggressive disabling may skip usable providers.
- Underweighting failures can burn quota.

**Rollback plan**

- Keep current `QuotaGuard` thresholds as fallback.
- Disable scoring decisions while continuing diagnostics.

---

## Phase 7 — Multi-Provider Ladder

**Goal**

Introduce a safe ladder from one-provider smoke to limited multi-provider runs.

**Files to change**

- `src/core/orchestrator.js`
- `scripts/smoke-one-provider.js`
- `scripts/smoke-provider-ladder.js`
- `tests/integration/provider-ladder.test.js`
- `docs/SECURITY_AND_QUOTA.md`

**Acceptance tests**

- Ladder starts with Qwen or Kimi only.
- Second provider is enabled only after one-provider smoke passes.
- Claude and Perplexity remain excluded until a later explicit authorization.
- No full 7-provider live run is possible from the ladder script.

**Risks**

- Multiple providers can multiply quota burn.
- Live selector drift can compound across providers.

**Rollback plan**

- Delete or disable ladder script.
- Keep one-provider smoke as the only live entrypoint.

---

## Phase 8 — Dashboard

**Goal**

Expose room state, provider health, diagnostics, prompt budgets, and trace events in the V3 UI.

**Files to change**

- `src/electron/renderer.html`
- `src/electron/renderer.js`
- `src/electron/preload.js`
- `src/electron/main.js`
- `src/core/trace-store.js`
- `docs/ARCHITECTURE.md`

**Acceptance tests**

- Dashboard shows public transcript separately from diagnostics.
- Prompt budget and provider state transitions are visible.
- Warning cards never enter next prompts.
- UI works without nested cards or text overlap.

**Risks**

- UI may accidentally display or pass diagnostic text as transcript.
- Electron IPC can leak too much data if not scoped.

**Rollback plan**

- Keep dashboard read-only.
- Hide diagnostics panel behind safe filtered APIs.
- Revert renderer changes without touching core.

---

## Phase 9 — Human Approval Gates

**Goal**

Require explicit human approval for every risky live action.

**Files to change**

- `scripts/smoke-one-provider.js`
- `scripts/smoke-provider-ladder.js`
- `src/core/quota-guard.js`
- `docs/SECURITY_AND_QUOTA.md`
- `coordination/DECISIONS.md`

**Acceptance tests**

- Live smoke requires `AI_TEAM_V3_CONFIRM_SAFE_SESSION=1`.
- Multi-provider ladder requires a separate explicit env flag.
- Provider reset, new chat creation, attachments, and Claude/Perplexity live use are blocked unless separately authorized.

**Risks**

- Too many gates may slow manual validation.
- A poorly named env var can be misunderstood.

**Rollback plan**

- Keep one confirmation env for one-provider only.
- Refuse all other live modes by default.

---

## Phase 10 — Observability And Tracing

**Goal**

Make every actor transition, prompt budget decision, send verification, capture result, and diagnostic auditable.

**Files to change**

- `src/core/trace-store.js`
- `src/core/provider-actor.js`
- `src/core/prompt-ledger.js`
- `src/electron/send-controller.js`
- `src/electron/lifecycle-monitor.js`
- `tests/core/api-contracts.test.js`

**Acceptance tests**

- Every `ProviderActor` transition is logged.
- Prompt ledger records included turn IDs without storing secrets.
- Live smoke report links send, capture, normalizer, transcript, and diagnostics results.
- Trace output never contains cookies, tokens, headers, account IDs, or full page body text.

**Risks**

- Overly verbose traces can become prompt pollution.
- Trace data can accidentally include sensitive browser state.

**Rollback plan**

- Keep traces in memory for tests.
- Write only summarized reports until redaction is re-audited.

---

## Phase 11 — Packaging And Installer

**Goal**

Package V3 as a clean Electron app without V2 runtime coupling.

**Files to change**

- `package.json`
- `src/electron/main.js`
- `README.md`
- `docs/ARCHITECTURE.md`
- packaging config files after tool selection

**Acceptance tests**

- Packaged app launches with V3 UI.
- Persistent provider partitions survive restart.
- No V2 runtime files are required.
- No secrets, logs, or user data are bundled.

**Risks**

- Packaging can accidentally include V2 logs or diagnostics.
- Electron permissions may differ after packaging.

**Rollback plan**

- Keep dev mode as supported path.
- Package only after source and docs are clean.
- Exclude logs and generated reports from installer output.

---

## Phase 12 — Final Acceptance Gates

**Goal**

Define the proof required before calling AI Team V3 complete.

**Files to change**

- `FINAL_STATUS.md`
- `docs/CODEX_BUILD_REPORT.md`
- `docs/CLAUDE_QA_REPORT.md`
- `docs/SECURITY_AND_QUOTA.md`
- `coordination/CURRENT_STATUS.md`
- `coordination/DECISIONS.md`

**Acceptance tests**

- `npm run test:v3-all` passes.
- One-provider Qwen or Kimi live smoke passes with human confirmation.
- Transcript contains only clean public AI replies.
- Diagnostics are never passed as AI messages.
- Prompt budget, delta-only, briefing-once, quota guard, and failure isolation are all proven.
- Claude QA signs off after reviewing Codex changes.
- No Claude or Perplexity live test was run without explicit later authorization.

**Risks**

- A green offline suite can hide live DOM drift.
- Human-gated steps can be mistaken for automation failure.

**Rollback plan**

- Set `FINAL_STATUS.md` to `NOT_READY` for code/test failures.
- Set `FINAL_STATUS.md` to `HUMAN_BLOCKED` for missing safe live session.
- Keep `READY_FOR_CLAUDE_QA` only when Codex changes are ready for independent QA.
