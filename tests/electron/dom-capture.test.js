'use strict';

const { assert } = require('../test-utils');
const { DomCapture } = require('../../src/electron/dom-capture');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../../src/providers/webview-provider-adapter');

async function run() {
  assert.equal(DEFAULT_PROVIDER_DEFINITIONS.qwen.stabilityMs >= 2000, true);
  assert.equal(DEFAULT_PROVIDER_DEFINITIONS.kimi.stabilityMs >= 2000, true);

  let executedScript = '';
  const domCapture = new DomCapture({
    webContents: {
      async executeJavaScript(script) {
        executedScript = script;
        return { text: 'candidate', stable: false, stabilityMs: 2400, stableForMs: 200 };
      }
    }
  });

  const result = await domCapture.captureLatest(DEFAULT_PROVIDER_DEFINITIONS.kimi);
  assert.equal(result.stable, false);
  assert.equal(executedScript.includes('__aiTeamV3CaptureState'), true);
  assert.equal(executedScript.includes('stabilityMs'), true);
  assert.equal(executedScript.includes('"kimi"'), true);

  console.log('PASS dom capture: per-provider stability window is wired');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
