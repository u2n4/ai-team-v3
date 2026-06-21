# V3 Mode And Chaos Test Plan

Status: IMPLEMENTED_OFFLINE

This plan defines the room modes and adversarial behaviors used by `npm run modes:test`, `npm run endurance:30`, and `npm run chaos:test`. All tests are offline. Fake ChatGPT, Claude, and Perplexity participants are allowed only as simulators.

## Modes

| Mode | Purpose | Expected flow | Acceptance tests | Bugs this mode should reveal |
|---|---|---|---|---|
| podcast | All AIs discuss freely without strict roles. | Open discussion, cross-response, host synthesis. | 5 rounds, injected failure, turn-taking marker, final synthesis, clean transcript. | Prompt explosion, stale capture, UI contamination. |
| proDiscussion | Sequence -> free discussion -> final summary. | Ordered first pass, free discussion, summary. | Professional summary marker, diagnostics separation, final verdict. | Delta-only and mode-flow violations. |
| sequential | AI1 responds, AI2 reacts, then each next provider reacts. | qwen first, kimi reaction, others, synthesis. | Sequence-step marker, ordered reactions, synthesis. | Provider stuck waiting, infinite retry loops. |
| debate | Two sides argue opposing viewpoints. | Pro, con, rebuttal, judge summary. | `position: pro` and `position: con` appear in accepted public output. | Missing disagreement handling. |
| criticReview | One AI proposes, others critique. | Proposal, security critique, test critique, fix summary. | Review/critic marker and final verdict. | Firewall and detector gaps. |
| researchBoard | AIs compare evidence and synthesize. | Hypothesis, evidence comparison, risk grading, synthesis. | Citation/reference-shaped marker and synthesis. | Stale duplicate accepted as evidence. |
| codeReviewBoard | One AI proposes code, others review architecture/security/tests. | Code proposal, architecture review, security review, test review, decision. | Diff/patch-shaped block and review marker. | Fake secret or unsafe patch accepted. |
| redTeam | One AI attacks assumptions, others defend/fix. | Attack, defense, patch proposal, residual risk. | Risk/fix marker and unsafe-instruction rejection. | Approval gate bypass, unsafe instruction leak. |
| consensus | AIs must agree on final decision and list disagreements. | Positions, merge, disagreements, final decision. | Consensus and disagreements markers. | Consensus missing or silent disagreement. |
| silentJury | AIs respond independently first, then compare. | Independent answers, comparison, combined verdict. | Independent marker and jury verdict marker. | Prompt echo and delta context bugs. |
| routerMode | Orchestrator decides which providers receive which task. | Route decision, selected provider responses, skipped diagnostics, summary. | Route and selected-provider markers. | Budget waste and quota burn. |
| failureRecoveryMode | One or more providers fail and the room continues. | Failure injection, diagnostic isolation, continuation, recovery verdict. | Recovery summary marker and continued output after failures. | Failure isolation and quota-guard regressions. |

## Chaos Injections

The validation suite injects provider timeout, empty response, prompt echo, repeated `SESSION_BRIEFING`, hidden thinking-only response, UI chrome, CAPTCHA/challenge text, rate-limit text, duplicate stale response, partial streaming response, very long response, contradiction, unsafe bypass/cookie-export instruction, diagnostic-shaped response, off-topic output, Arabic/English mixed output, malformed markdown, fake secret in a code block, late/failing provider disablement, and stale capture risk.

## Required Proofs

- contaminants are rejected before transcript insertion
- diagnostics never enter public transcript
- prompt echo and briefing echo are rejected
- hidden thinking is stripped or rejected
- stale duplicates are rejected
- partial responses are not accepted as final
- failed providers do not stop the room
- health score changes correctly
- quota guard disables repeated failing/limited providers
- final synthesis is produced
- prompt budget stays bounded
- `SESSION_BRIEFING` is sent once per provider
- later turns are delta-only

## Commands

```powershell
Set-Location -LiteralPath 'C:\path\to\ai-team-v3'
npm run endurance:30
npm run modes:test
npm run chaos:test
npm run validate:offline-real
```
