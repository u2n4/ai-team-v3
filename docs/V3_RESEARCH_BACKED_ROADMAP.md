# V3 Research-Backed Roadmap

**Date:** 2026-05-16
**Status:** Selector Doctor implemented; one-provider smoke remains human-confirmed before live execution.

This roadmap follows the Playwright model of locator contracts, auto-waiting, actionability checks, and web-first assertions; the Electron security baseline of isolated, sandboxed renderers; and CDP diagnostics limited to redacted metadata.

Research anchors:

- Playwright Locators: https://playwright.dev/docs/locators
- Playwright Auto-waiting and actionability: https://playwright.dev/docs/actionability
- Playwright Best Practices: https://playwright.dev/docs/best-practices
- Electron Security Checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Chrome DevTools Protocol Network domain: https://chromedevtools.github.io/devtools-protocol/tot/Network/

---

## Phase 1 — Selector Doctor

**Goal**

Create a no-prompt diagnostic command that verifies a provider page is safe and actionable before any live smoke sends text.

**Files to change**

- `scripts/selector-doctor.js`
- `scripts/doctor-provider.js`
- `package.json`
- `tests/integration/selector-doctor.test.js`
- `docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md`
- `traces/selector-doctor/*`

**Acceptance tests**

- `npm run doctor:provider -- qwen` exists.
- Only `qwen` and `kimi` are accepted.
- Claude, Perplexity, and unsupported providers are refused before Electron launch.
- Doctor verifies page loaded, actionable composer/input, send control or Enter fallback, response container, response count selector, and thinking/loading selectors.
- Doctor detects CAPTCHA, Cloudflare, rate limit, login wall, and paid wall.
- Doctor writes a redacted Markdown report and redacted JSON trace.
- Doctor never sends a prompt.

**Risks**

- A live SPA can render controls after the initial xray.
- Login text can appear in non-login contexts.
- Provider selectors can drift without warning.

**Rollback plan**

- Disable the `doctor:provider` package script.
- Retain the last redacted report as evidence.
- Fall back to manual selector snapshot before live smoke.

---

## Phase 2 — One-Provider Live Driver For Qwen

**Goal**

Run one tiny Qwen live smoke only after Selector Doctor and explicit human confirmation.

**Files to change**

- `scripts/smoke-one-provider.js`
- `docs/ONE_PROVIDER_REPORT.md`
- `tests/integration/smoke-one-provider.test.js`
- `src/electron/send-controller.js`
- `src/electron/lifecycle-monitor.js`

**Acceptance tests**

- Requires `AI_TEAM_V3_LIVE=1`, `AI_TEAM_V3_LIVE_PROVIDER=qwen`, and `AI_TEAM_V3_CONFIRM_SAFE_SESSION=1`.
- Missing confirmation writes `BLOCKED_SAFE_SESSION_REQUIRED`.
- Sends only one harmless prompt after doctor passes.
- Send is verified by composer clear or response-count increment.
- Response capture honors provider `stabilityMs`.
- Response is normalized before transcript insertion.
- Diagnostics remain separate.

**Risks**

- Qwen session may not be logged in.
- Qwen may challenge, rate-limit, or alter selectors.
- Response may stream longer than the configured stability window.

**Rollback plan**

- Refuse live smoke and keep `ONE_PROVIDER_REPORT.md` as `BLOCKED`.
- Do not retry automatically.
- Revert only smoke driver changes if QA finds unsafe behavior.

---

## Phase 3 — Kimi Fallback

**Goal**

Provide the same doctor and smoke path for Kimi if Qwen is unavailable.

**Files to change**

- `src/providers/webview-provider-adapter.js`
- `scripts/selector-doctor.js`
- `scripts/smoke-one-provider.js`
- `tests/integration/selector-doctor.test.js`
- `tests/integration/smoke-one-provider.test.js`

**Acceptance tests**

- `npm run doctor:provider -- kimi` performs no-send selector verification.
- Kimi smoke requires the same confirmation gate.
- Kimi reports use Kimi URL and partition only.

