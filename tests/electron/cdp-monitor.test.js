'use strict';

const { assert } = require('../test-utils');
const { redactHeaders, redactObject } = require('../../src/electron/cdp-monitor');

async function run() {
  const headers = redactHeaders({
    'Content-Type': 'text/event-stream',
    'Content-Length': '12',
    Authorization: 'Bearer secret',
    Cookie: 'sid=secret'
  });

  assert.equal(headers['Content-Type'], 'text/event-stream');
  assert.equal(headers['Content-Length'], '12');
  assert.equal(headers.Authorization, '[redacted]');
  assert.equal(headers.Cookie, '[redacted]');

  const redacted = redactObject({
    request: {
      url: 'https://example.test/path?token=abc',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret'
      }
    }
  });

  assert.equal(redacted.request.url, 'https://example.test/path?redacted=1');
  assert.equal(redacted.request.headers['Content-Type'], 'application/json');
  assert.equal(redacted.request.headers.Authorization, '[redacted]');

  // SSE/WebSocket body fields carry the raw streamed response — they must never be stored.
  const sse = redactObject({ requestId: 'r1', eventName: 'message', data: 'token stream with secret answer text' });
  assert.equal(sse.requestId, 'r1');
  assert.equal(sse.data.startsWith('[redacted-body'), true);
  assert.equal(sse.data.includes('secret answer text'), false);

  const ws = redactObject({ response: { opcode: 1, payloadData: 'streamed assistant reply with account@id.com' } });
  assert.equal(ws.response.opcode, 1);
  assert.equal(ws.response.payloadData.startsWith('[redacted-body'), true);
  assert.equal(ws.response.payloadData.includes('account@id.com'), false);

  console.log('PASS CDP monitor: safe header allowlist keeps useful metadata and redacts secrets');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
