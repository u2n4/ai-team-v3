'use strict';

const { assert } = require('../test-utils');
const { TIER, classifyModel, describeTier } = require('../../src/core/model-classifier');

async function run() {
  // Powerful / reasoning / frontier models.
  for (const m of ['Claude Opus 4', 'o3', 'o1-pro', 'DeepSeek R1', 'Gemini 2.5 Pro', 'Qwen Max', 'Grok 4 Heavy', 'GPT-5', 'DeepThink (R1)', 'thinking']) {
    assert.equal(classifyModel(m).tier, TIER.POWERFUL, `${m} should be POWERFUL`);
  }

  // Fast / lightweight models.
  for (const m of ['Gemini 2.5 Flash', 'GPT-4o mini', 'Qwen Turbo', 'Claude Haiku', 'Llama 8B', 'GLM-4-Air', 'grok-3-mini', 'lite']) {
    assert.equal(classifyModel(m).tier, TIER.FAST, `${m} should be FAST`);
  }

  // Balanced models.
  for (const m of ['Claude Sonnet 4', 'GPT-4o', 'DeepSeek Chat', 'Qwen Plus', 'Kimi']) {
    assert.equal(classifyModel(m).tier, TIER.BALANCED, `${m} should be BALANCED`);
  }

  // Unknown / empty.
  assert.equal(classifyModel('').tier, TIER.UNKNOWN);
  assert.equal(classifyModel('some-random-thing-9000').tier, TIER.UNKNOWN);

  // model string preserved + descriptions present.
  assert.equal(classifyModel('Claude Opus 4').model, 'Claude Opus 4');
  assert.equal(describeTier(TIER.POWERFUL).includes('Powerful'), true);
  assert.equal(describeTier(TIER.FAST).includes('Fast'), true);

  console.log('PASS model classifier: model names map to POWERFUL / FAST / BALANCED tiers');
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = run;
