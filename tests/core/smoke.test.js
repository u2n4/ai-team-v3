'use strict';

const { assert, FakeProvider, makeOrchestrator } = require('../test-utils');

async function run() {
  const provider = new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'clean' });
  const report = await makeOrchestrator([provider]).run({
    userMessage: 'Smoke test.',
    cycles: 1
  });
  assert.equal(report.transcript.filter((entry) => entry.role === 'ai').length, 1);
  assert.equal(report.diagnostics.length, 0);
  console.log('PASS smoke: V3 runner executes assertions');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
