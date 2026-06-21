'use strict';

class TraceStore {
  constructor() {
    this.entries = [];
  }

  transition(providerId, fromState, toState, meta = {}) {
    const entry = {
      type: 'STATE_TRANSITION',
      providerId,
      fromState,
      toState,
      meta,
      createdAt: new Date().toISOString(),
      index: this.entries.length + 1
    };
    this.entries.push(entry);
    return entry;
  }

  event(type, meta = {}) {
    const entry = {
      type,
      meta,
      createdAt: new Date().toISOString(),
      index: this.entries.length + 1
    };
    this.entries.push(entry);
    return entry;
  }

  list() {
    return [...this.entries];
  }

  byProvider(providerId) {
    return this.entries.filter((entry) => entry.providerId === providerId);
  }

  stateSequence(providerId) {
    return this.byProvider(providerId)
      .filter((entry) => entry.type === 'STATE_TRANSITION')
      .map((entry) => entry.toState);
  }

  hasTransition(providerId, toState) {
    return this.stateSequence(providerId).includes(toState);
  }

  clear() {
    this.entries = [];
  }
}

module.exports = {
  TraceStore
};
