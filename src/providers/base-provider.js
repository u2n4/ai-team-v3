'use strict';

class BaseProvider {
  constructor({ id, name, timeoutMs = 30000 }) {
    if (!id) {
      throw new Error('Provider id is required.');
    }
    this.id = id;
    this.name = name || id;
    this.timeoutMs = timeoutMs;
  }

  async send() {
    throw new Error(`${this.id} does not implement send().`);
  }

  async waitForResponse() {
    throw new Error(`${this.id} does not implement waitForResponse().`);
  }
}

module.exports = {
  BaseProvider
};
