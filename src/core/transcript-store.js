'use strict';

class TranscriptStore {
  constructor() {
    this.entries = [];
    this.nextTurnId = 1;
  }

  appendUser({ text, senderId = 'user', senderName = 'User', target = 'all' }) {
    return this.#append({
      role: 'user',
      senderId,
      senderName,
      target,
      text
    });
  }

  appendAIResponse({ providerId, providerName, text, meta = {} }) {
    if (!providerId) {
      throw new Error('providerId is required for AI transcript entries.');
    }
    if (meta && meta.diagnostic === true) {
      throw new Error('Diagnostics must not be appended to the public transcript.');
    }
    return this.#append({
      role: 'ai',
      senderId: providerId,
      senderName: providerName || providerId,
      target: 'all',
      text,
      meta
    });
  }

  #append(entry) {
    const cleanText = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!cleanText) {
      throw new Error('Transcript entries require non-empty text.');
    }
    if (entry.role === 'ai' && /\[SYSTEM DIAGNOSTIC\]|PROMPT_OVER_BUDGET|FAILED_DIAGNOSTIC/i.test(cleanText)) {
      throw new Error('Diagnostic-like text cannot enter the public transcript.');
    }

    const record = {
      turnId: this.nextTurnId,
      role: entry.role,
      senderId: entry.senderId,
      senderName: entry.senderName,
      target: entry.target || 'all',
      text: cleanText,
      meta: entry.meta || {},
      createdAt: new Date().toISOString()
    };
    this.nextTurnId += 1;
    this.entries.push(record);
    return record;
  }

  list() {
    return [...this.entries];
  }

  publicEntries() {
    return this.entries.filter((entry) => entry.role === 'user' || entry.role === 'ai');
  }

  entriesAfter(turnId, { excludeSenderId } = {}) {
    return this.publicEntries().filter((entry) => {
      if (entry.turnId <= turnId) {
        return false;
      }
      if (excludeSenderId && entry.senderId === excludeSenderId) {
        return false;
      }
      return true;
    });
  }

  latestTurnId() {
    if (this.entries.length === 0) {
      return 0;
    }
    return this.entries[this.entries.length - 1].turnId;
  }

  previousAIResponses() {
    return this.entries.filter((entry) => entry.role === 'ai');
  }

  characterLength() {
    return this.publicEntries().reduce((sum, entry) => sum + entry.text.length, 0);
  }
}

module.exports = {
  TranscriptStore
};
