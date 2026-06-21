'use strict';

const { assert } = require('../test-utils');
const { analyzeRun } = require('../../src/core/run-analyzer');

async function run() {
  const good = {
    transcript: [
      { turnId: 1, role: 'user', senderId: 'user', text: '[ROUND 1] Human objective contract' },
      { turnId: 2, role: 'ai', senderId: 'qwen', text: 'FINAL_READINESS_VERDICT clean final decision.' }
    ],
    diagnostics: [],
    promptLedger: [
      { providerId: 'qwen', sentPrompts: [{ promptMode: 'briefing', promptChars: 100 }] }
    ],
    quota: [],
    health: [{ providerId: 'qwen' }]
  };
  const goodAnalysis = analyzeRun(good, {
    expectedRounds: 1,
    requiredRoundLabels: ['Human objective contract'],
    requireFinalSynthesis: true,
    providerIds: ['qwen']
  });
  assert.equal(goodAnalysis.ok, true);

  const bad = {
    transcript: [
      { turnId: 1, role: 'user', senderId: 'user', text: '[ROUND 1] Human objective contract' },
      { turnId: 2, role: 'ai', senderId: 'qwen', text: 'New chat Upgrade plan Log in Keyboard shortcuts' }
    ],
    diagnostics: [],
    promptLedger: [
      { providerId: 'qwen', sentPrompts: [{ promptMode: 'briefing', promptChars: 50000 }, { promptMode: 'briefing', promptChars: 50000 }] }
    ],
    quota: [],
    health: []
  };
  const badAnalysis = analyzeRun(bad, {
    expectedRounds: 30,
    requiredRoundLabels: ['Final decision'],
    requireFinalSynthesis: true,
    providerIds: ['qwen']
  });
  assert.equal(badAnalysis.ok, false);
  assert.equal(badAnalysis.checks.some((check) => check.status === 'FAIL'), true);
  console.log('PASS run analyzer: known-good reports pass and shallow contaminated reports fail');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
