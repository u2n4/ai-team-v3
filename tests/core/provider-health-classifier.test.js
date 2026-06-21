'use strict';

const { assert } = require('../test-utils');
const { HEALTH, classifyProviderHealth, isBrokenVerdict } = require('../../src/core/provider-health-classifier');

async function run() {
  // Healthy: composer + send verified + response started, fast.
  let r = classifyProviderHealth({ composerFound: true, sendVerified: true, responseStarted: true, sendMs: 1000 });
  assert.equal(r.verdict, HEALTH.READY);
  assert.equal(r.broken, false);
  assert.equal(isBrokenVerdict(r.verdict), false);

  // Working but slow.
  r = classifyProviderHealth({ composerFound: true, sendVerified: true, responseStarted: true, sendMs: 12000 });
  assert.equal(r.verdict, HEALTH.READY_SLOW);
  assert.equal(r.broken, false);

  // Challenge text wins even if a composer somehow exists.
  r = classifyProviderHealth({ composerFound: true, challengeText: true });
  assert.equal(r.verdict, HEALTH.CHALLENGE);
  assert.equal(r.broken, true);

  // Rate limit.
  r = classifyProviderHealth({ composerFound: true, limitText: true });
  assert.equal(r.verdict, HEALTH.RATE_LIMITED);
  assert.equal(r.broken, true);

  // No composer + login text => login wall.
  r = classifyProviderHealth({ composerFound: false, loginText: true });
  assert.equal(r.verdict, HEALTH.LOGIN_WALL);
  assert.equal(r.broken, true);

  // No composer + no login/challenge => selector drift.
  r = classifyProviderHealth({ composerFound: false });
  assert.equal(r.verdict, HEALTH.SELECTOR_DRIFT);
  assert.equal(r.broken, true);

  // Composer present, send not verified => send failed.
  r = classifyProviderHealth({ composerFound: true, sendVerified: false });
  assert.equal(r.verdict, HEALTH.SEND_FAILED);
  assert.equal(r.broken, true);

  // Send verified but response never started => capture timeout.
  r = classifyProviderHealth({ composerFound: true, sendVerified: true, responseStarted: false });
  assert.equal(r.verdict, HEALTH.CAPTURE_TIMEOUT);
  assert.equal(r.broken, true);

  // Composer present but nothing observed => unknown (treated as broken/needs attention).
  r = classifyProviderHealth({ composerFound: true });
  assert.equal(r.verdict, HEALTH.UNKNOWN);
  assert.equal(isBrokenVerdict(r.verdict), true);

  console.log('PASS provider health classifier: live signals map to clear READY / broken verdicts');
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = run;
