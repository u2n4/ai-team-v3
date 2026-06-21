# V3 Realistic Validation Scorecard

Status: OFFLINE_REALISTIC_VALIDATION_PASS

| Area | Score | Evidence |
|---|---|---|
| Core orchestration | PASS | `npm run test:v3-all`; 30-round run produced 177 transcript turns and 147 accepted AI turns. |
| Prompt safety | PASS | Briefing-once and delta-only checks pass; max observed prompt size was 3831 chars. |
| Transcript safety | PASS | Firewall rejected prompt echo, briefing echo, thinking-only, UI chrome, challenge, rate-limit, stale duplicate, partial, fake secret, unsafe instruction, diagnostic-shaped text, provider prefix, and error page. |
| Provider failure handling | PASS | Deepseek-like timeout was isolated and disabled for run; remaining providers continued to final synthesis. |
| Mode correctness | PASS | 12 modes each ran 5 offline rounds with mode-specific acceptance markers. |
| Dashboard readiness | PASS | Dashboard foundation and state generation are tested; it does not contact providers on startup. |
| Live readiness | HUMAN-GATED | qwen/kimi doctor and smoke are implemented but not run live by Codex. |
| Security/redaction | PASS | Reports/traces are metadata-only; tests reject secret-shaped artifacts. |
| Session reuse policy | PASS | qwen/kimi may reuse the V2 shared Electron partition reference; Claude/ChatGPT/Perplexity are blocked before open. |
| Human approval gates | PASS | Live smoke and live ladder require explicit env confirmation and human approval. |
| Regression coverage | PASS | `npm run test:v3-all` covers 32 tests including endurance, modes, chaos, live gates, and V2 session policy. |
| Packaging readiness | PARTIAL | Install/run and troubleshooting docs exist; production installer is not built. |

## Test Mapping

| Claim | Test |
|---|---|
| 30 rounds are stateful and produce final synthesis | `tests/endurance-30-real-discussion.test.js` |
| all 12 modes run with clean transcript | `tests/all-modes.test.js` |
| chaos classes are exercised | `tests/chaos-validation.test.js` |
| shallow runs and leaks are detected | `tests/core/problem-detector.test.js` |
| good/bad reports are scored correctly | `tests/core/run-analyzer.test.js` |
| mode metadata and criteria exist | `tests/core/mode-definitions.test.js` |
| qwen/kimi V2 session policy is safe | `tests/providers/provider-session-policy.test.js` |
| live ladder refuses unsafe runs | `tests/integration/live-mode-validation.test.js` |

## Not 100% Yet

Do not claim 100% complete until qwen and kimi live Selector Doctor pass, qwen/kimi one-provider smoke pass, qwen+kimi 3-message/10-message/30-message live discussions pass, live artifacts pass redaction audit, Claude QA signs off, and the human explicitly authorizes final completion.
