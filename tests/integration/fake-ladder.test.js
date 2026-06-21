'use strict';

const {
  assert,
  assertNoDiagnosticsInPrompts,
  assertNoDiagnosticsInTranscript
} = require('../test-utils');
const { runFakeLadder, runFakeLadderStep } = require('../../scripts/smoke-provider-ladder');

async function run() {
  const ladder = await runFakeLadder({ stepName: 'all', cycles: 2 });
  assert.equal(ladder.ok, true);
  assert.deepEqual(ladder.results.map((entry) => entry.stepName), ['one', 'two', 'three', 'five', 'seven']);

  for (const step of ladder.results) {
    assertNoDiagnosticsInTranscript(step.report);
    assertNoDiagnosticsInPrompts(step.providers);
    for (const ledgerEntry of step.report.promptLedger) {
      assert.equal(ledgerEntry.sentPrompts[0].promptMode, 'briefing');
      assert.equal(ledgerEntry.sentPrompts[1].promptMode, 'delta');
      assert.equal(ledgerEntry.sentPrompts[1].promptChars <= 12000, true);
    }
    assert.equal(step.report.health.length, step.providerIds.length);
  }

  const failureStep = await runFakeLadderStep({
    stepName: 'two',
    cycles: 1,
    modes: { kimi: 'timeout' }
  });
  assert.equal(failureStep.report.results.some((result) => result.providerId === 'qwen' && result.ok), true);
  assert.equal(failureStep.report.results.some((result) => result.providerId === 'kimi' && !result.ok), true);
  assert.equal(failureStep.report.health.find((entry) => entry.providerId === 'kimi').consecutiveFailures, 1);
  assertNoDiagnosticsInTranscript(failureStep.report);

  console.log('PASS fake ladder: one/two/three/five/seven-provider offline orchestration is safe');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
