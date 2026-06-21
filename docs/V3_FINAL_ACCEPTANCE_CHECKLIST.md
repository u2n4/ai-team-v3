# AI Team V3 — Final Acceptance Checklist

**Date:** 2026-06-21 (updated for D20)
**Current verdict:** offline-safe work is passing (`npm run test:v3-all` = 37/37; offline stress suite + endurance/modes/chaos all pass); all live gates remain human-gated. Per D20 the room policy live-allows every provider EXCEPT chatgpt and claude; the one-provider smoke, Selector Doctor, and live ladder stay strict to qwen/kimi.

| Gate | Status | Evidence / command |
|---|---|---|
| Cleanup audit | PASS | `docs/CLEANUP_AUDIT.md` |
| Core architecture | PASS | `src/core/*` |
| Fake provider modes | PASS | `tests/providers/transcript-firewall.test.js` |
| Prompt budget | PASS | `npm run test:v3-budget` |
| 20K prompt simulation blocked | PASS | `tests/core/budget-guard.test.js` |
| Delta-only context | PASS | `npm run test:v3-delta` |
| Briefing once | PASS | `tests/core/core-invariants.test.js` |
| Transcript firewall | PASS | `npm run test:v3-firewall` |
| Diagnostics separation | PASS | `tests/core/api-contracts.test.js` |
| Failure isolation | PASS | `npm run test:v3-failure` |
| Quota guard | PASS | `npm run test:v3-quota` |
| Provider contracts | PASS | `tests/providers/provider-contract.test.js` |
| Selector Doctor implementation | PASS | `tests/integration/selector-doctor.test.js` |
| Live Selector Doctor against qwen | HUMAN-GATED | `npm run doctor:provider -- qwen` |
| One-provider live smoke qwen | HUMAN-GATED | `AI_TEAM_V3_CONFIRM_SAFE_SESSION=1 npm run smoke:one-provider` |
| Kimi fallback live smoke | HUMAN-GATED | Run only if qwen is unavailable and human confirms |
| Two-provider fake smoke | PASS | `npm run smoke:two-provider` |
| Three-provider fake smoke | PASS | `npm run smoke:three-provider` |
| Multi-provider fake ladder | PASS | `npm run smoke:multi-provider` |
| Dashboard foundation | PASS | `npm run app`; local-only startup; covered by `dashboard-state.test.js` |
| Provider health dashboard data | PASS | `src/core/provider-health.js`, `dashboard-state.test.js` |
| Approval gates | PASS | `tests/core/approval-gate-manager.test.js` |
| Logging/redaction | PASS | `tests/core/report-viewer.test.js`, CDP redaction tests |
| Trace/report viewer | PASS | `npm run report:viewer` |
| V2 qwen/kimi session reuse policy | PASS | `tests/providers/provider-session-policy.test.js`; partition reference only, no cookies read |
| 30-round realistic offline endurance | PASS | `npm run endurance:30`; `docs/ENDURANCE_30_REAL_DISCUSSION_REPORT.md` |
| All 12 room modes offline | PASS | `npm run modes:test`; `docs/ALL_MODES_TEST_REPORT.md` |
| Chaos/adversarial validation | PASS | `npm run chaos:test`; seeded 50-iteration diagnostic coverage |
| Problem detector / run analyzer | PASS | `tests/core/problem-detector.test.js`, `tests/core/run-analyzer.test.js` |
| Live ladder gate script | PASS | `tests/integration/live-mode-validation.test.js`; live execution remains human-gated |
| Safe settings defaults | PASS | `tests/core/settings-store.test.js` |
| Packaging readiness docs | PASS | `docs/INSTALL_AND_RUN.md`, `docs/TROUBLESHOOTING.md` |
| Production installer | TODO | No installer created yet |
| Live two-provider smoke | TODO | Requires one-provider live pass and a new explicit approval gate |
| Full seven-provider live run | HUMAN-GATED / FORBIDDEN NOW | Must not run in current phase |
| ChatGPT live | FORBIDDEN (before page open) | D20: refused before any page opens; never run |
| Claude live | FORBIDDEN (before page open) | D20: refused before any page opens; never run |
| Perplexity live | LIVE-ALLOWED / HUMAN-GATED | D20: room-allowed; not part of the qwen/kimi first gate, needs its own explicit approval |
| Rollback gate | PASS | Live blockers write reports and stop without retrying |

## Final Acceptance Rule

Do not set `FINAL_DONE` until:

- all offline gates pass,
- live qwen or kimi Selector Doctor passes,
- one-provider live smoke passes,
- redaction audit passes after live traces,
- Claude QA signs off,
- human explicitly says the project is finished.
