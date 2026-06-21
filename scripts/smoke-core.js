'use strict';

const { Orchestrator } = require('../src/core/orchestrator');
const { FakeProvider } = require('../src/providers/fake-provider');

async function main() {
  const providers = [
    new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'clean' }),
    new FakeProvider({ id: 'kimi', name: 'Kimi', mode: 'clean' })
  ];
  const report = await new Orchestrator({ providers }).run({
    userMessage: 'Smoke test the V3 core.',
    cycles: 1
  });
  console.log(JSON.stringify({
    transcriptEntries: report.transcript.length,
    diagnostics: report.diagnostics.length,
    traces: report.traces.length,
    quota: report.quota
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
