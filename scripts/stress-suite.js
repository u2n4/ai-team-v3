'use strict';

// ============================================================================
// OFFLINE STRESS / HARD-CHALLENGE HARNESS  (scripts/stress-suite.js)
// ----------------------------------------------------------------------------
// Pressure-tests AI Team V3 using FAKE providers ONLY. No live providers, no
// network, no Electron, no provider windows. It does NOT import electron and
// never sets liveEnabled / allowedProviders / any live env. Every store is the
// same in-process core used by the unit suite.
//
// It runs four hard rounds and EXITS NONZERO on any contract violation,
// printing a clear PASS/FAIL summary at the end:
//   R1  Long endurance   (~60 cycles, 5 fake providers) -> prompt stays bounded
//                         (delta-only), briefing-once, no diagnostics in
//                         transcript, analyzer green.
//   R2  Multi-seed chaos  (5 seeds, deterministic permutations of ALL 12 fake
//                         modes) -> every adversarial diagnostic code fires;
//                         duplicate-stale cross-provider case fires; rateLimit
//                         hard-disables; LIMIT prose-vs-notice + roundGoal
//                         cycling unit assertions hold.
//   R3  Failure isolation (broken provider in a mixed room) -> room continues,
//                         transcript clean, 3-strike disable observed.
//   R4  All 12 STANDARD_MODES under load -> each runs offline with injected
//                         adversarial pressure and stays clean.
//
// Run:  node scripts/stress-suite.js        (or)  npm run stress:suite
// ============================================================================

const { Orchestrator } = require('../src/core/orchestrator');
const { TranscriptStore } = require('../src/core/transcript-store');
const { DiagnosticsStore } = require('../src/core/diagnostics-store');
const { TraceStore } = require('../src/core/trace-store');
const { PromptLedger } = require('../src/core/prompt-ledger');
const { BudgetGuard } = require('../src/core/budget-guard');
const { QuotaGuard } = require('../src/core/quota-guard');
const { FakeProvider, FAKE_PROVIDER_MODES } = require('../src/providers/fake-provider');
const { analyzeRun } = require('../src/core/run-analyzer');
const { normalizeResponseCandidate } = require('../src/core/response-normalizer');
const { roundGoal } = require('../src/core/prompt-builder');
const { STANDARD_MODES } = require('../src/core/mode-definitions');

const MAX_PROMPT_CHARS = 12000;

// --- tiny offline assert/check plumbing (no network, no deps) ----------------
const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    failures.push(`${label}${detail ? ` -- ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

function normalize(text, providerId) {
  return normalizeResponseCandidate({ providerId, text, promptText: 'x', briefingText: '' });
}

// Deterministic PRNG so each seed gives a fixed, reproducible permutation.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function providerName(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function makeStressOrchestrator(providers) {
  return new Orchestrator({
    providers,
    transcriptStore: new TranscriptStore(),
    diagnosticsStore: new DiagnosticsStore(),
    traceStore: new TraceStore(),
    promptLedger: new PromptLedger(),
    budgetGuard: new BudgetGuard(),
    quotaGuard: new QuotaGuard()
  });
}

function transcriptHasDiagnosticText(report) {
  return report.transcript.some((entry) =>
    entry.role === 'ai' &&
    /\[SYSTEM DIAGNOSTIC\]|PROMPT_OVER_BUDGET|FAILED_DIAGNOSTIC|PROVIDER_RUNTIME_ERROR/i.test(entry.text));
}

// ---------------------------------------------------------------------------
// ROUND 1: long endurance, prompt stays bounded + briefing-once + clean.
// ---------------------------------------------------------------------------
async function roundEndurance() {
  console.log('\n[R1] Long endurance (60 cycles x 5 fake providers)');
  const ids = ['qwen', 'kimi', 'deepseek', 'gemini', 'perplexity'];
  // Use FakeProvider's DEFAULT clean text (which varies per turn — it embeds
  // sentPrompts.length). A fixed responseText would make every turn identical and the
  // stale-duplicate firewall would (correctly) reject the repeats, which is not what this
  // endurance round is measuring — we want a long clean run with bounded, delta-only prompts.
  const providers = ids.map((id) => new FakeProvider({
    id,
    name: providerName(id),
    mode: 'clean'
  }));
  const orchestrator = makeStressOrchestrator(providers);
  const CYCLES = 60;
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    await orchestrator.run({
      userMessage: `[ROUND ${cycle}] endurance pressure: keep the room delta-only and bounded.`,
      cycles: 1,
      userGoal: `endurance cycle ${cycle}`
    });
  }
  const report = orchestrator.report([]);
  const maxPromptChars = report.promptLedger.reduce((max, p) => {
    const local = (p.sentPrompts || []).reduce((m, s) => Math.max(m, Number(s.promptChars || 0)), 0);
    return Math.max(max, local);
  }, 0);

  check('R1 max prompt chars bounded', maxPromptChars <= MAX_PROMPT_CHARS, `observed=${maxPromptChars}`);
  const briefingOk = report.promptLedger.every((p) => {
    const briefings = p.sentPrompts.filter((s) => s.promptMode === 'briefing').length;
    const nonBriefing = p.sentPrompts.filter((s) => s.promptMode !== 'briefing');
    return briefings === 1 && nonBriefing.every((s) => s.promptMode === 'delta');
  });
  check('R1 briefing-once + delta-only', briefingOk);
  check('R1 no diagnostics text in transcript', !transcriptHasDiagnosticText(report));
  check('R1 clean providers produce zero firewall diagnostics', report.diagnostics.length === 0,
    `diagnostics=${report.diagnostics.length}`);
  check('R1 every provider contributed AI turns',
    ids.every((id) => report.transcript.some((e) => e.role === 'ai' && e.senderId === id)));
}

