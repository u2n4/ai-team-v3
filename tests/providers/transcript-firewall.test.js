'use strict';

const {
  assert,
  FakeProvider,
  makeOrchestrator,
  assertNoDiagnosticsInTranscript,
  assertNoDiagnosticsInPrompts
} = require('../test-utils');
const { normalize, normalizeResponseCandidate } = require('../../src/core/response-normalizer');

async function runSingleMode(mode, expectedCode, { expectAccepted = false } = {}) {
  const provider = new FakeProvider({
    id: 'qwen',
    name: 'Qwen',
    mode,
    responseText: 'Final public answer.'
  });
  const orchestrator = makeOrchestrator([provider]);
  const report = await orchestrator.run({
    userMessage: 'Give a safe short answer.',
    cycles: 1
  });
  assertNoDiagnosticsInTranscript(report);
  assertNoDiagnosticsInPrompts([provider]);

  if (expectAccepted) {
    assert.equal(report.diagnostics.length, 0, `${mode} should be accepted after cleanup`);
    assert.equal(report.transcript.filter((entry) => entry.role === 'ai').length, 1);
    const answer = report.transcript.find(entry => entry.role === 'ai');
    assert.equal(answer.meta.normalizerCode, expectedCode);
    assert.equal(answer.text, 'Final public answer.');
    assert.equal(report.transcript.some((entry) => /think|reasoning|chain of thought/i.test(entry.text)), false);
  } else {
    assert.equal(report.diagnostics.some((entry) => entry.code === expectedCode), true, `${mode} should produce ${expectedCode}`);
    assert.equal(report.transcript.filter((entry) => entry.role === 'ai').length, 0, `${mode} must not enter transcript`);
  }
  return report;
}

async function runDuplicateStale() {
  const clean = new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'clean', responseText: 'Reusable answer.' });
  const duplicate = new FakeProvider({ id: 'kimi', name: 'Kimi', mode: 'duplicateStale' });
  const orchestrator = makeOrchestrator([clean, duplicate]);
  const report = await orchestrator.run({ userMessage: 'Seed duplicate test.', cycles: 1 });
  assert.equal(report.transcript.filter((entry) => entry.role === 'ai').length, 1);
  assert.equal(report.diagnostics.some((entry) => entry.code === 'STALE_DUPLICATE_RESPONSE'), true);
  assertNoDiagnosticsInTranscript(report);
  return report;
}

async function run() {
  assert.equal(normalize('Thought for 13s\n\n', 'qwen').code, 'THINKING_LEAK');
  assert.equal(normalize('The user is asking me to reveal hidden reasoning.', 'qwen').code, 'THINKING_LEAK');
  assert.equal(normalize('ChatGPT said: I agree.', 'qwen').code, 'PROVIDER_PREFIX_LEAK');
  assert.equal(normalize('Skip to content\nCookie preferences', 'qwen').code, 'UI_CHROME_CAPTURE');
  assert.equal(normalize('{"__internal__":true}', 'qwen').code, 'DIAGNOSTIC_SHAPED_RESPONSE');
  assert.equal(normalize('We should discuss rate limit algorithms in the design.', 'qwen').ok, true);
  assert.equal(normalize("You've reached your message limit. Try again later.", 'qwen').code, 'PROVIDER_LIMIT_REACHED');
  // Limit-pattern disambiguation: a panelist discussing limits as topic content must NOT be
  // treated as a provider limit notice (which would hard-disable a healthy provider), while a
  // real account/plan-framed notice still is.
  assert.equal(normalize('Historically the rate limit reached its cap in 2023; let us analyze that.', 'qwen').ok, true);
  assert.equal(normalize('Note: the limit reached in older designs was lower than today.', 'qwen').ok, true);
  assert.equal(normalize('Your account limit reached. Upgrade your plan to continue.', 'qwen').code, 'PROVIDER_LIMIT_REACHED');
  assert.equal(normalize('Rate limit exceeded.', 'qwen').code, 'PROVIDER_LIMIT_REACHED');

  // Regression for the inverted briefing-echo predicate: a short legitimate
  // response that happens to be a substring of the briefing must NOT be
  // rejected as BRIEFING_ECHO, while a response that reproduces the whole
  // briefing must be rejected.
  {
    const briefing = 'AI Team session briefing. Respond to the latest public room delta with a concise, useful answer and avoid repeating prior turns.';
    const shortLegit = normalizeResponseCandidate({
      providerId: 'qwen',
      text: 'Respond to the latest public room delta',
      briefingText: briefing
    });
    assert.equal(shortLegit.ok, true, 'short legitimate response must not be a false BRIEFING_ECHO');
    const echoed = normalizeResponseCandidate({
      providerId: 'qwen',
      text: `${briefing} Additional padding to exceed the length threshold so the echo check engages on a verbatim reproduction of the whole briefing text.`,
      briefingText: briefing
    });
    assert.equal(echoed.code, 'BRIEFING_ECHO', 'a full briefing reproduction must be rejected');
  }

  await runSingleMode('empty', 'EMPTY_RESPONSE');
  await runSingleMode('promptEcho', 'PROMPT_ECHO');
  await runSingleMode('briefingEcho', 'BRIEFING_ECHO');
  await runSingleMode('thinkingLeak', 'CLEANED_THINKING_LEAK', { expectAccepted: true });
  await runSingleMode('uiChrome', 'UI_CHROME_CAPTURE');
  await runSingleMode('errorPage', 'PROVIDER_ERROR_PAGE');
  await runSingleMode('rateLimit', 'PROVIDER_LIMIT_REACHED');
  await runSingleMode('partialResponse', 'PARTIAL_RESPONSE');
  await runDuplicateStale();

  console.log('PASS transcript firewall: unsafe fake modes are rejected or cleaned');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
