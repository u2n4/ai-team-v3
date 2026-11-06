'use strict';

const { detectProblems } = require('./problem-detector');

function pass(id, message, details = {}) {
  return { id, status: 'PASS', message, details };
}

function fail(id, message, details = {}) {
  return { id, status: 'FAIL', message, details };
}

function partial(id, message, details = {}) {
  return { id, status: 'PARTIAL', message, details };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function providersWithSentPrompts(promptLedger = []) {
  return asArray(promptLedger)
    .filter((entry) => asArray(entry.sentPrompts).length > 0)
    .map((entry) => entry.providerId);
}

function analyzeRun(report = {}, {
  expectedRounds = 0,
  requiredRoundLabels = [],
  requireFinalSynthesis = false,
  providerIds = [],
  maxPromptChars = 12000,
  minAiTurns = 1,
  maxConsecutiveFailures = 3,
  mode = 'unknown'
} = {}) {
  const transcript = asArray(report.transcript);
  const diagnostics = asArray(report.diagnostics);
  const promptLedger = asArray(report.promptLedger);
  const health = asArray(report.health);
  const checks = [];

  const userRounds = transcript.filter((entry) => entry.role === 'user' && /\[ROUND\s+\d+\]/i.test(entry.text));
  if (expectedRounds > 0) {
    checks.push(userRounds.length >= expectedRounds
      ? pass('round-count', `Observed ${userRounds.length}/${expectedRounds} rounds.`)
      : fail('round-count', `Only observed ${userRounds.length}/${expectedRounds} rounds.`));
  }

  const allText = transcript.map((entry) => entry.text).join('\n');
  const missingLabels = requiredRoundLabels.filter((label) => !allText.includes(label));
  checks.push(missingLabels.length === 0
    ? pass('stateful-round-labels', 'Round labels are reflected in transcript.')
    : fail('stateful-round-labels', 'Some required round labels are missing from transcript.', { missingLabels }));

  const aiTurns = transcript.filter((entry) => entry.role === 'ai');
  checks.push(aiTurns.length >= minAiTurns
    ? pass('ai-turns', `Observed ${aiTurns.length} accepted AI turns.`)
    : fail('ai-turns', `Only observed ${aiTurns.length} accepted AI turns.`, { minAiTurns }));

  const problems = detectProblems(report, {
    maxPromptChars,
    requireFinalSynthesis,
    providerIds
  });
  const failedProblems = problems.filter((problem) => problem.severity !== 'info');
  checks.push(failedProblems.length === 0
    ? pass('problem-detector', 'No transcript, prompt, live, or health problems detected.')
    : fail('problem-detector', 'Problem detector found validation failures.', { problems: failedProblems }));

  const briefingViolations = problems.filter((problem) => problem.code === 'REPEATED_BRIEFING');
  checks.push(briefingViolations.length === 0
    ? pass('briefing-once', 'SESSION_BRIEFING was sent at most once per provider.')
    : fail('briefing-once', 'Repeated SESSION_BRIEFING detected.', { briefingViolations }));

  const deltaViolations = problems.filter((problem) => problem.code === 'DELTA_ONLY_VIOLATION');
  checks.push(deltaViolations.length === 0
    ? pass('delta-only', 'Later provider prompts are delta-only.')
    : fail('delta-only', 'Delta-only invariant was violated.', { deltaViolations }));

  const promptSizes = promptLedger.flatMap((entry) => asArray(entry.sentPrompts).map((prompt) => prompt.promptChars || 0));
  const maxObservedPromptChars = promptSizes.length > 0 ? Math.max(...promptSizes) : 0;
  checks.push(maxObservedPromptChars <= maxPromptChars
    ? pass('prompt-budget', `Max observed prompt chars ${maxObservedPromptChars}/${maxPromptChars}.`)
    : fail('prompt-budget', `Max observed prompt chars ${maxObservedPromptChars}/${maxPromptChars}.`));

  const disabled = asArray(report.quota).filter((entry) => entry.disabledForRun === true || entry.limitDetected === true);
  const uncontained = asArray(report.quota).filter((entry) =>
    (entry.limitDetected === true || entry.consecutiveFailures >= maxConsecutiveFailures) && entry.disabledForRun !== true);
  checks.push(uncontained.length > 0
    ? fail('quota-failure-tracking', 'Failing/limited providers remained enabled.', { providers: uncontained.map(entry => entry.providerId) })
    : disabled.length > 0
    ? pass('quota-failure-tracking', 'Quota guard disabled repeated failing/limited providers.', { disabled: disabled.map((entry) => entry.providerId) })
    : pass('quota-failure-tracking', diagnostics.length > 0
      ? 'Single injected failures stayed isolated below the disable threshold.'
      : 'No provider failures occurred.'));

  const healthProviders = health.map((entry) => entry.providerId);
  const expectedHealth = providerIds.filter((providerId) => providersWithSentPrompts(promptLedger).includes(providerId));
  const missingHealth = expectedHealth.filter((providerId) => !healthProviders.includes(providerId));
  checks.push(missingHealth.length === 0
    ? pass('health-updated', 'Provider health was updated for active providers.')
    : fail('health-updated', 'Provider health is missing for active providers.', { missingHealth }));

  if (requireFinalSynthesis) {
    const aiText = aiTurns.map((entry) => entry.text).join('\n');
    checks.push(/FINAL_(READINESS_)?VERDICT|FINAL SYNTHESIS|final decision/i.test(aiText)
      ? pass('final-synthesis', 'Final synthesis/verdict was produced.')
      : fail('final-synthesis', 'Final synthesis/verdict is missing.'));
  }

  const failingChecks = checks.filter((check) => check.status === 'FAIL');
  const partialChecks = checks.filter((check) => check.status === 'PARTIAL');
  return {
    ok: failingChecks.length === 0,
    mode,
    status: failingChecks.length === 0 ? (partialChecks.length === 0 ? 'PASS' : 'PARTIAL') : 'FAIL',
    checks,
    problems,
    metrics: {
      transcriptTurns: transcript.length,
      aiTurns: aiTurns.length,
      diagnostics: diagnostics.length,
      promptLedgerProviders: promptLedger.length,
      maxObservedPromptChars,
      disabledProviders: disabled.map((entry) => entry.providerId)
    }
  };
}

function assertAnalysisPass(analysis) {
  if (!analysis.ok) {
    const failed = analysis.checks
      .filter((check) => check.status === 'FAIL')
      .map((check) => `${check.id}: ${check.message}`)
      .join('; ');
    throw new Error(`Run analysis failed: ${failed}`);
  }
  return analysis;
}

module.exports = {
  analyzeRun,
  assertAnalysisPass
};