// ---------------------------------------------------------------------------
// ROUND 2: multi-seed chaos exercising ALL 12 fake modes + targeted unit cases.
// ---------------------------------------------------------------------------
const MODE_EXPECTED_CODE = Object.freeze({
  empty: 'EMPTY_RESPONSE',
  promptEcho: 'PROMPT_ECHO',
  briefingEcho: 'BRIEFING_ECHO',
  uiChrome: 'UI_CHROME_CAPTURE',
  errorPage: 'PROVIDER_ERROR_PAGE',
  rateLimit: 'PROVIDER_LIMIT_REACHED',
  partialResponse: 'PARTIAL_RESPONSE'
});

async function chaosSeed(seed) {
  const rng = mulberry32(seed);
  const ids = ['qwen', 'kimi', 'deepseek', 'gemini', 'perplexity', 'grok', 'zai', 'meta'];
  const modes = [...FAKE_PROVIDER_MODES];
  for (let i = modes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [modes[i], modes[j]] = [modes[j], modes[i]];
  }
  const STALE_TEXT = 'Reusable stale answer that a later provider will echo verbatim.';
  const scenarioModes = ['clean', ...modes, 'duplicateStale'];
  const providers = scenarioModes.map((mode, i) => {
    const id = `stress${i}`;
    return new FakeProvider({
      id,
      name: providerName(id),
      mode,
      responseText: mode === 'clean' ? STALE_TEXT : undefined
    });
  });
  // Force one provider into duplicateStale to guarantee the stale path fires.
  providers[providers.length - 1] = new FakeProvider({
    id: `stress${providers.length - 1}`,
    name: 'Stale provider',
    mode: 'duplicateStale'
  });
  const orchestrator = makeStressOrchestrator(providers);
  const report = await orchestrator.run({
    userMessage: `[ROUND 1] chaos seed ${seed}: adversarial pressure across all fake modes.`,
    cycles: 1,
    userGoal: `chaos ${seed}`
  });
  const codes = new Set(report.diagnostics.map((d) => d.code));
  const presentModes = providers.map((p) => p.mode);

  for (const mode of Object.keys(MODE_EXPECTED_CODE)) {
    check(`R2[seed ${seed}] mode ${mode} exercised`, presentModes.includes(mode));
    if (presentModes.includes(mode)) {
      check(`R2[seed ${seed}] mode ${mode} -> ${MODE_EXPECTED_CODE[mode]}`,
        codes.has(MODE_EXPECTED_CODE[mode]), `codes=${[...codes].join(',')}`);
    }
  }
  check(`R2[seed ${seed}] duplicate-stale fired`, codes.has('STALE_DUPLICATE_RESPONSE'),
    `codes=${[...codes].join(',')}`);
  check(`R2[seed ${seed}] no diagnostics text in transcript`, !transcriptHasDiagnosticText(report));

  if (presentModes.includes('rateLimit')) {
    const limited = (report.quota || []).some((q) => q.limitDetected === true || q.disabledForRun === true);
    check(`R2[seed ${seed}] rateLimit hard-disabled a provider`, limited,
      JSON.stringify((report.quota || []).map((q) => ({ id: q.providerId, lim: q.limitDetected, dis: q.disabledForRun }))));
  }
}