**Risks**

- Kimi UI may be less stable or use canvas/shadow DOM.
- Kimi may require a different send action.

**Rollback plan**

- Keep Qwen as the only live candidate.
- Mark Kimi fallback `BLOCKED_SELECTOR_DRIFT`.

---

## Phase 4 — Provider Contract System

**Goal**

Turn provider definitions into explicit contracts with semantic locators, CSS fallbacks, stability policy, and live permissions.

**Files to change**

- `src/providers/provider-contract.js`
- `src/providers/webview-provider-adapter.js`
- `tests/providers/provider-contract.test.js`
- `docs/PROVIDER_CAPTURE_STRATEGY.md`

**Acceptance tests**

- Every provider declares URL, partition, allowed live state, selectors, semantic locator hints, stability window, and safety policy.
- Contract validation fails on missing response selectors or unsafe live permissions.
- Claude and Perplexity remain live-disabled.

**Risks**

- Contract validation can become too rigid for provider UI changes.
- Semantic locator hints may be unavailable on some providers.

**Rollback plan**

- Keep legacy definitions as compatibility input.
- Disable runtime contract enforcement while keeping test warnings.

---

## Phase 5 — Playwright-Like Wait / Assertion Layer

**Goal**

Replace fixed waits with reusable web-first assertions and actionability checks.

**Files to change**

- `src/electron/actionability.js`
- `src/electron/dom-capture.js`
- `src/electron/send-controller.js`
- `src/electron/lifecycle-monitor.js`
- `tests/electron/actionability.test.js`

**Acceptance tests**

- Locators auto-retry until visible, enabled, editable/actionable, or timed out.
- Assertions describe the expected page state before action.
- Fixed sleeps are only small polling intervals, never the main strategy.

**Risks**

- Retry loops can hide real stuck states if timeout reporting is vague.
- Too many DOM probes can slow providers.

**Rollback plan**

- Restore current send/capture flow.
- Keep actionability module behind the doctor/smoke path only.

---

## Phase 6 — CDP Diagnostics With Strict Redaction

**Goal**

Use CDP only for safe lifecycle/network metadata, never secrets or payload bodies.

**Files to change**

- `src/electron/cdp-monitor.js`
- `tests/electron/cdp-monitor.test.js`
- `docs/SECURITY_AND_QUOTA.md`

**Acceptance tests**

- CDP captures `requestWillBeSent`, `responseReceived`, `loadingFinished`, EventSource, and WebSocket metadata.
- Header allowlist keeps safe fields only.
- Cookies, tokens, Authorization, account IDs, emails, query secrets, request bodies, and response bodies are dropped/redacted.

**Risks**

- CDP events can include sensitive URLs or headers.
- Streaming payloads may tempt transcript capture from network.

**Rollback plan**

- Disable CDP monitor by default.
- Keep DOM capture as the only transcript source.

---

## Phase 7 — Trace / Replay Artifacts

**Goal**

Create redacted debug artifacts sufficient to replay decisions without preserving secrets or page content.

**Files to change**

- `traces/selector-doctor/*`
- `src/core/trace-store.js`
- `scripts/selector-doctor.js`
- `scripts/smoke-one-provider.js`
- `docs/SECURITY_AND_QUOTA.md`

**Acceptance tests**

- Selector Doctor writes JSON artifact with counts, summary, and safety flags.
- Smoke writes send/capture/normalizer summary without prompt secrets.
- Artifacts never include page body text, cookies, headers, tokens, account IDs, emails, or query secrets.

**Risks**

- Debug artifacts can grow noisy.
- Future fields can accidentally include page text.

**Rollback plan**

- Stop writing trace files and keep in-memory diagnostics only.
- Delete unsafe artifacts if QA finds leakage.

---

## Phase 8 — Provider Health Score

**Goal**

Track provider health and disable unsafe or failing providers for the current run.

**Files to change**

