'use strict';

const { assert, FakeProvider } = require('../test-utils');
const { PromptLedger } = require('../../src/core/prompt-ledger');
const { BudgetGuard, PromptOverBudgetError } = require('../../src/core/budget-guard');
const { TranscriptStore } = require('../../src/core/transcript-store');
const { DiagnosticsStore } = require('../../src/core/diagnostics-store');
const { TraceStore } = require('../../src/core/trace-store');
const { QuotaGuard } = require('../../src/core/quota-guard');
const { ProviderActor, PROVIDER_STATES } = require('../../src/core/provider-actor');
const { buildPrompt } = require('../../src/core/prompt-builder');

async function run() {
  const ledger = new PromptLedger();
  assert.equal(ledger.hasDeliveredBriefing('qwen'), false);
  ledger.markBriefingDelivered('qwen');
  assert.equal(ledger.hasDeliveredBriefing('qwen'), true);
  ledger.markDelivered('qwen', 42);
  assert.equal(ledger.getLastDeliveredTurnId('qwen'), 42);

  const budgetGuard = new BudgetGuard();
  assert.throws(
    () => budgetGuard.assertWithinBudget('x'.repeat(20093), 12000, { providerId: 'qwen' }),
    PromptOverBudgetError
  );

  const transcriptStore = new TranscriptStore();
  assert.throws(() => {
    transcriptStore.appendAIResponse({
      providerId: 'qwen',
      text: 'internal',
      meta: { diagnostic: true }
    });
  }, /Diagnostics must not be appended/);

  const actor = new ProviderActor({
    provider: new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'clean' }),
    transcriptStore,
    diagnosticsStore: new DiagnosticsStore(),
    traceStore: new TraceStore(),
    promptLedger: new PromptLedger(),
    promptBuilder: buildPrompt,
    budgetGuard,
    quotaGuard: new QuotaGuard()
  });
  assert.throws(() => actor.transition(PROVIDER_STATES.CAPTURED), /Invalid provider state transition/);
  actor.transition(PROVIDER_STATES.PREPARING_PROMPT, { reason: 'unit' });
  actor.transition(PROVIDER_STATES.BUDGET_CHECK, { reason: 'unit' });

  // Firewall-rejected responses must leave only metadata in diagnostics — never the raw
  // rejected text (which can be secret-/account-shaped). A reject turn stores rejectedLength,
  // not rawTextPreview.
  const rejectDiagnostics = new DiagnosticsStore();
  const rejectActor = new ProviderActor({
    provider: new FakeProvider({ id: 'qwen', name: 'Qwen', mode: 'promptEcho' }),
    transcriptStore: new TranscriptStore(),
    diagnosticsStore: rejectDiagnostics,
    traceStore: new TraceStore(),
    promptLedger: new PromptLedger(),
    promptBuilder: buildPrompt,
    budgetGuard: new BudgetGuard(),
    quotaGuard: new QuotaGuard()
  });
  const rejectCanary = 'rejected-body-canary-9f2b';
  const rejectResult = await rejectActor.runTurn({ cycleIndex: 1, turnIndex: 0, userGoal: rejectCanary, activeProviders: ['qwen'] });
  assert.equal(rejectResult.ok, false);
  const rejectEntry = rejectDiagnostics.list().find((d) => d.details && 'rejectedLength' in d.details);
  assert.equal(Boolean(rejectEntry), true);
  assert.equal(typeof rejectEntry.details.rejectedLength, 'number');
  assert.equal('rawTextPreview' in rejectEntry.details, false);
  assert.equal(JSON.stringify(rejectDiagnostics.list()).includes(rejectCanary), false, 'Rejected body must be absent from every diagnostic field');

  console.log('PASS API contracts: compatibility APIs, typed budget error, transcript assertion, invalid transition guard, reject diagnostics carry metadata only');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
