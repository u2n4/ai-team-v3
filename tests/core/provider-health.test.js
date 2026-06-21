'use strict';

const { assert } = require('../test-utils');
const { ProviderHealthStore, createProviderHealth } = require('../../src/core/provider-health');

async function run() {
  const empty = createProviderHealth('qwen');
  assert.equal(empty.available, true);
  assert.equal(empty.loggedIn, 'unknown');
  assert.equal(empty.disabledForRun, false);

  const health = new ProviderHealthStore({ disableAfterFailures: 2 });
  let record = health.markSelectorDoctor('qwen', {
    selectorsOk: true,
    loggedIn: 'unknown',
    challengeDetected: false,
    rateLimitDetected: false
  });
  assert.equal(record.available, true);
  assert.equal(record.selectorsOk, true);

  record = health.markFailure('qwen', { code: 'CAPTURE_TIMEOUT' });
  assert.equal(record.consecutiveFailures, 1);
  assert.equal(record.disabledForRun, false);

  record = health.markFailure('qwen', { code: 'RATE_LIMIT_DETECTED' });
  assert.equal(record.rateLimitDetected, true);
  assert.equal(record.disabledForRun, true);
  assert.equal(record.available, false);

  record = health.markSuccess('qwen', { responseTimeMs: 1200 });
  assert.equal(record.consecutiveFailures, 0);
  assert.equal(record.lastSuccessAt != null, true);
  assert.equal(record.averageResponseTime, 1200);
  assert.equal(health.snapshot().length, 1);

  console.log('PASS provider health: health score updates availability, failures, and run disable state');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
