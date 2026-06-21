'use strict';

const {
  assert,
  FakeProvider,
  makeOrchestrator,
  assertNoDiagnosticsInTranscript
} = require('../test-utils');

async function runRepeatedFailures() {
  const provider = new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'empty' });
  const orchestrator = makeOrchestrator([provider]);
  const report = await orchestrator.run({
    userMessage: 'Trigger repeated empty captures.',
    cycles: 4
  });

  assert.equal(provider.sentPrompts.length, 3, 'provider should stop sending after repeated failures');
  const quota = report.quota.find((entry) => entry.providerId === 'qwen');
  assert.equal(quota.failedSendCount, 3);
  assert.equal(quota.disabledForRun, true);
  assert.equal(report.diagnostics.some((entry) => entry.code === 'PROVIDER_DISABLED_FOR_RUN'), true);
  assertNoDiagnosticsInTranscript(report);
}

async function runLimitDetection() {
  const provider = new FakeProvider({ id: 'kimi', name: 'Kimi', mode: 'rateLimit' });
  const orchestrator = makeOrchestrator([provider]);
  const report = await orchestrator.run({
    userMessage: 'Trigger limit detection.',
    cycles: 2
  });

  assert.equal(provider.sentPrompts.length, 1, 'limit detection should disable provider immediately');
  const quota = report.quota.find((entry) => entry.providerId === 'kimi');
  assert.equal(quota.limitDetected, true);
  assert.equal(quota.disabledForRun, true);
  assert.equal(report.diagnostics.some((entry) => entry.code === 'PROVIDER_LIMIT_REACHED'), true);
  assert.equal(report.diagnostics.some((entry) => entry.code === 'PROVIDER_DISABLED_FOR_RUN'), true);
  assertNoDiagnosticsInTranscript(report);
}

async function run() {
  await runRepeatedFailures();
  await runLimitDetection();
  console.log('PASS quota guard: repeated failures and limits disable providers for run');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
