'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  FORBIDDEN_LIVE_PROVIDERS,
  LIVE_PROVIDER_ALLOWLIST
} = require('../providers/provider-contract');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../providers/webview-provider-adapter');

function providerPriority(providerId) {
  const order = ['qwen', 'kimi', 'deepseek', 'gemini', 'chatgpt', 'claude', 'perplexity'];
  const index = order.indexOf(providerId);
  return index === -1 ? 999 : index + 1;
}

function buildDefaultProviderSettings() {
  return Object.fromEntries(Object.values(DEFAULT_PROVIDER_DEFINITIONS).map((provider) => [provider.id, {
    enabled: ['qwen', 'kimi', 'deepseek', 'gemini', 'chatgpt'].includes(provider.id),
    liveEnabled: ['qwen', 'kimi'].includes(provider.id),
    maxPromptChars: provider.maxPromptChars || 8000,
    stabilityMs: provider.stabilityMs || 1800,
    cooldownPolicy: provider.cooldownPolicy || {
      consecutiveFailureLimit: 3,
      failureCooldownMs: 120000,
      limitCooldownMs: 900000
    },
    priority: providerPriority(provider.id)
  }]));
}

const DEFAULT_SAFE_SETTINGS = Object.freeze({
  mode: 'fake',
  live: {
    enabled: false,
    autoSendOnStartup: false,
    allowedProviders: [...LIVE_PROVIDER_ALLOWLIST],
    forbiddenProviders: [...FORBIDDEN_LIVE_PROVIDERS],
    fullSevenProviderLive: false
  },
  approvals: {
    requireHumanForLiveDoctor: true,
    requireHumanForOneProviderSmoke: true,
    requireHumanForMultiProviderRun: true,
    requireHumanForSessionReset: true
  },
  providers: buildDefaultProviderSettings()
});

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function enforceSafeDefaults(settings) {
  const safe = deepMerge(DEFAULT_SAFE_SETTINGS, settings || {});
  safe.live = {
    ...safe.live,
    enabled: safe.live.enabled === true,
    autoSendOnStartup: false,
    allowedProviders: [...LIVE_PROVIDER_ALLOWLIST],
    forbiddenProviders: [...FORBIDDEN_LIVE_PROVIDERS],
    fullSevenProviderLive: false
  };
  for (const [providerId, providerSettings] of Object.entries(safe.providers || {})) {
    if (!LIVE_PROVIDER_ALLOWLIST.includes(providerId)) {
      providerSettings.liveEnabled = false;
    }
  }
  return safe;
}

function loadSettings({ projectRoot = process.cwd(), settingsPath = path.join(projectRoot, 'config', 'v3-settings.json') } = {}) {
  if (!fs.existsSync(settingsPath)) {
    return enforceSafeDefaults({});
  }
  const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  return enforceSafeDefaults(parsed);
}

module.exports = {
  DEFAULT_SAFE_SETTINGS,
  buildDefaultProviderSettings,
  enforceSafeDefaults,
  loadSettings
};
