'use strict';

class PromptLedger {
  constructor() {
    this.providers = new Map();
  }

  get(providerId) {
    if (!this.providers.has(providerId)) {
      this.providers.set(providerId, {
        providerId,
        briefingDelivered: false,
        lastDeliveredTurnId: 0,
        sentPrompts: []
      });
    }
    return this.providers.get(providerId);
  }

  hasBriefing(providerId) {
    return this.get(providerId).briefingDelivered === true;
  }

  hasDeliveredBriefing(providerId) {
    return this.hasBriefing(providerId);
  }

  markBriefingDelivered(providerId) {
    this.get(providerId).briefingDelivered = true;
  }

  commitDelivery(providerId, delivery) {
    const state = this.get(providerId);
    if (delivery.promptMode === 'briefing') {
      state.briefingDelivered = true;
    }
    state.lastDeliveredTurnId = Math.max(state.lastDeliveredTurnId, delivery.latestTurnId || 0);
    state.sentPrompts.push({
      promptMode: delivery.promptMode,
      includedTurnIds: [...(delivery.includedTurnIds || [])],
      promptChars: delivery.promptChars || 0,
      createdAt: new Date().toISOString()
    });
  }

  lastDeliveredTurnId(providerId) {
    return this.get(providerId).lastDeliveredTurnId;
  }

  getLastDeliveredTurnId(providerId) {
    return this.lastDeliveredTurnId(providerId);
  }

  markDelivered(providerId, turnId) {
    const state = this.get(providerId);
    state.lastDeliveredTurnId = Math.max(state.lastDeliveredTurnId, turnId || 0);
  }

  sentPrompts(providerId) {
    return [...this.get(providerId).sentPrompts];
  }

  snapshot() {
    return Array.from(this.providers.values()).map((entry) => ({
      providerId: entry.providerId,
      briefingDelivered: entry.briefingDelivered,
      lastDeliveredTurnId: entry.lastDeliveredTurnId,
      sentPrompts: [...entry.sentPrompts]
    }));
  }
}

module.exports = {
  PromptLedger
};
