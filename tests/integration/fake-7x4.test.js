'use strict';

const {
  assert,
  DEFAULT_PROVIDER_IDS,
  makeFakeProviders,
  makeOrchestrator,
  assertNoDiagnosticsInTranscript
} = require('../test-utils');

async function run() {
  const providers = makeFakeProviders(DEFAULT_PROVIDER_IDS, 'clean');
  const report = await makeOrchestrator(providers).run({
    userMessage: 'Run the required fake 7 provider 4 cycle gate.',
    cycles: 4
  });

  assert.equal(report.transcript.filter((entry) => entry.role === 'ai').length, 28);
  assert.equal(report.diagnostics.length, 0);
  assertNoDiagnosticsInTranscript(report);

  for (const ledgerEntry of report.promptLedger) {
    assert.equal(ledgerEntry.sentPrompts.length, 4);
    assert.equal(ledgerEntry.sentPrompts[0].promptMode, 'briefing');
    assert.deepEqual(ledgerEntry.sentPrompts.slice(1).map((entry) => entry.promptMode), ['delta', 'delta', 'delta']);
    for (const sentPrompt of ledgerEntry.sentPrompts) {
      assert.equal(sentPrompt.promptChars <= 12000, true, `${ledgerEntry.providerId} prompt exceeded default fake cap`);
    }
  }

  console.log('PASS fake-7x4: required 7-provider 4-cycle fake gate is clean');
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