- `src/core/provider-health.js`
- `src/core/quota-guard.js`
- `src/core/orchestrator.js`
- `tests/core/provider-health.test.js`

**Acceptance tests**

- Health score includes clean captures, send failures, timeouts, challenges, limits, and budget blocks.
- Repeated failures disable only the affected provider.
- Diagnostics never enter the transcript.

**Risks**

- Aggressive scoring can skip usable providers.
- Lenient scoring can burn quota.

**Rollback plan**

- Fall back to current `QuotaGuard`.
- Keep health score read-only until tuned.

---

## Phase 9 — Multi-Provider Ladder

**Goal**

Safely graduate from one-provider live smoke to limited multi-provider checks.

**Files to change**

- `scripts/smoke-provider-ladder.js`
- `src/core/orchestrator.js`
- `tests/integration/provider-ladder.test.js`
- `docs/SECURITY_AND_QUOTA.md`

**Acceptance tests**

- Ladder starts only after Qwen or Kimi one-provider smoke passes.
- Claude and Perplexity remain excluded.
- No full seven-provider live run can be started from the ladder.

**Risks**

- Multi-provider testing can multiply quota burn.
- One provider challenge can contaminate room state if isolated poorly.

**Rollback plan**

- Remove ladder script and return to one-provider smoke.
- Keep provider isolation gates active.

---

## Phase 10 — Dashboard

**Goal**

Expose transcript, diagnostics, health, budgets, and trace summaries in a safe V3 UI.

**Files to change**

- `src/electron/renderer.html`
- `src/electron/renderer.js`
- `src/electron/preload.js`
- `src/electron/main.js`
- `docs/ARCHITECTURE.md`

**Acceptance tests**

- Transcript and diagnostics are visually and structurally separate.
- Warning cards cannot be appended as AI messages.
- UI shows provider state, budget, health, and latest trace summary.

**Risks**

- UI can accidentally surface diagnostic text as context.
- IPC may expose too much internal state.

**Rollback plan**

- Keep dashboard read-only.
- Hide diagnostics API until redaction is re-audited.

---

## Phase 11 — Approval Gates

**Goal**

Require explicit approval for risky live actions and provider expansions.

**Files to change**

- `scripts/smoke-one-provider.js`
- `scripts/smoke-provider-ladder.js`
- `coordination/DECISIONS.md`
- `docs/SECURITY_AND_QUOTA.md`

**Acceptance tests**

- One-provider live requires `AI_TEAM_V3_CONFIRM_SAFE_SESSION=1`.
- Multi-provider ladder requires a separate explicit confirmation.
- New chats, resets, attachments, Claude live, Perplexity live, and full seven-provider runs are blocked by default.

**Risks**

- Human approval can be confused with readiness.
- Too many env vars can become hard to operate.

**Rollback plan**

- Keep only the one-provider approval gate.
- Refuse all other live modes.

---

## Phase 12 — Packaging / Installer

**Goal**

Package V3 as a standalone Electron app while preserving the security baseline.

**Files to change**

- `package.json`
- Electron packaging config
- `src/electron/main.js`
- `README.md`
- `docs/ARCHITECTURE.md`

**Acceptance tests**

- Packaged app launches with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `webviewTag: false`.
- Persistent provider partitions survive restart.
- Reports, traces, logs, and V2 runtime data are not bundled as user data.

**Risks**

- Packaging can alter Electron session behavior.
- Build output can include generated reports.

**Rollback plan**

- Keep dev mode as supported path.
- Exclude packaging artifacts until security review passes.

---

## Canonical Phase Matrix

This matrix is the current execution contract for the remaining V3 work. Status names are intentionally explicit so Codex, Claude QA, and the human can coordinate without treating a gated live step as a failure.

### 1. Selector Doctor

**Goal:** Verify qwen/kimi provider pages without sending prompts.

**Files to change:** `scripts/selector-doctor.js`, `scripts/doctor-provider.js`, `src/providers/provider-contract.js`, `tests/integration/selector-doctor.test.js`, `docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md`, `traces/selector-doctor/*`.

