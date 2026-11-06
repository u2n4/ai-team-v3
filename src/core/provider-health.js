'use strict';

function nowIso() {
  return new Date().toISOString();
}

function createProviderHealth(providerId) {
  return {
    providerId,
    available: true,
    loggedIn: 'unknown',
    selectorsOk: false,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    challengeDetected: false,
    rateLimitDetected: false,
    captureReliability: 0,
    averageResponseTime: null,
    disabledForRun: false
  };
}

class ProviderHealthStore {
  constructor({ disableAfterFailures = 3 } = {}) {
    this.disableAfterFailures = disableAfterFailures;
    this.records = new Map();
  }

  ensure(providerId) {
    if (!this.records.has(providerId)) {
      this.records.set(providerId, createProviderHealth(providerId));
    }
    return this.records.get(providerId);
  }

  markSelectorDoctor(providerId, { selectorsOk, loggedIn = 'unknown', challengeDetected = false, rateLimitDetected = false } = {}) {
    const record = this.ensure(providerId);
    record.selectorsOk = Boolean(selectorsOk);
    record.loggedIn = loggedIn;
    record.challengeDetected = Boolean(challengeDetected);
    record.rateLimitDetected = Boolean(rateLimitDetected);
    record.available = record.selectorsOk && !record.challengeDetected && !record.rateLimitDetected;
    record.disabledForRun = record.disabledForRun || record.challengeDetected || record.rateLimitDetected;
    return { ...record };
  }

  markSuccess(providerId, { responseTimeMs = null } = {}) {
    const record = this.ensure(providerId);
    record.available = !record.disabledForRun && !record.challengeDetected && !record.rateLimitDetected;
    record.lastSuccessAt = nowIso();
    record.consecutiveFailures = 0;
    record.captureReliability = Math.min(1, Number((record.captureReliability + 0.2).toFixed(3)));
    if (Number.isFinite(Number(responseTimeMs))) {
      record.averageResponseTime = record.averageResponseTime == null
        ? Number(responseTimeMs)
        : Math.round((record.averageResponseTime + Number(responseTimeMs)) / 2);
    }
    return { ...record };
  }

  markFailure(providerId, { code = 'PROVIDER_FAILURE' } = {}) {
    const record = this.ensure(providerId);
    record.lastFailureAt = nowIso();
    record.consecutiveFailures += 1;
    if (/challenge|captcha|cloudflare/i.test(code)) {
      record.challengeDetected = true;
    }
    if (/limit|quota|too_many_requests|(?:^|_)rate(?:_|$)/i.test(code)) {
      record.rateLimitDetected = true;
    }
    if (record.consecutiveFailures >= this.disableAfterFailures || record.challengeDetected || record.rateLimitDetected) {
      record.disabledForRun = true;
      record.available = false;
    }
    record.captureReliability = Math.max(0, Number((record.captureReliability - 0.2).toFixed(3)));
    return { ...record };
  }

  snapshot() {
    return Array.from(this.records.values()).map((record) => ({ ...record }));
  }
}

module.exports = {
  ProviderHealthStore,
  createProviderHealth
};
