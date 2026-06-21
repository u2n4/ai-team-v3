'use strict';

class QuotaGuard {
  constructor({ maxConsecutiveFailures = 3 } = {}) {
    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this.providers = new Map();
  }

  get(providerId) {
    if (!this.providers.has(providerId)) {
      this.providers.set(providerId, {
        providerId,
        sendCount: 0,
        failedSendCount: 0,
        promptCharsSent: 0,
        consecutiveFailures: 0,
        limitDetected: false,
        disabledForRun: false
      });
    }
    return this.providers.get(providerId);
  }

  canSend(providerId) {
    return this.get(providerId).disabledForRun === false;
  }

  recordSendAttempt(providerId) {
    this.get(providerId).sendCount += 1;
  }

  recordPromptSent(providerId, promptChars) {
    this.get(providerId).promptCharsSent += promptChars || 0;
  }

  recordSuccess(providerId) {
    const state = this.get(providerId);
    state.consecutiveFailures = 0;
  }

  recordFailure(providerId) {
    const state = this.get(providerId);
    state.failedSendCount += 1;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.maxConsecutiveFailures) {
      state.disabledForRun = true;
    }
  }

  markLimitDetected(providerId) {
    const state = this.get(providerId);
    state.limitDetected = true;
    state.disabledForRun = true;
  }

  disableForRun(providerId) {
    this.get(providerId).disabledForRun = true;
  }

  isDisabled(providerId) {
    return this.get(providerId).disabledForRun === true;
  }

  snapshot() {
    return Array.from(this.providers.values()).map((entry) => ({ ...entry }));
  }
}

module.exports = {
  QuotaGuard
};
