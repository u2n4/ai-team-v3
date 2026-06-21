'use strict';

const { assert } = require('../test-utils');
const { WebviewProviderAdapter, DEFAULT_PROVIDER_DEFINITIONS } = require('../../src/providers/webview-provider-adapter');

async function run() {
  let sentPayload = null;
  const sendController = {
    async sendPrompt(payload) {
      sentPayload = payload;
      return { ok: true, verified: true, verifyReason: 'unit' };
    }
  };

  let waitPayload = null;
  const lifecycleMonitor = {
    async waitForStableResponse(payload) {
      waitPayload = payload;
      return { text: 'stable response', finalCount: 2 };
    }
  };

  const domCapture = { marker: 'dom-capture-fixture' };
  const definition = DEFAULT_PROVIDER_DEFINITIONS.qwen;
  const adapter = new WebviewProviderAdapter({
    definition,
    sendController,
    lifecycleMonitor,
    domCapture
  });

  const sendResult = await adapter.send('hello', { cycleIndex: 1 });
  assert.equal(sendResult.verified, true);
  assert.equal(sentPayload.provider, definition);
  assert.equal(sentPayload.promptText, 'hello');
  assert.deepEqual(sentPayload.context, { cycleIndex: 1 });

  const response = await adapter.waitForResponse({ promptId: 'p1' });
  assert.equal(response.text, 'stable response');
  assert.equal(waitPayload.provider, definition);
  assert.deepEqual(waitPayload.context, { promptId: 'p1' });
  assert.equal(waitPayload.domCapture, domCapture);

  console.log('PASS webview provider adapter: live waitForResponse path uses LifecycleMonitor and DomCapture');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
