'use strict';

const {
  assert,
  FakeProvider,
  makeOrchestrator,
  assertNoDiagnosticsInTranscript
} = require('../test-utils');

async function run() {
  const provider = new FakeProvider({
    id: 'claude',
    name: 'Claude',
    mode: 'clean'
  });
  const orchestrator = makeOrchestrator([provider]);
  const hugePrompt = 'x'.repeat(20000);
  const report = await orchestrator.run({
    userMessage: hugePrompt,
    cycles: 1
  });

  assert.equal(provider.sentPrompts.length, 0, 'over-budget prompt must be blocked before send');
  assert.equal(report.diagnostics.some((entry) => entry.code === 'PROMPT_OVER_BUDGET'), true);
  assert.equal(report.quota[0].sendCount, 0, 'blocked prompt should not count as a provider send');
  assert.equal(report.transcript.filter((entry) => entry.role === 'ai').length, 0);
  assertNoDiagnosticsInTranscript(report);

  const budgetTrace = report.traces.find((entry) => entry.type === 'PROMPT_BUDGET_CHECK');
  assert.equal(Boolean(budgetTrace), true);
  assert.equal(budgetTrace.meta.promptChars > 8000, true);
  assert.equal(budgetTrace.meta.providerId, 'claude');

  console.log('PASS budget guard: 20K prompt simulation blocked before send');
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
