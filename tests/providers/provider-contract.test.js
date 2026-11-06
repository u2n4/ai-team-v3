'use strict';

const { assert } = require('../test-utils');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../../src/providers/webview-provider-adapter');
const {
  LIVE_PROVIDER_ALLOWLIST,
  liveProviderStatus,
  validateProviderContract
} = require('../../src/providers/provider-contract');

async function run() {
  assert.deepEqual(LIVE_PROVIDER_ALLOWLIST, ['qwen', 'kimi']);
  assert.equal(liveProviderStatus('qwen'), 'READY_FOR_PROVIDER_DOCTOR');
  assert.equal(liveProviderStatus('kimi'), 'READY_FOR_PROVIDER_DOCTOR');
  // Room-live-allowed providers that are NOT on the one-provider smoke allowlist resolve
  // to UNSUPPORTED for the smoke gate (the staged ladder keeps smoke at qwen/kimi only).
  for (const providerId of ['grok', 'zai', 'meta', 'manus', 'deepseek', 'perplexity']) {
    assert.equal(liveProviderStatus(providerId), 'BLOCKED_UNSUPPORTED_PROVIDER');
  }
  // 2026-06-21 (D20): ChatGPT, Claude and Gemini stay forbidden before page open.
  assert.equal(liveProviderStatus('chatgpt'), 'BLOCKED_PROVIDER_FORBIDDEN');
  assert.equal(liveProviderStatus('gemini'), 'BLOCKED_PROVIDER_FORBIDDEN');
  assert.equal(liveProviderStatus('claude'), 'BLOCKED_PROVIDER_FORBIDDEN');

  for (const providerId of LIVE_PROVIDER_ALLOWLIST) {
    const result = validateProviderContract(DEFAULT_PROVIDER_DEFINITIONS[providerId]);
    assert.equal(result.ok, true, `${providerId} contract errors: ${result.errors.join(', ')}`);
    assert.equal(DEFAULT_PROVIDER_DEFINITIONS[providerId].redactionPolicy.redactHeaders, true);
    assert.equal(DEFAULT_PROVIDER_DEFINITIONS[providerId].redactionPolicy.redactAccountData, true);
    assert.equal(DEFAULT_PROVIDER_DEFINITIONS[providerId].safeFirstPrompt.includes('AI_TEAM_V3_SMOKE_OK'), true);
    assert.equal(DEFAULT_PROVIDER_DEFINITIONS[providerId].stabilityMs >= 2000, true);
    assert.equal(DEFAULT_PROVIDER_DEFINITIONS[providerId].maxPromptChars > 0, true);
  }

  const invalid = validateProviderContract({
    id: 'qwen',
    inputSelectors: [],
    redactionPolicy: {}
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.some((error) => /missing url/.test(error)), true);
  assert.equal(invalid.errors.some((error) => /inputSelectors/.test(error)), true);

  console.log('PASS provider contracts: qwen/kimi contracts are explicit and live allowlist is enforced');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
