'use strict';

const {
  assert,
  FakeProvider,
  makeOrchestrator,
  assertNoDiagnosticsInTranscript,
  assertNoDiagnosticsInPrompts
} = require('../test-utils');

async function run() {
  const broken = new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'errorPage' });
  const healthy = new FakeProvider({ id: 'kimi', name: 'Kimi', mode: 'clean', responseText: 'Kimi continues safely.' });
  const delayed = new FakeProvider({ id: 'deepseek', name: 'DeepSeek', mode: 'delayed', responseText: 'DeepSeek continues safely.' });
  const orchestrator = makeOrchestrator([broken, healthy, delayed]);
  const report = await orchestrator.run({
    userMessage: 'Show failure isolation.',
    cycles: 1
  });

  assert.equal(report.diagnostics.some((entry) => entry.providerId === 'qwen' && entry.code === 'PROVIDER_ERROR_PAGE'), true);
  assert.equal(report.transcript.some((entry) => entry.senderId === 'kimi' && entry.text === 'Kimi continues safely.'), true);
  assert.equal(report.transcript.some((entry) => entry.senderId === 'deepseek' && entry.text === 'DeepSeek continues safely.'), true);
  assert.equal(report.transcript.some((entry) => /Something went wrong|Service unavailable/i.test(entry.text)), false);
  assertNoDiagnosticsInTranscript(report);
  assertNoDiagnosticsInPrompts([broken, healthy, delayed]);

  console.log('PASS failure isolation: broken provider does not stop the room');
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
