'use strict';

const { assert } = require('../test-utils');
const { SendController, verifySendObservation } = require('../../src/electron/send-controller');
const { DiagnosticsStore } = require('../../src/core/diagnostics-store');

async function run() {
  assert.deepEqual(verifySendObservation({
    ok: true,
    responseCountSelector: '.answer',
    baselineResponseCount: 1,
    finalResponseCount: 2,
    composerTextAfterSend: 'still here'
  }).verifyReason, 'response_count_increment');

  assert.deepEqual(verifySendObservation({
    ok: true,
    responseCountSelector: '.answer',
    baselineResponseCount: 1,
    finalResponseCount: 1,
    composerTextAfterSend: '   '
  }).verifyReason, 'composer_clear');

  assert.equal(verifySendObservation({
    ok: true,
    responseCountSelector: '.answer',
    baselineResponseCount: 1,
    finalResponseCount: 1,
    composerTextAfterSend: 'prompt still in composer'
  }).verified, false);

  const diagnosticsStore = new DiagnosticsStore();
  const webContents = {
    async executeJavaScript(script) {
      assert.equal(script.includes('responseCountSelector'), true);
      assert.equal(script.includes('composerTextAfterSend'), true);
      return {
        ok: true,
        method: 'click',
        inputSelector: 'textarea',
        sendSelector: 'button[type="submit"]',
        responseCountSelector: '.answer',
        baselineResponseCount: 1,
        finalResponseCount: 1,
        composerTextAfterSend: 'not sent'
      };
    }
  };
  const controller = new SendController({ webContents, diagnosticsStore, verificationTimeoutMs: 1, verificationPollMs: 1 });
  const result = await controller.sendPrompt({
    provider: {
      id: 'qwen',
      inputSelectors: ['textarea'],
      sendSelectors: ['button[type="submit"]'],
      responseCountSelector: '.answer'
    },
    promptText: 'hello'
  });

  assert.equal(result.verified, false);
  assert.equal(result.code, 'SEND_NOT_VERIFIED');
  assert.equal(diagnosticsStore.hasCode('SEND_NOT_VERIFIED', 'qwen'), true);

  // Burst-typing latency fix: emitting chars in bursts must still place EVERY character
  // (no dropped input), and the composer-contains-text verification must still gate.
  const longText = 'x'.repeat(200) + 'HELLO_TAIL_😀';
  const typedChars = [];
  let jsCall = 0;
  const typingWebContents = {
    focus() {},
    sendInputEvent(event) {
      if (event && event.type === 'char') typedChars.push(event.keyCode);
    },
    async executeJavaScript() {
      jsCall += 1;
      if (jsCall === 1) return { x: 10, y: 10 };           // composer box lookup
      if (jsCall === 2) return true;                        // composer-contains-text check
      return {                                              // sendPrompt observation
        ok: true, method: 'click', inputSelector: 'textarea', sendSelector: 'button',
        responseCountSelector: '.answer', baselineResponseCount: 1, finalResponseCount: 1,
        composerTextAfterSend: 'prompt still here'
      };
    }
  };
  const typingController = new SendController({
    webContents: typingWebContents, diagnosticsStore: new DiagnosticsStore(),
    hostWindow: null, verificationTimeoutMs: 1, verificationPollMs: 1
  });
  const typingResult = await typingController.sendPrompt({
    provider: { id: 'qwen', inputSelectors: ['textarea'], sendSelectors: ['button'], responseCountSelector: '.answer' },
    promptText: longText
  });
  // Every code point placed, in order — bursting did not drop any char (Array.from handles the emoji surrogate pair).
  assert.equal(typedChars.length, Array.from(longText).length);
  assert.equal(typedChars.join(''), longText);
  // Composer not clear + no count increment -> still gated as unverified (safety net intact).
  assert.equal(typingResult.verified, false);
  assert.equal(typingResult.code, 'SEND_NOT_VERIFIED');

  console.log('PASS send controller: verification requires composer clear or response count increment, burst typing places full text');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
