'use strict';

class TraceStore {
  constructor({ maxEntries = 10000 } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new TypeError('Invalid trace capacity');
    this.entries = [];
    this.maxEntries = maxEntries;
    this.cursor = 0;
    this.totalEntries = 0;
  }

  transition(providerId, fromState, toState, meta = {}) {
    const entry = {
      type: 'STATE_TRANSITION',
      providerId,
      fromState,
      toState,
      meta,
      createdAt: new Date().toISOString(),
      index: ++this.totalEntries
    };
    this.append(entry);
    return entry;
  }

  event(type, meta = {}) {
    const entry = {
      type,
      meta,
      createdAt: new Date().toISOString(),
      index: ++this.totalEntries
    };
    this.append(entry);
    return entry;
  }

  append(entry) {
    if (this.entries.length < this.maxEntries) this.entries.push(entry);
    else { this.entries[this.cursor] = entry; this.cursor = (this.cursor + 1) % this.maxEntries; }
  }

  list() {
    return this.cursor ? [...this.entries.slice(this.cursor), ...this.entries.slice(0, this.cursor)] : [...this.entries];
  }

  byProvider(providerId) {
    return this.list().filter((entry) => entry.providerId === providerId);
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
    this.cursor = 0;
    this.totalEntries = 0;
  }
}

module.exports = {
  TraceStore
};
