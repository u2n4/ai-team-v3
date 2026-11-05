'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_POLICY_PATH = path.join(PROJECT_ROOT, 'config', 'provider-session-policy.json');
const V2_ROOT = path.resolve(PROJECT_ROOT, '..');

// 2026-06-21 (D20, Ali's explicit instruction): all providers are live-allowed EXCEPT
// ChatGPT and Claude, which remain forbidden before page open. Every live provider stays
// human-gated (humanApprovalRequired + requireHumanConfirmationForLiveSend) — opening the
// allowlist does NOT bypass the env/UI confirmation gates.
const DEFAULT_POLICY = Object.freeze({
  reuseV2Sessions: true,
  allowedReuseProviders: ['qwen', 'kimi'],
  forbiddenLiveProviders: ['chatgpt', 'claude'],
  requireHumanConfirmationForLiveSend: true,
  doNotCopyCookies: true,
  doNotLogSecrets: true,
  v2SharedPartition: 'persist:ai-team-shared',
  providerPolicies: {
    qwen: { liveAllowed: true, v2SessionReuseAllowed: true, partition: 'persist:ai-team-shared', humanApprovalRequired: true },
    kimi: { liveAllowed: true, v2SessionReuseAllowed: true, partition: 'persist:ai-team-shared', humanApprovalRequired: true },
    deepseek: { liveAllowed: true, v2SessionReuseAllowed: false, partition: 'persist:ai-team-v3-deepseek', humanApprovalRequired: true },
    perplexity: { liveAllowed: true, v2SessionReuseAllowed: false, partition: 'persist:ai-team-v3-perplexity', humanApprovalRequired: true },
    gemini: { liveAllowed: true, v2SessionReuseAllowed: false, partition: 'persist:ai-team-v3-gemini', humanApprovalRequired: true },
    grok: { liveAllowed: true, v2SessionReuseAllowed: false, partition: 'persist:ai-team-v3-grok', humanApprovalRequired: true },
    zai: { liveAllowed: true, v2SessionReuseAllowed: false, partition: 'persist:ai-team-v3-zai', humanApprovalRequired: true },
    meta: { liveAllowed: true, v2SessionReuseAllowed: false, partition: 'persist:ai-team-v3-meta', humanApprovalRequired: true },
    manus: { liveAllowed: true, v2SessionReuseAllowed: false, partition: 'persist:ai-team-v3-manus', humanApprovalRequired: true },
    chatgpt: { liveAllowed: false, v2SessionReuseAllowed: false, partition: null, humanApprovalRequired: true },
    claude: { liveAllowed: false, v2SessionReuseAllowed: false, partition: null, humanApprovalRequired: true }
  }
});

const SAFE_PARTITION_PATTERN = /persist:[a-z0-9._:-]+/gi;
const FORBIDDEN_PROVIDER_MESSAGE = 'ChatGPT/Claude live is disabled by human instruction.';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeProviderId(providerId) {
  return String(providerId || '').trim().toLowerCase();
}

function mergePolicy(base, override) {
  const merged = {
    ...clone(base),
    ...(override || {})
  };
  merged.providerPolicies = {
    ...(base.providerPolicies || {}),
    ...((override && override.providerPolicies) || {})
  };
  return merged;
}

function loadProviderSessionPolicy({ policyPath = DEFAULT_POLICY_PATH } = {}) {
  if (!fs.existsSync(policyPath)) {
    return clone(DEFAULT_POLICY);
  }
  const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  return mergePolicy(DEFAULT_POLICY, parsed);
}

function discoverV2SessionReferences({ v2Root = V2_ROOT, files = ['main.js', 'config/ai-config.js'] } = {}) {
  const references = [];
  for (const relativePath of files) {
    const fullPath = path.join(v2Root, relativePath);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    const text = fs.readFileSync(fullPath, 'utf8');
    const matches = text.match(SAFE_PARTITION_PATTERN) || [];
    for (const partition of [...new Set(matches)]) {
      references.push({
        file: relativePath.replace(/\\/g, '/'),
        kind: 'electron-partition-reference',
        partition
      });
    }
  }
  if (references.length === 0 && fs.existsSync(DEFAULT_POLICY_PATH)) {
    const text = fs.readFileSync(DEFAULT_POLICY_PATH, 'utf8');
    const matches = text.match(SAFE_PARTITION_PATTERN) || [];
    for (const partition of [...new Set(matches)]) {
      references.push({
        file: 'config/provider-session-policy.json',
        kind: 'electron-partition-reference',
        partition
      });
    }
  }
  return {
    v2Root,
    cookiesRead: false,
    sessionStorageRead: false,
    secretsRead: false,
    references
  };
}

function resolveProviderSessionPolicy(providerId, { policy = loadProviderSessionPolicy() } = {}) {
  const id = normalizeProviderId(providerId);
  const providerPolicy = (policy.providerPolicies && policy.providerPolicies[id]) || {};
  const forbidden = (policy.forbiddenLiveProviders || []).includes(id);
  const reuseAllowed = Boolean(
    policy.reuseV2Sessions === true &&
    (policy.allowedReuseProviders || []).includes(id) &&
    providerPolicy.v2SessionReuseAllowed === true
  );
  const liveAllowed = providerPolicy.liveAllowed === true && !forbidden;
  return {
    providerId: id,
    liveAllowed,
    forbidden,
    v2SessionReuseAllowed: reuseAllowed,
    reuseV2Sessions: policy.reuseV2Sessions === true,
    partition: reuseAllowed ? (providerPolicy.partition || policy.v2SharedPartition) : providerPolicy.partition,
    humanApprovalRequired: providerPolicy.humanApprovalRequired !== false || policy.requireHumanConfirmationForLiveSend === true,
    doNotCopyCookies: policy.doNotCopyCookies !== false,
    doNotLogSecrets: policy.doNotLogSecrets !== false,
    status: forbidden ? 'BLOCKED_PROVIDER_FORBIDDEN' : (liveAllowed ? 'READY_FOR_PROVIDER_DOCTOR' : 'BLOCKED_PROVIDER_NOT_ALLOWED'),
    message: forbidden ? FORBIDDEN_PROVIDER_MESSAGE : ''
  };
}

function assertProviderLiveAllowed(providerId, options = {}) {
  const resolved = resolveProviderSessionPolicy(providerId, options);
  if (resolved.forbidden) {
    const error = new Error(FORBIDDEN_PROVIDER_MESSAGE);
    error.code = 'BLOCKED_PROVIDER_FORBIDDEN';
    error.policy = resolved;
    throw error;
  }
  if (!resolved.liveAllowed) {
    const error = new Error(`Provider "${resolved.providerId || '(missing)'}" is not allowed for live V3 automation.`);
    error.code = resolved.status;
    error.policy = resolved;
    throw error;
  }
  return resolved;
}

function resolveProviderPartition(providerDefinition, providerId, options = {}) {
  const resolved = resolveProviderSessionPolicy(providerId || (providerDefinition && providerDefinition.id), options);
  if (resolved.v2SessionReuseAllowed && resolved.partition) {
    return {
      partition: resolved.partition,
      source: 'v2-reused-electron-partition',
      policy: resolved
    };
  }
  return {
    partition: providerDefinition && providerDefinition.partition,
    source: 'v3-provider-partition',
    policy: resolved
  };
}

module.exports = {
  DEFAULT_POLICY,
  DEFAULT_POLICY_PATH,
  FORBIDDEN_PROVIDER_MESSAGE,
  assertProviderLiveAllowed,
  discoverV2SessionReferences,
  loadProviderSessionPolicy,
  resolveProviderPartition,
  resolveProviderSessionPolicy
};
