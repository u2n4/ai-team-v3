'use strict';

const { assert } = require('../test-utils');
const {
  isForbiddenDomain,
  providerForDomain,
  importEdgeCookies,
  importableProviderIds
} = require('../../src/electron/edge-cookie-importer');

const ALLOWED = ['qwen', 'kimi'];

async function run() {
  // Forbidden identity/provider domains must always be rejected.
  for (const domain of [
    'chatgpt.com', '.openai.com', 'claude.ai', 'gemini.google.com',
    'accounts.google.com', 'login.live.com', '.microsoftonline.com', 'google.com'
  ]) {
    assert.equal(isForbiddenDomain(domain), true, `${domain} must be forbidden`);
    assert.equal(providerForDomain(domain, ALLOWED), null, `${domain} must map to no provider`);
  }

  // Allowed providers map to themselves.
  assert.equal(providerForDomain('chat.qwen.ai', ALLOWED), 'qwen');
  assert.equal(providerForDomain('.kimi.com', ALLOWED), 'kimi');

  // The importer must not widen the live phase beyond qwen/kimi, even if a
  // caller passes stale provider ids from an older policy.
  assert.deepEqual(
    importableProviderIds(['qwen', 'kimi', 'deepseek', 'perplexity', 'grok', 'zai', 'meta', 'manus']),
    ['qwen', 'kimi']
  );
  assert.equal(providerForDomain('chat.deepseek.com', ALLOWED), null);
  assert.equal(providerForDomain('www.perplexity.ai', ALLOWED), null);
  assert.equal(providerForDomain('grok.com', ALLOWED), null);
  assert.equal(providerForDomain('chat.z.ai', ALLOWED), null);
  assert.equal(providerForDomain('meta.ai', ALLOWED), null);
  assert.equal(providerForDomain('manus.im', ALLOWED), null);

  // A forbidden domain is never forbidden-bypassed even if also resembling allowed.
  assert.equal(isForbiddenDomain('gemini.google.com'), true);

  // importEdgeCookies must require a sessionForProvider callback.
  let threw = false;
  try {
    await importEdgeCookies({ allowedProviderIds: ALLOWED });
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'importEdgeCookies must require sessionForProvider');

  const noProviders = await importEdgeCookies({
    allowedProviderIds: ['deepseek', 'perplexity', 'grok', 'zai', 'meta', 'manus'],
    sessionForProvider: () => {
      throw new Error('must not request a session when no provider is importable');
    }
  });
  assert.equal(noProviders.success, false);
  assert.deepEqual(noProviders.perProvider, {});
  assert.deepEqual(noProviders.perProviderStorage, {});
  assert.equal(noProviders.message, 'No live-allowed providers selected for import.');

  console.log('PASS edge cookie importer: forbidden accounts are never imported; allowed providers map to their own partitions');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
