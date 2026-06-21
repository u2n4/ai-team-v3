'use strict';

// Separate store for each AI's REASONING / "thinking" text, captured apart from the public
// answer. The transcript holds ONLY clean answers (firewall invariant); the reasoning lives
// here so the UI can show "what this AI is thinking" on its own, readable, channel — without
// the thinking ever leaking into the transcript or being forwarded to the next provider.
class ReasoningStore {
  constructor() {
    this.entries = [];
  }

  // Append a provider's reasoning for a given turn. No-op when there is no reasoning text,
  // so providers that don't expose thinking simply have no reasoning entries.
  append({ providerId, providerName, turnId = null, reasoning }) {
    const text = String(reasoning || '').trim();
    if (!providerId) {
      throw new Error('providerId is required for reasoning entries.');
    }
    if (!text) {
      return null;
    }
    const entry = {
      type: 'reasoning',
      providerId,
      providerName: providerName || providerId,
      turnId,
      reasoning: text,
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

  latestForProvider(providerId) {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i].providerId === providerId) {
        return { ...this.entries[i] };
      }
    }
    return null;
  }

  clear() {
    this.entries = [];
  }
}

module.exports = {
  ReasoningStore
};
