'use strict';

const { assert } = require('../test-utils');
const {
  assertProviderLiveAllowed,
  discoverV2SessionReferences,
  resolveProviderPartition,
  resolveProviderSessionPolicy
} = require('../../src/providers/provider-session-policy');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../../src/providers/webview-provider-adapter');

async function run() {
  const qwen = resolveProviderSessionPolicy('qwen');
  assert.equal(qwen.liveAllowed, true);
  assert.equal(qwen.v2SessionReuseAllowed, true);
  assert.equal(qwen.partition, 'persist:ai-team-shared');

  const kimi = resolveProviderSessionPolicy('kimi');
  assert.equal(kimi.liveAllowed, true);
  assert.equal(kimi.v2SessionReuseAllowed, true);
  assert.equal(kimi.partition, 'persist:ai-team-shared');

  // 2026-06-21 (D20): only ChatGPT and Claude remain forbidden before page open.
  for (const providerId of ['chatgpt', 'claude']) {
    const policy = resolveProviderSessionPolicy(providerId);
    assert.equal(policy.status, 'BLOCKED_PROVIDER_FORBIDDEN');
    assert.equal(policy.v2SessionReuseAllowed, false);
    assert.throws(() => assertProviderLiveAllowed(providerId), /ChatGPT\/Claude live is disabled/);
  }

  // All other providers are now live-allowed (still human-gated). They must resolve to
  // READY_FOR_PROVIDER_DOCTOR and not throw the forbidden error.
  for (const providerId of ['deepseek', 'perplexity', 'gemini', 'grok', 'zai', 'meta', 'manus']) {
    const policy = resolveProviderSessionPolicy(providerId);
    assert.equal(policy.status, 'READY_FOR_PROVIDER_DOCTOR');
    assert.equal(policy.liveAllowed, true);
    assert.equal(policy.forbidden, false);
    assert.equal(policy.humanApprovalRequired, true);
    assert.doesNotThrow(() => assertProviderLiveAllowed(providerId));
  }

  const partition = resolveProviderPartition(DEFAULT_PROVIDER_DEFINITIONS.qwen, 'qwen');
  assert.equal(partition.partition, 'persist:ai-team-shared');
  assert.equal(partition.source, 'v2-reused-electron-partition');

  const discovery = discoverV2SessionReferences();
  assert.equal(discovery.cookiesRead, false);
  assert.equal(discovery.sessionStorageRead, false);
  assert.equal(discovery.secretsRead, false);
  assert.equal(discovery.references.some((entry) => entry.partition === 'persist:ai-team-shared'), true);

  console.log('PASS provider session policy: qwen/kimi V2 partition reuse is allowed; all providers live-allowed except ChatGPT/Claude which are blocked before open');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