**Implementation steps:** validate provider allowlist, open/attach Electron session, read DOM xray, classify page safety, write redacted Markdown/JSON artifacts, exit without prompt send.

**Acceptance tests:** qwen/kimi allowed; Claude/Perplexity refused; challenge/login/rate-limit/paid wall block; no prompt send; reports and traces are redacted.

**Risks:** selector drift, login text false positives, provider SPA late rendering.

**Rollback plan:** disable `doctor:provider` script and fall back to manual redacted selector snapshot.

**Exact status names:** `READY_FOR_PROVIDER_DOCTOR`, `PROVIDER_DOCTOR_READY`, `BLOCKED_SELECTOR_DRIFT`, `WAITING_FOR_HUMAN_LIVE_CONFIRMATION`.

### 2. One-Provider Live Driver For Qwen

**Goal:** Run one tiny qwen smoke only after explicit safe-session confirmation.

**Files to change:** `scripts/smoke-one-provider.js`, `src/electron/send-controller.js`, `src/electron/lifecycle-monitor.js`, `src/electron/dom-capture.js`, `tests/integration/smoke-one-provider.test.js`, `docs/ONE_PROVIDER_REPORT.md`, `traces/smoke-one-provider/*`.

**Implementation steps:** require env gates, run Selector Doctor first, verify send by composer clear or response count increment, capture after provider stability window, normalize/firewall, write report and redacted trace.

**Acceptance tests:** missing live env is `NOT_RUN`; missing confirmation is `BLOCKED_SAFE_SESSION_REQUIRED`; qwen only by default; smoke routes through normalizer and diagnostics separation.

**Risks:** qwen session not logged in, challenge/rate limit, selector drift, long streaming response.

**Rollback plan:** leave smoke gated and report `BLOCKED_SAFE_SESSION_REQUIRED`; do not auto-retry.

**Exact status names:** `READY_FOR_ONE_PROVIDER_SMOKE`, `BLOCKED_SAFE_SESSION_REQUIRED`, `BLOCKED_PROVIDER_NOT_ALLOWED`, `PASS`, `WAITING_FOR_HUMAN_LIVE_CONFIRMATION`.

### 3. Kimi Fallback

**Goal:** Provide the same gated doctor/smoke path for kimi if qwen is unavailable.

**Files to change:** `src/providers/webview-provider-adapter.js`, `src/providers/provider-contract.js`, `scripts/selector-doctor.js`, `scripts/smoke-one-provider.js`, `tests/integration/*`.

**Implementation steps:** validate kimi contract, tune selectors, run no-send doctor first, allow smoke only with the same confirmation gate.

**Acceptance tests:** `npm run doctor:provider -- kimi` works offline/in live-gated mode; smoke accepts `AI_TEAM_V3_LIVE_PROVIDER=kimi`; Claude/Perplexity remain forbidden.

**Risks:** kimi UI may use different composer behavior or delayed rendering.

**Rollback plan:** mark kimi `BLOCKED_SELECTOR_DRIFT` and keep qwen as the only candidate.

**Exact status names:** `READY_FOR_KIMI_DOCTOR`, `READY_FOR_KIMI_SMOKE`, `BLOCKED_SELECTOR_DRIFT`.

### 4. Provider Contract System

**Goal:** Make live-provider behavior explicit and testable instead of hidden in scripts.

**Files to change:** `src/providers/provider-contract.js`, `src/providers/webview-provider-adapter.js`, `tests/providers/provider-contract.test.js`, `docs/PROVIDER_CAPTURE_STRATEGY.md`.

**Implementation steps:** require provider id, live status, URL, selector groups, response count selector, stability, budget, cooldown, redaction policy, and safe first prompt.

**Acceptance tests:** qwen/kimi contracts validate; forbidden providers refuse live use; missing required fields fail fast.

**Risks:** validation can become too strict during selector churn.

