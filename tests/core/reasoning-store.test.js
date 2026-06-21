'use strict';

const { assert, FakeProvider, makeOrchestrator } = require('../test-utils');
const { ReasoningStore } = require('../../src/core/reasoning-store');
const { normalizeResponseCandidate } = require('../../src/core/response-normalizer');

async function run() {
  // 1) The normalizer separates the AI's thinking from its answer.
  const r = normalizeResponseCandidate({
    providerId: 'qwen',
    text: '<think>The user wants a greeting. Keep it short.</think>Hello! How can I help?',
    promptText: 'hi',
    briefingText: ''
  });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Hello! How can I help?');                 // answer only
  assert.equal(r.text.includes('user wants'), false);             // no thinking in the answer
  assert.equal(r.reasoning.includes('user wants a greeting'), true); // thinking captured
  assert.equal(r.removedThinking, true);

  // A clean answer with no thinking yields empty reasoning.
  const clean = normalizeResponseCandidate({ providerId: 'qwen', text: 'Just a plain answer.', promptText: 'x', briefingText: '' });
  assert.equal(clean.reasoning, '');
  assert.equal(clean.removedThinking, false);

  // 2) ReasoningStore: append-only, scoped per provider, ignores empty.
  const store = new ReasoningStore();
  assert.equal(store.append({ providerId: 'qwen', providerName: 'Qwen', reasoning: '' }), null); // empty ignored
  store.append({ providerId: 'qwen', providerName: 'Qwen', turnId: 1, reasoning: 'first thought' });
  store.append({ providerId: 'kimi', providerName: 'Kimi', turnId: 2, reasoning: 'kimi thought' });
  assert.equal(store.list().length, 2);
  assert.equal(store.byProvider('qwen').length, 1);
  assert.equal(store.latestForProvider('kimi').reasoning, 'kimi thought');
  assert.throws(() => store.append({ reasoning: 'no provider' }), /providerId is required/);

  // 3) End-to-end: a thinking-leak provider's THINKING never enters the transcript, but the
  //    cleaned answer does, and the reasoning is captured in the orchestrator's reasoning store.
  const reasoningStore = new ReasoningStore();
  const thinker = new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'thinkingLeak' });
  const orchestrator = makeOrchestrator([thinker], { reasoningStore });
  const report = await orchestrator.run({ userMessage: 'Give a short answer.', cycles: 1 });

  // Answer present in transcript, with no thinking-shaped text.
  const aiTurns = report.transcript.filter((e) => e.role === 'ai');
  assert.equal(aiTurns.length, 1);
  assert.equal(/think|chain of thought|the user is asking/i.test(aiTurns[0].text), false);
  // Reasoning captured separately and exposed on the report.
  assert.equal(Array.isArray(report.reasoning), true);

  console.log('PASS reasoning store: AI thinking is captured separately and never enters the transcript');
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = run;
