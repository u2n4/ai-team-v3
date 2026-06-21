'use strict';

const { BaseProvider } = require('./base-provider');

const FAKE_PROVIDER_MODES = Object.freeze([
  'clean',
  'empty',
  'delayed',
  'timeout',
  'promptEcho',
  'briefingEcho',
  'thinkingLeak',
  'uiChrome',
  'errorPage',
  'rateLimit',
  'duplicateStale',
  'partialResponse'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeProvider extends BaseProvider {
  constructor({
    id,
    name,
    mode = 'clean',
    responseText,
    delayMs = 25,
    timeoutMs = 120
  }) {
    super({ id, name, timeoutMs });
    if (!FAKE_PROVIDER_MODES.includes(mode)) {
      throw new Error(`Unsupported fake provider mode: ${mode}`);
    }
    this.mode = mode;
    this.responseText = responseText;
    this.delayMs = delayMs;
    this.sentPrompts = [];
  }

  async send(promptText, context = {}) {
    this.sentPrompts.push({
      text: promptText,
      context,
      createdAt: new Date().toISOString()
    });
    return {
      ok: true,
      verified: true,
      method: 'fake'
    };
  }

  async waitForResponse({ prompt, transcriptStore }) {
    if (this.mode === 'delayed') {
      await sleep(this.delayMs);
    }
    if (this.mode === 'timeout') {
      await sleep(this.timeoutMs + 20);
      throw new Error('Fake provider timed out.');
    }

    const cleanText = this.responseText || `${this.name} clean response ${this.sentPrompts.length}.`;
    switch (this.mode) {
      case 'clean':
      case 'delayed':
        return { text: cleanText };
      case 'empty':
        return { text: '' };
      case 'promptEcho':
        return { text: prompt.text };
      case 'briefingEcho':
        return { text: prompt.sections.briefing || '[AI TEAM SESSION BRIEFING]' };
      case 'thinkingLeak':
        return { text: `<think>I should hide this reasoning.</think>\n${cleanText}` };
      case 'uiChrome':
        return { text: 'New chat\nUpgrade plan\nLog in\nAttach file\nKeyboard shortcuts\nPrivacy policy' };
      case 'errorPage':
        return { text: 'Something went wrong. Service unavailable. Try again later.' };
      case 'rateLimit':
        return { text: 'You have reached your usage limit. Please try again later.' };
      case 'duplicateStale': {
        const previous = transcriptStore.previousAIResponses()[0];
        return { text: previous ? previous.text : cleanText };
      }
      case 'partialResponse':
        return { text: `${cleanText}\nStop generating` };
      default:
        return { text: cleanText };
    }
  }
}

function createFakeProviders(providerIds, mode = 'clean') {
  return providerIds.map((id) => new FakeProvider({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    mode
  }));
}

module.exports = {
  FakeProvider,
  FAKE_PROVIDER_MODES,
  createFakeProviders
};
