'use strict';

const { assert } = require('../test-utils');
const {
  detectForbiddenLiveAttempts,
  detectProblems,
  detectSecretsInText
} = require('../../src/core/problem-detector');
const { analyzeRun } = require('../../src/core/run-analyzer');

async function run() {
  assert.equal(detectSecretsInText('authorization: bearer abcdef123456789').length, 1);
  assert.equal(detectForbiddenLiveAttempts([{ live: true, providerId: 'chatgpt' }]).length, 1);

  const shallow = {
    transcript: [
      { turnId: 1, role: 'user', senderId: 'user', text: '[ROUND 1] only' },
      { turnId: 2, role: 'ai', senderId: 'qwen', text: 'New chat\nUpgrade plan\nLog in\nKeyboard shortcuts' }
    ],
    promptLedger: [
      {
        providerId: 'qwen',
        sentPrompts: [
          { promptMode: 'briefing', promptChars: 100 },
          { promptMode: 'briefing', promptChars: 40000 }
        ]
      }
    ],
    diagnostics: [],
    quota: [],
    health: [],
    liveAttempts: [{ live: true, providerId: 'claude' }]
  };
  const problems = detectProblems(shallow, {
    maxPromptChars: 12000,
    requireFinalSynthesis: true,
    providerIds: ['qwen']
  });
  for (const expected of [
    'UI_CHROME_LEAK',
    'REPEATED_BRIEFING',
    'DELTA_ONLY_VIOLATION',
    'PROMPT_BUDGET_EXCEEDED',
    'FORBIDDEN_PROVIDER_LIVE_ATTEMPT',
    'FINAL_SYNTHESIS_MISSING',
    'PROVIDER_HEALTH_NOT_UPDATED'
  ]) {
    assert.equal(problems.some((problem) => problem.code === expected), true, `missing ${expected}`);
  }

  const analysis = analyzeRun(shallow, {
    expectedRounds: 30,
    requiredRoundLabels: ['Human objective contract'],
    requireFinalSynthesis: true,
    providerIds: ['qwen']
  });
  assert.equal(analysis.ok, false);
  assert.equal(analysis.checks.some((check) => check.status === 'FAIL'), true);
  console.log('PASS problem detector: shallow runs, secret leaks, forbidden live attempts, budget creep, and transcript contamination are detected');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
