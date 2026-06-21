'use strict';

const {
  assert,
  FakeProvider,
  makeOrchestrator,
  countOccurrences,
  assertNoDiagnosticsInPrompts
} = require('../test-utils');
const { roundGoal } = require('../../src/core/prompt-builder');

async function run() {
  // roundGoal must keep rotating distinct per-cycle jobs in long runs, not clamp every
  // cycle past 3 to the same "final position" instruction (which caused providers to repeat
  // verbatim and trip STALE_DUPLICATE / NO_OP_LOOP).
  const goals = [];
  for (let cycle = 1; cycle <= 7; cycle += 1) {
    goals.push(roundGoal(cycle).goal);
  }
  // Cycles 1..5 are all distinct, and cycle 6 wraps back to cycle 1 (modulo cycling).
  assert.equal(new Set(goals.slice(0, 5)).size, 5);
  assert.equal(goals[5], goals[0]);
  // The old clamp bug: cycles 3,4,5 were identical. Guard against regression.
  assert.equal(goals[2] === goals[3], false);
  assert.equal(goals[3] === goals[4], false);

  const qwen = new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'clean' });
  const kimi = new FakeProvider({ id: 'kimi', name: 'Kimi', mode: 'clean' });
  const orchestrator = makeOrchestrator([qwen, kimi]);
  const userMessage = 'Initial shared request.';
  const report = await orchestrator.run({ userMessage, cycles: 2 });

  assert.equal(report.diagnostics.length, 0);
  assert.equal(qwen.sentPrompts.length, 2);
  assert.equal(kimi.sentPrompts.length, 2);

  // The first prompt carries the briefing (which now states the discussion topic =
  // userGoal) AND the user's opening turn in the delta, so the topic text appears twice
  // in turn 1 by design. The invariant that matters is that LATER turns are delta-only.
  assert.ok(qwen.sentPrompts[0].text.includes(userMessage), 'first prompt should include the user request');
  assert.equal(qwen.sentPrompts[1].text.includes(userMessage), false, 'later Qwen prompt must not resend old user turn');
  assert.equal(qwen.sentPrompts[1].text.includes('Kimi clean response 1.'), true, 'later Qwen prompt should include new Kimi delta');
  assert.equal(qwen.sentPrompts[1].text.includes('Qwen clean response 1.'), false, 'provider should not receive its own prior answer');

  assert.equal(kimi.sentPrompts[1].text.includes(userMessage), false, 'later Kimi prompt must not resend old user turn');
  assert.equal(kimi.sentPrompts[1].text.includes('Qwen clean response 2.'), true, 'later Kimi prompt should include new Qwen delta');
  assert.equal(kimi.sentPrompts[1].text.includes('Kimi clean response 1.'), false, 'provider should not receive its own prior answer');
  assertNoDiagnosticsInPrompts([qwen, kimi]);

  const qwenLedger = report.promptLedger.find((entry) => entry.providerId === 'qwen');
  assert.equal(qwenLedger.briefingDelivered, true);
  assert.deepEqual(qwenLedger.sentPrompts.map((entry) => entry.promptMode), ['briefing', 'delta']);

  console.log('PASS delta context: later turns are delta-only and avoid full transcript resend');
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