**Rollback plan:** keep contract validation in tests first, then loosen only the field that blocks legitimate selector updates.

**Exact status names:** `CONTRACT_VALID`, `CONTRACT_INVALID`, `BLOCKED_FORBIDDEN_PROVIDER`, `BLOCKED_UNSUPPORTED_PROVIDER`.

### 5. Playwright-Like Wait / Assertion Layer

**Goal:** Use condition-based actionability checks, not fixed sleeps, for live automation.

**Files to change:** `src/electron/wait-assertions.js`, `src/electron/send-controller.js`, `src/electron/lifecycle-monitor.js`, `tests/electron/wait-assertions.test.js`.

**Implementation steps:** implement `waitForVisible`, `waitForEnabled`, `waitForStableText`, `waitForResponseCountIncrement`, `waitForComposerClear`, and `waitForNoChallenge`.

**Acceptance tests:** waits poll concrete conditions; timeouts return diagnostics; no fixed-sleep-only strategy gates success.

**Risks:** polling too frequently can slow pages; vague diagnostics can hide root cause.

**Rollback plan:** keep wait utilities isolated to doctor/smoke until Claude QA approves.

**Exact status names:** `WAIT_ASSERTION_READY`, `WAIT_ASSERTION_TIMEOUT`, `WAIT_ASSERTION_FAILED`.

### 6. CDP Diagnostics With Strict Redaction

**Goal:** Capture only safe lifecycle/network metadata for debugging.

**Files to change:** `src/electron/cdp-monitor.js`, `tests/electron/cdp-monitor.test.js`, `docs/SECURITY_AND_QUOTA.md`.

**Implementation steps:** allowlist metadata fields, redact URL query secrets, drop raw headers/bodies, store only event summaries.

**Acceptance tests:** request/response/loading/EventSource/WebSocket metadata is useful but contains no cookies, Authorization, tokens, emails, account IDs, or bodies.

**Risks:** future CDP fields can accidentally include sensitive data.

**Rollback plan:** disable CDP diagnostics and rely on DOM capture plus redacted trace summaries.

**Exact status names:** `CDP_METADATA_READY`, `CDP_REDACTED`, `CDP_DISABLED_FOR_SAFETY`.

### 7. Trace / Replay Artifacts

**Goal:** Preserve enough evidence to replay decisions without preserving secrets or page text.

**Files to change:** `scripts/selector-doctor.js`, `scripts/smoke-one-provider.js`, `src/core/trace-store.js`, `traces/selector-doctor/*`, `traces/smoke-one-provider/*`.

**Implementation steps:** write run id, provider id, timestamps, selector counts, response count before/after, capture duration, normalizer code, diagnostics summary, and safety flags.

**Acceptance tests:** trace files redact secrets and store lengths/counts instead of prompt or response text.

**Risks:** trace schema can grow into accidental transcript storage.

**Rollback plan:** stop trace file writes and keep only in-memory `TraceStore`.

**Exact status names:** `TRACE_READY`, `TRACE_REDACTED`, `TRACE_DISABLED_FOR_SAFETY`.

### 8. Provider Health Score

**Goal:** Track provider reliability and disable unsafe providers for the current run.

**Files to change:** `src/core/provider-health.js`, `src/core/quota-guard.js`, `src/core/orchestrator.js`, `tests/core/provider-health.test.js`.

**Implementation steps:** record availability, login state, selector health, success/failure timestamps, consecutive failures, challenge/rate flags, capture reliability, average response time, and run disable state.

**Acceptance tests:** successes improve score; failures/challenges/limits reduce score; repeated failures disable only that provider.

**Risks:** scoring can be too aggressive or too lenient.

**Rollback plan:** keep health scoring advisory and let `QuotaGuard` remain the enforcement layer.

**Exact status names:** `PROVIDER_HEALTHY`, `PROVIDER_DEGRADED`, `PROVIDER_DISABLED_FOR_RUN`.

### 9. Multi-Provider Ladder