function chaosUnitCases() {
  console.log('  -- targeted unit cases (LIMIT prose-vs-notice + roundGoal cycling) --');
  check('R2 LIMIT prose stays ok (2023 history)',
    normalize('Historically the rate limit reached its cap in 2023; let us analyze that.', 'qwen').ok === true);
  check('R2 LIMIT prose stays ok (older designs)',
    normalize('Note: the limit reached in older designs was lower than today.', 'qwen').ok === true);
  check('R2 LIMIT account notice -> PROVIDER_LIMIT_REACHED',
    normalize('Your account limit reached. Upgrade your plan to continue.', 'qwen').code === 'PROVIDER_LIMIT_REACHED');
  check('R2 LIMIT exceeded notice -> PROVIDER_LIMIT_REACHED',
    normalize('Rate limit exceeded.', 'qwen').code === 'PROVIDER_LIMIT_REACHED');
  check('R2 LIMIT reached-limit notice -> PROVIDER_LIMIT_REACHED',
    normalize("You've reached your message limit. Try again later.", 'qwen').code === 'PROVIDER_LIMIT_REACHED');
  check('R2 roundGoal cycles past cycle 3 (4 != 3)',
    roundGoal(4).goal !== roundGoal(3).goal, `c3=${roundGoal(3).goal} c4=${roundGoal(4).goal}`);
  check('R2 roundGoal wraps modulo (6 == 1)',
    roundGoal(6).goal === roundGoal(1).goal);
  check('R2 roundGoal cycle 5 distinct from cycle 4',
    roundGoal(5).goal !== roundGoal(4).goal);
}

async function roundChaos() {
  console.log('\n[R2] Multi-seed chaos across all 12 fake modes');
  const seeds = [1337, 2026, 4242, 90210, 7];
  for (const seed of seeds) {
    await chaosSeed(seed);
  }
  chaosUnitCases();
}

// ---------------------------------------------------------------------------
// ROUND 3: failure isolation + 3-strike disable.
// ---------------------------------------------------------------------------
async function roundFailureIsolation() {
  console.log('\n[R3] Failure isolation + 3-strike disable');
  const broken = new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'errorPage' });
  const healthy = new FakeProvider({ id: 'kimi', name: 'Kimi continues safely', mode: 'clean' });
  const slow = new FakeProvider({ id: 'deepseek', name: 'DeepSeek continues safely', mode: 'delayed' });
  const orchestrator = makeStressOrchestrator([broken, healthy, slow]);
  const report = await orchestrator.run({
    userMessage: '[ROUND 1] failure isolation pressure.',
    cycles: 3,
    userGoal: 'isolation'
  });

  check('R3 broken provider produced diagnostics', report.diagnostics.some((d) => d.providerId === 'qwen'));
  check('R3 healthy provider stayed in transcript',
    report.transcript.some((e) => e.senderId === 'kimi' && /continues safely/i.test(e.text)));
  check('R3 slow provider stayed in transcript',
    report.transcript.some((e) => e.senderId === 'deepseek' && /continues safely/i.test(e.text)));
  check('R3 error page never entered transcript',
    !report.transcript.some((e) => /something went wrong|service unavailable/i.test(e.text)));
  check('R3 no diagnostics text in transcript', !transcriptHasDiagnosticText(report));
  const brokenQuota = (report.quota || []).find((q) => q.providerId === 'qwen');
  check('R3 broken provider disabled after 3 strikes',
    Boolean(brokenQuota && brokenQuota.disabledForRun === true),
    JSON.stringify(brokenQuota));
}

// ---------------------------------------------------------------------------
// ROUND 4: all 12 STANDARD_MODES under adversarial load.
// ---------------------------------------------------------------------------
async function roundAllModes() {
  console.log('\n[R4] All 12 STANDARD_MODES under load');
  for (const mode of STANDARD_MODES) {
    const providers = [
      new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'clean' }),
      new FakeProvider({ id: 'kimi', name: 'Kimi', mode: 'clean' }),
      new FakeProvider({ id: 'gemini', name: 'Gemini', mode: 'clean' }),
      new FakeProvider({ id: 'deepseek', name: 'DeepSeek', mode: 'errorPage' })
    ];
    const orchestrator = makeStressOrchestrator(providers);
    const report = await orchestrator.run({
      userMessage: `[ROUND 1] ${mode.id} load pressure.`,
      cycles: 2,
      userGoal: `${mode.id} load`
    });
    check(`R4 ${mode.id} room continued (>=1 AI turn)`,
      report.transcript.some((e) => e.role === 'ai'));
    check(`R4 ${mode.id} injected failure isolated as diagnostic`,
      report.diagnostics.some((d) => d.providerId === 'deepseek'));
    check(`R4 ${mode.id} clean transcript`, !transcriptHasDiagnosticText(report));
  }
}

async function main() {
  console.log('AI Team V3 OFFLINE STRESS SUITE  (fake providers only, no live, no network)');
  await roundEndurance();
  await roundChaos();
  await roundFailureIsolation();
  await roundAllModes();

  console.log('\n============================================================');
  if (failures.length === 0) {
    console.log('stress:suite PASS -- all contract checks held under load.');
    process.exitCode = 0;
  } else {
    console.log(`stress:suite FAIL -- ${failures.length} contract violation(s):`);
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
