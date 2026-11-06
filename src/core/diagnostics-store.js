'use strict';

class DiagnosticsStore {
  constructor() {
    this.entries = [];
  }

  add({ providerId = 'system', code, severity = 'warning', message, details = {} }) {
    if (!code) {
      throw new Error('Diagnostic code is required.');
    }
    const entry = {
      type: 'diagnostic',
      providerId,
      code,
      severity,
      message: message || code,
      details: structuredClone(details),
      createdAt: new Date().toISOString(),
      index: this.entries.length + 1
    };
    this.entries.push(entry);
    return structuredClone(entry);
  }

  list() {
    return structuredClone(this.entries);
  }

  byProvider(providerId) {
    return structuredClone(this.entries.filter((entry) => entry.providerId === providerId));
  }

  hasCode(code, providerId) {
    return this.entries.some((entry) => {
      if (providerId && entry.providerId !== providerId) {
        return false;
      }
      return entry.code === code;
    });
  }

  clear() {
    this.entries = [];
  }
}

module.exports = {
  DiagnosticsStore
};