**Goal:** Graduate from one-provider smoke to limited live checks without quota burn.

**Files to change:** `scripts/smoke-provider-ladder.js`, `src/core/orchestrator.js`, `tests/integration/provider-ladder.test.js`, `docs/SECURITY_AND_QUOTA.md`.

**Implementation steps:** require one-provider pass, allow qwen/kimi first, add explicit approval, isolate failures, keep Claude/Perplexity excluded.

**Acceptance tests:** ladder refuses before one-provider pass; never starts full seven-provider live; failed provider does not block others.

**Risks:** live testing can multiply quota burn.

**Rollback plan:** remove ladder entrypoint and return to one-provider smoke.

**Exact status names:** `READY_FOR_PROVIDER_LADDER`, `BLOCKED_APPROVAL_REQUIRED`, `BLOCKED_FULL_LIVE_RUN_FORBIDDEN`.

### 10. Dashboard

**Goal:** Show transcript, diagnostics, budgets, health, and traces without mixing public AI replies and diagnostics.

**Files to change:** `src/electron/renderer.js`, `src/electron/preload.js`, `src/electron/main.js`, `docs/ARCHITECTURE.md`.

**Implementation steps:** render transcript and diagnostics separately, expose read-only health/trace summaries, add warning cards outside transcript flow.

**Acceptance tests:** diagnostics cannot enter transcript; UI shows provider state and latest redacted trace summary.

**Risks:** UI can accidentally surface diagnostics as prompt context.

**Rollback plan:** keep dashboard read-only or hide diagnostic panels.

**Exact status names:** `DASHBOARD_READY`, `DASHBOARD_READ_ONLY`, `DASHBOARD_BLOCKED_SECURITY_REVIEW`.

### 11. Human Approval Gates

**Goal:** Keep risky live actions explicit and auditable.

**Files to change:** `scripts/smoke-one-provider.js`, `scripts/smoke-provider-ladder.js`, `coordination/DECISIONS.md`, `docs/SECURITY_AND_QUOTA.md`.

**Implementation steps:** require env confirmations for live smoke, ladder, reset/new-chat, and provider expansion.

**Acceptance tests:** missing confirmation blocks before Electron launch; reports print exact safe command; forbidden providers remain blocked.

**Risks:** env gates can be misread as proof of readiness.

**Rollback plan:** refuse all live modes except doctor until approval wording is clear.

**Exact status names:** `APPROVAL_REQUIRED`, `APPROVAL_CONFIRMED`, `HUMAN_BLOCKED`.

### 12. Packaging / Installer

**Goal:** Package V3 without weakening Electron security or bundling sensitive runtime artifacts.

**Files to change:** `package.json`, packaging config, `src/electron/main.js`, `README.md`, `docs/ARCHITECTURE.md`.

**Implementation steps:** configure packager, exclude reports/traces/logs/user data, verify secure webPreferences, test persistent partitions.

**Acceptance tests:** packaged app launches with secure Electron baseline and no bundled secrets or generated traces.

**Risks:** packaging can alter session partition paths or include generated artifacts.

**Rollback plan:** keep dev mode as supported release path until packaging passes security QA.

**Exact status names:** `PACKAGE_READY`, `PACKAGE_BLOCKED_SECURITY_REVIEW`, `PACKAGE_NOT_STARTED`.

### 13. Final Acceptance Gates

**Goal:** Define the point where V3 can be called complete without overstating live safety.

**Files to change:** `FINAL_STATUS.md`, `docs/CODEX_BUILD_REPORT.md`, `docs/CLAUDE_QA_REPORT.md`, `coordination/CURRENT_STATUS.md`, `coordination/DECISIONS.md`.

**Implementation steps:** require non-live suite pass, Claude QA pass, one-provider live doctor pass, one-provider live smoke pass, redaction audit, and explicit statement of what remains unsafe.

**Acceptance tests:** `npm run test:v3-all` passes; doctor report is `READY`; one-provider report is `PASS`; no secrets in reports/traces; Claude QA signs off; no Claude/Perplexity/full-seven-provider live run occurred.

