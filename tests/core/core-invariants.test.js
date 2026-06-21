'use strict';

const {
  assert,
  DEFAULT_PROVIDER_IDS,
  makeFakeProviders,
  makeOrchestrator,
  countOccurrences,
  assertNoDiagnosticsInTranscript,
  assertNoDiagnosticsInPrompts
} = require('../test-utils');

async function run() {
  const providers = makeFakeProviders(DEFAULT_PROVIDER_IDS, 'clean');
  const orchestrator = makeOrchestrator(providers);
  const report = await orchestrator.run({
    userMessage: 'Discuss the safest V3 architecture in one short answer each.',
    cycles: 4
  });

  assert.equal(report.diagnostics.length, 0, 'clean fake run should not create diagnostics');
  assert.equal(report.transcript.filter((entry) => entry.role === 'user').length, 1);
  assert.equal(report.transcript.filter((entry) => entry.role === 'ai').length, 28);
  assertNoDiagnosticsInTranscript(report);
  assertNoDiagnosticsInPrompts(providers);

  for (const provider of providers) {
    assert.equal(provider.sentPrompts.length, 4, `${provider.id} should receive one prompt per cycle`);
    const briefingCount = provider.sentPrompts.reduce((sum, prompt) => {
      return sum + countOccurrences(prompt.text, '[AI TEAM SESSION BRIEFING]');
    }, 0);
    assert.equal(briefingCount, 1, `${provider.id} should receive briefing once only`);
    assert.equal(provider.sentPrompts[0].text.includes('[AI TEAM SESSION BRIEFING]'), true);
    for (const laterPrompt of provider.sentPrompts.slice(1)) {
      assert.equal(laterPrompt.text.includes('[AI TEAM SESSION BRIEFING]'), false);
      assert.equal(laterPrompt.text.includes('[AI TEAM DELTA TURN]'), true);
    }
    const sequence = report.traces
      .filter((entry) => entry.providerId === provider.id && entry.type === 'STATE_TRANSITION')
      .map((entry) => entry.toState);
    for (const requiredState of [
      'PREPARING_PROMPT',
      'BUDGET_CHECK',
      'READY_TO_SEND',
      'SENDING',
      'SEND_VERIFIED',
      'WAITING_RESPONSE',
      'CAPTURE_CANDIDATE',
      'NORMALIZING_RESPONSE',
      'CAPTURED',
      'COOLDOWN'
    ]) {
      assert.equal(sequence.includes(requiredState), true, `${provider.id} missing ${requiredState}`);
    }
  }

  console.log('PASS core invariants: fake 7-provider 4-cycle discussion completed safely');
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
