'use strict';

const { assert } = require('../test-utils');
const { validateDiscussionRequest } = require('../../src/electron/main');

// The in-app discussion handler validates its request BEFORE opening any provider window.
// These guards keep the feature safe and predictable: no empty prompts, at least two AIs,
// rounds clamped to a sane range, and a hard refusal while another discussion is running.
async function run() {
  // Empty / whitespace prompt -> rejected.
  assert.equal(validateDiscussionRequest({ prompt: '   ', roster: ['kimi', 'grok'] }).code, 'EMPTY_PROMPT');
  assert.equal(validateDiscussionRequest({ roster: ['kimi', 'grok'] }).code, 'EMPTY_PROMPT');

  // Fewer than two AIs -> rejected (a discussion needs at least two voices).
  assert.equal(validateDiscussionRequest({ prompt: 'hi', roster: ['kimi'] }).code, 'ROSTER_TOO_SMALL');
  assert.equal(validateDiscussionRequest({ prompt: 'hi', roster: [] }).code, 'ROSTER_TOO_SMALL');
  assert.equal(validateDiscussionRequest({ prompt: 'hi' }).code, 'ROSTER_TOO_SMALL');

  // Already running -> rejected, regardless of otherwise-valid input.
  assert.equal(
    validateDiscussionRequest({ prompt: 'hi', roster: ['kimi', 'grok'] }, { inFlight: true }).code,
    'DISCUSSION_IN_FLIGHT'
  );

  // Valid request -> ok, roster lowercased, rounds clamped to [1,20].
  const ok = validateDiscussionRequest({ prompt: '  Discuss X  ', roster: ['Kimi', 'GROK', 'qwen'], rounds: 5 });
  assert.equal(ok.ok, true);
  assert.equal(ok.promptText, 'Discuss X');
  assert.deepEqual(ok.roster, ['kimi', 'grok', 'qwen']);
  assert.equal(ok.cycles, 5);

  // Rounds clamping: too low -> 1, too high -> 20, garbage -> default 3.
  assert.equal(validateDiscussionRequest({ prompt: 'x', roster: ['qwen', 'kimi'], rounds: 0 }).cycles, 1);
  assert.equal(validateDiscussionRequest({ prompt: 'x', roster: ['qwen', 'kimi'], rounds: 999 }).cycles, 20);
  assert.equal(validateDiscussionRequest({ prompt: 'x', roster: ['qwen', 'kimi'], rounds: 'abc' }).cycles, 3);

  console.log('PASS discussion request validation (prompt, roster size, in-flight guard, rounds clamp)');
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = run;