**Risks:** calling V3 complete before live evidence exists.

**Rollback plan:** set `WAITING_FOR_HUMAN_LIVE_CONFIRMATION` or `NOT_READY` instead of `FINAL_DONE`.

**Exact status names:** `READY_FOR_CLAUDE_QA`, `WAITING_FOR_HUMAN_LIVE_CONFIRMATION`, `READY_FOR_NEXT_STEP`, `NOT_READY`, `HUMAN_BLOCKED`, `FINAL_DONE`.

---

## 2026-05-17 Offline Expansion Status

Codex continued past `WAITING_FOR_HUMAN_LIVE_CONFIRMATION` without contacting live providers.

Completed safe/offline additions:

- Dashboard foundation: `npm run app` opens a local dashboard that reads local status/report/trace files and does not open provider sessions on startup.
- Approval Gate Manager: `LIVE_PROVIDER_DOCTOR`, `ONE_PROVIDER_SMOKE`, `TWO_PROVIDER_SMOKE`, `MULTI_PROVIDER_RUN`, `CLAUDE_LIVE`, `PERPLEXITY_LIVE`, `FULL_7_PROVIDER_LIVE`, `LONG_PROMPT_SEND`, `PROVIDER_RELOAD`, and `SESSION_RESET`.
- Multi-provider fake ladder: `npm run smoke:two-provider`, `npm run smoke:three-provider`, and `npm run smoke:multi-provider`.
- Trace/report viewer: `npm run report:viewer` writes `docs/V3_TRACE_REPORT_VIEWER.html` with redacted summaries only.
- Provider health dashboard data: dashboard state includes health fields from `src/core/provider-health.js`.
- Safe settings scaffold: `src/core/settings-store.js` enforces live-off defaults, blocks Claude/Perplexity live defaults, and disables startup auto-send.
- Packaging readiness docs: `docs/INSTALL_AND_RUN.md` and `docs/TROUBLESHOOTING.md`.
- Final acceptance checklist: `docs/V3_FINAL_ACCEPTANCE_CHECKLIST.md`.

Current next status:

- `READY_FOR_HUMAN_LIVE_DOCTOR` for safe no-prompt qwen Selector Doctor when the human is awake.
- `WAITING_FOR_HUMAN_LIVE_CONFIRMATION` remains the final live status until a real doctor/smoke is confirmed and run.

---

## 2026-05-17 Adversarial Validation Expansion

Completed safely offline:

- V2 session reuse policy: qwen/kimi may reuse the V2 shared Electron partition reference; Claude, ChatGPT, and Perplexity are refused before page open.
- 30-round realistic discussion: `npm run endurance:30`.
- All mode validation: `npm run modes:test` covers podcast, proDiscussion, sequential, debate, criticReview, researchBoard, codeReviewBoard, redTeam, consensus, silentJury, routerMode, and failureRecoveryMode.
- Chaos validation: `npm run chaos:test` exercises prompt echo, briefing echo, thinking leak, UI chrome, challenge, rate-limit, stale duplicate, partial response, fake secret, unsafe instruction, diagnostic-shaped output, provider prefix, error page, and repeated provider failure.
- Problem detector/run analyzer: `src/core/problem-detector.js` and `src/core/run-analyzer.js` detect shallow runs, prompt growth, transcript contamination, forbidden live attempts, secret-shaped artifacts, missing final synthesis, and health gaps.
- Live ladder plan: `scripts/live-mode-validation.js` refuses unsafe live execution and writes a safe report until human-gated qwen/kimi doctor/smoke evidence exists.

Next human-gated status:

- `READY_FOR_QWEN_KIMI_LIVE_LADDER` after Claude QA re-checks the new offline validation suite.
- `WAITING_FOR_HUMAN_LIVE_CONFIRMATION` remains the final status until qwen/kimi live ladder is explicitly confirmed and run.
