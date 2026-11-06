'use strict';

const NETWORK_EVENTS = new Set([
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFinished',
  'Network.eventSourceMessageReceived',
  'Network.webSocketFrameReceived'
]);

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.search = url.search ? '?redacted=1' : '';
    url.hash = '';
    url.username = '';
    url.password = '';
    if (!['https:', 'http:'].includes(url.protocol)) return '[redacted-url]';
    return url.toString();
  } catch (_error) {
    return '[redacted-url]';
  }
}

const SAFE_HEADER_NAMES = new Set([
  ':status',
  'status',
  'content-type',
  'content-length',
  'date',
  'cache-control',
  'expires',
  'last-modified'
]);

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (SAFE_HEADER_NAMES.has(normalizedKey)) {
      output[key] = value;
    } else {
      output[key] = '[redacted]';
    }
  }
  return output;
}

// Network-frame fields that carry raw request/response bodies. Their values are never
// safe metadata, so redactObject replaces them with a length-only marker.
const BODY_TEXT_KEYS = new Set(['data', 'payloadData', 'postData', 'postDataEntries', 'body', 'payload']);

function redactObject(value) {
  if (Array.isArray(value)) {
    return value.map(redactObject);
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      return redactUrl(value);
    }
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/cookie|authorization|token|secret|apikey|api-key/i.test(key)) {
      output[key] = '[redacted]';
    } else if (BODY_TEXT_KEYS.has(key)) {
      // SSE 'data', WebSocket 'payloadData', and request 'postData'/'body' carry the raw
      // streamed model response (and any account/email/session id in those frames). The
      // redactionPolicy.redactBodyText contract forbids persisting that — store metadata only.
      output[key] = typeof item === 'string' ? `[redacted-body:${item.length}]` : '[redacted-body]';
    } else if (key === 'url' && typeof item === 'string') {
      output[key] = redactUrl(item);
    } else if (key === 'headers' || key === 'requestHeaders' || key === 'responseHeaders') {
      output[key] = redactHeaders(item);
    } else {
      output[key] = redactObject(item);
    }
  }
  return output;
}

class CdpMonitor {
  constructor({ webContents, traceStore, providerId, maxEvents = 2000 }) {
    this.webContents = webContents;
    this.traceStore = traceStore;
    this.providerId = providerId;
    this.enabled = false;
    this.events = [];
    this.maxEvents = maxEvents;
    this.attachedHere = false;
    this.listener = (_event, method, params) => this.handleEvent(method, params);
    this.detachListener = () => {
      this.webContents.debugger.off('message', this.listener);
      this.webContents.debugger.off('detach', this.detachListener);
      this.enabled = false;
      this.attachedHere = false;
      if (this.traceStore) this.traceStore.event('CDP_MONITOR_DETACHED', { providerId: this.providerId });
    };
  }

  async start() {
    if (this.enabled) {
      return;
    }
    if (!this.webContents.debugger.isAttached()) {
      this.webContents.debugger.attach('1.3');
      this.attachedHere = true;
    }
    this.webContents.debugger.on('message', this.listener);
    this.webContents.debugger.on('detach', this.detachListener);
    try {
      await this.webContents.debugger.sendCommand('Network.enable');
      this.enabled = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.webContents.debugger.off('message', this.listener);
    this.webContents.debugger.off('detach', this.detachListener);
    if (this.attachedHere && this.webContents.debugger.isAttached()) {
      this.webContents.debugger.detach();
    }
    this.enabled = false;
    this.attachedHere = false;
  }

  handleEvent(method, params) {
    if (!NETWORK_EVENTS.has(method)) {
      return;
    }
    const entry = {
      providerId: this.providerId,
      method,
      params: redactObject(params),
      createdAt: new Date().toISOString()
    };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) this.events.shift();
    if (this.traceStore) {
      this.traceStore.event('CDP_NETWORK_EVENT', entry);
    }
  }

  snapshot() {
    return [...this.events];
  }
}

module.exports = {
  CdpMonitor,
  NETWORK_EVENTS,
  redactHeaders,
  redactObject,
  redactUrl
};
