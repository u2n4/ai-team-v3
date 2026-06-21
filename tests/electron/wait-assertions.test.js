'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { assert } = require('../test-utils');
const {
  waitForComposerClear,
  waitForCondition,
  waitForResponseCountIncrement,
  waitForStableText
} = require('../../src/electron/wait-assertions');

async function run() {
  let attempts = 0;
  const condition = await waitForCondition(async () => {
    attempts += 1;
    return attempts >= 2 ? { ok: true } : null;
  }, { timeoutMs: 1000, pollMs: 1 });
  assert.equal(condition.ok, true);

  let count = 0;
  const increment = await waitForResponseCountIncrement(async () => {
    count += 1;
    return count;
  }, 1, { timeoutMs: 1000, pollMs: 1 });
  assert.equal(increment.finalCount, 2);

  let composer = 'pending';
  const clearPromise = waitForComposerClear(async () => composer, { timeoutMs: 1000, pollMs: 1 });
  composer = '';
  const cleared = await clearPromise;
  assert.equal(cleared.cleared, true);

  let stableReads = 0;
  const stable = await waitForStableText(async () => {
    stableReads += 1;
    return stableReads === 1 ? 'streaming' : 'stable';
  }, { stableMs: 2, timeoutMs: 1000, pollMs: 1 });
  assert.equal(stable.text, 'stable');

  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'electron', 'wait-assertions.js'), 'utf8');
  assert.equal(source.includes('waitForTimeout'), false);
  assert.equal(source.includes('waitForCondition'), true);

  console.log('PASS wait assertions: Playwright-like waits use conditions, not fixed-sleep-only strategy');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
