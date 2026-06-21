'use strict';

const EventEmitter = require('node:events');

class EventBus extends EventEmitter {
  emitEvent(type, payload = {}) {
    return this.emit(type, {
      type,
      payload,
      createdAt: new Date().toISOString()
    });
  }
}

module.exports = {
  EventBus
};
