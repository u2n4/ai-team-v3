'use strict';

// First-gate smoke allowlist: the one-provider live smoke stays limited to the two safest,
// V2-session-reusable providers (qwen/kimi) even though the room policy allows more. This
// preserves the staged ladder — prove one safe provider live before widening.
const LIVE_PROVIDER_ALLOWLIST = Object.freeze(['qwen', 'kimi']);
// 2026-06-21 (D20, Ali): ChatGPT, Claude and Gemini are blocked before page open. All other
// providers are live-allowed at the room level (still human-gated per session policy).
const FORBIDDEN_LIVE_PROVIDERS = Object.freeze(['chatgpt', 'claude', 'gemini']);

const REQUIRED_CONTRACT_FIELDS = Object.freeze([
  'id',
  'allowedLiveTestStatus',
  'url',
  'partition',
  'inputSelectors',
  'sendSelectors',
  'responseSelectors',
  'responseCountSelector',
  'thinkingSelectors',
  'challengeSelectors',
  'loginWallSelectors',
  'rateLimitSelectors',
  'paidWallSelectors',
  'stabilityMs',
  'maxPromptChars',
  'cooldownPolicy',
  'redactionPolicy',
  'safeFirstPrompt'
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function validateProviderContract(contract, { allowedIds = LIVE_PROVIDER_ALLOWLIST } = {}) {
  const errors = [];
  if (!contract || typeof contract !== 'object') {
    return { ok: false, errors: ['contract must be an object'] };
  }

  for (const field of REQUIRED_CONTRACT_FIELDS) {
    if (contract[field] == null) {
      errors.push(`missing ${field}`);
    }
  }

  if (!allowedIds.includes(contract.id)) {
    errors.push(`provider ${contract.id || '(missing)'} is not in live allowlist`);
  }

  for (const field of ['id', 'allowedLiveTestStatus', 'url', 'partition', 'responseCountSelector', 'safeFirstPrompt']) {
    if (!isNonEmptyString(contract[field])) {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  for (const field of ['inputSelectors', 'sendSelectors', 'responseSelectors', 'thinkingSelectors', 'challengeSelectors', 'loginWallSelectors', 'rateLimitSelectors', 'paidWallSelectors']) {
    if (!isNonEmptyArray(contract[field])) {
      errors.push(`${field} must be a non-empty selector array`);
    }
  }

  if (!Number.isFinite(contract.stabilityMs) || contract.stabilityMs < 0) {
    errors.push('stabilityMs must be a non-negative number');
  }

  if (!Number.isFinite(contract.maxPromptChars) || contract.maxPromptChars <= 0) {
    errors.push('maxPromptChars must be a positive number');
  }

  if (!contract.cooldownPolicy || !Number.isSafeInteger(contract.cooldownPolicy.consecutiveFailureLimit) || contract.cooldownPolicy.consecutiveFailureLimit < 1) {
    errors.push('cooldownPolicy.consecutiveFailureLimit must be numeric');
  }

  if (!contract.redactionPolicy || contract.redactionPolicy.redactHeaders !== true || contract.redactionPolicy.redactAccountData !== true) {
    errors.push('redactionPolicy must redact headers and account data');
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function assertProviderContract(contract, options) {
  const result = validateProviderContract(contract, options);
  if (!result.ok) {
    throw new Error(`Invalid provider contract for ${contract && contract.id || '(missing)'}: ${result.errors.join('; ')}`);
  }
  return contract;
}

function liveProviderStatus(providerId) {
  if (FORBIDDEN_LIVE_PROVIDERS.includes(providerId)) {
    return 'BLOCKED_PROVIDER_FORBIDDEN';
  }
  if (!LIVE_PROVIDER_ALLOWLIST.includes(providerId)) {
    return 'BLOCKED_UNSUPPORTED_PROVIDER';
  }
  return 'READY_FOR_PROVIDER_DOCTOR';
}

module.exports = {
  FORBIDDEN_LIVE_PROVIDERS,
  LIVE_PROVIDER_ALLOWLIST,
  REQUIRED_CONTRACT_FIELDS,
  assertProviderContract,
  liveProviderStatus,
  validateProviderContract
};
