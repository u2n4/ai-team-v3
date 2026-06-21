'use strict';

const { assert } = require('../test-utils');
const { LifecycleMonitor, resolveStabilityMs } = require('../../src/electron/lifecycle-monitor');

async function run() {
  assert.equal(resolveStabilityMs({ stabilityMs: 2400 }, 1200), 2400);
  assert.equal(resolveStabilityMs({ stabilityMs: 0 }, 1200), 0);
  assert.equal(resolveStabilityMs({}, 1200), 1200);

  const monitor = new LifecycleMonitor({
    webContents: {
      async executeJavaScript() {
        throw new Error('waitForStableResponse must not call webContents.executeJavaScript directly');
      }
    }
  });

  let countCalls = 0;
  const domCapture = {
    async count() {
      countCalls += 1;
      return countCalls === 1 ? 0 : 1;
    },
    async captureLatest(provider) {
      assert.equal(provider.stabilityMs, 0);
      return {
        selector: '.answer',
        text: 'stable answer',
        stable: true
      };
    }
  };

  const result = await monitor.waitForStableResponse({
    provider: {
      id: 'qwen',
      responseCountSelector: '.answer',
      stabilityMs: 0
    },
    domCapture,
    stableMs: 1200,
    pollMs: 1,
    timeoutMs: 50
  });

  assert.equal(result.text, 'stable answer');
  assert.equal(result.stableMs, 0);
  assert.equal(result.finalCount, 1);

  console.log('PASS lifecycle monitor: provider stabilityMs overrides fallback stable window');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
