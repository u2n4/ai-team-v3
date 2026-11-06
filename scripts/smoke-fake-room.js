'use strict';

const { Orchestrator } = require('../src/core/orchestrator');
const { createFakeProviders } = require('../src/providers/fake-provider');

async function main() {
  const providers = createFakeProviders(['qwen', 'kimi', 'chatgpt', 'deepseek', 'gemini', 'claude', 'perplexity']);
  const report = await new Orchestrator({ providers }).run({
    userMessage: 'Run a fake room smoke discussion.',
    cycles: 4
  });
  const expected = providers.length * 4;
  const actual = report.transcript.filter(entry => entry.role === 'ai').length;
  if (actual !== expected || report.diagnostics.length) throw new Error(`Offline smoke captured ${actual}/${expected} turns with ${report.diagnostics.length} diagnostics`);
  console.log(JSON.stringify({
    aiResponses: report.transcript.filter((entry) => entry.role === 'ai').length,
    diagnostics: report.diagnostics.length,
    providers: providers.map((provider) => ({
      id: provider.id,
      sentPrompts: provider.sentPrompts.length
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
