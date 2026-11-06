'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assert, makeTempDir } = require('../test-utils');
const { enforceSafeDefaults, loadSettings } = require('../../src/core/settings-store');

async function run() {
  const unsafe = enforceSafeDefaults({
    mode: 'live',
    live: {
      enabled: true,
      autoSendOnStartup: true,
      allowedProviders: ['claude', 'perplexity'],
      fullSevenProviderLive: true
    },
    providers: {
      claude: { liveEnabled: true },
      chatgpt: { liveEnabled: true },
      deepseek: { liveEnabled: true },
      gemini: { liveEnabled: true },
      grok: { liveEnabled: true },
      manus: { liveEnabled: true },
      perplexity: { liveEnabled: true },
      meta: { liveEnabled: true },
      qwen: { maxPromptChars: 1000 }
    }
  });

  assert.equal(unsafe.live.enabled, true);
  assert.equal(unsafe.live.autoSendOnStartup, false);
  assert.deepEqual(unsafe.live.allowedProviders, ['qwen', 'kimi']);
  // forbiddenProviders tracks FORBIDDEN_LIVE_PROVIDERS (now chatgpt/claude/gemini). Note the
  // safe defaults still force allowedProviders to qwen/kimi and disable every provider's
  // liveEnabled on startup regardless of policy — opening the allowlist does not auto-enable.
  assert.deepEqual(unsafe.live.forbiddenProviders, ['chatgpt', 'claude', 'gemini']);
  assert.equal(unsafe.live.fullSevenProviderLive, false);
  assert.equal(unsafe.providers.claude.liveEnabled, false);
  assert.equal(unsafe.providers.chatgpt.liveEnabled, false);
  assert.equal(unsafe.providers.deepseek.liveEnabled, false);
  assert.equal(unsafe.providers.gemini.liveEnabled, false);
  assert.equal(unsafe.providers.grok.liveEnabled, false);
  assert.equal(unsafe.providers.manus.liveEnabled, false);
  assert.equal(unsafe.providers.meta.liveEnabled, false);
  assert.equal(unsafe.providers.perplexity.liveEnabled, false);
  assert.equal(unsafe.providers.qwen.maxPromptChars, 1000);

  const dir = makeTempDir('ai-team-v3-settings-');
  const settingsPath = path.join(dir, 'v3-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ live: { autoSendOnStartup: true } }), 'utf8');
  const loaded = loadSettings({ settingsPath });
  assert.equal(loaded.live.autoSendOnStartup, false);

  console.log('PASS settings store: defaults are safe and no live auto-send can be enabled by config');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
