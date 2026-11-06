'use strict';

const { TranscriptStore } = require('./transcript-store');
const { DiagnosticsStore } = require('./diagnostics-store');
const { TraceStore } = require('./trace-store');
const { PromptLedger } = require('./prompt-ledger');
const { BudgetGuard } = require('./budget-guard');
const { QuotaGuard } = require('./quota-guard');
const { ProviderHealthStore } = require('./provider-health');
const { ReasoningStore } = require('./reasoning-store');
const { buildPrompt } = require('./prompt-builder');
const { ProviderActor } = require('./provider-actor');

class Orchestrator {
  constructor({
    providers,
    transcriptStore = new TranscriptStore(),
    diagnosticsStore = new DiagnosticsStore(),
    traceStore = new TraceStore(),
    promptLedger = new PromptLedger(),
    budgetGuard = new BudgetGuard(),
    quotaGuard = new QuotaGuard(),
    providerHealthStore = new ProviderHealthStore(),
    reasoningStore = new ReasoningStore()
  }) {
    this.providers = providers;
    this.transcriptStore = transcriptStore;
    this.diagnosticsStore = diagnosticsStore;
    this.traceStore = traceStore;
    this.promptLedger = promptLedger;
    this.budgetGuard = budgetGuard;
    this.quotaGuard = quotaGuard;
    this.providerHealthStore = providerHealthStore;
    this.reasoningStore = reasoningStore;
    this.actors = providers.map((provider) => new ProviderActor({
      provider,
      transcriptStore,
      diagnosticsStore,
      traceStore,
      promptLedger,
      promptBuilder: buildPrompt,
      budgetGuard,
      quotaGuard,
      reasoningStore
    }));
  }

  async run({ userMessage, cycles = 1, userGoal = userMessage, turnDelayMs = 0, onTurnResult = null }) {
    if (userMessage) {
      this.transcriptStore.appendUser({ text: userMessage });
    }

    const results = [];
    const totalTurns = cycles * this.actors.length;
    let turnsRun = 0;
    for (let cycleIndex = 1; cycleIndex <= cycles; cycleIndex += 1) {
      let turnIndex = 0;
      for (const actor of this.actors) {
        turnIndex += 1;
        const activeProviders = this.providers
          .filter((provider) => !this.quotaGuard.isDisabled(provider.id))
          .map((provider) => provider.name || provider.id);
        const startedAt = Date.now();
        const result = await actor.runTurn({
          cycleIndex,
          turnIndex,
          userGoal,
          activeProviders
        });
        if (result.ok) {
          this.providerHealthStore.markSuccess(result.providerId, {
            responseTimeMs: Date.now() - startedAt
          });
        } else {
          this.providerHealthStore.markFailure(result.providerId, {
            code: result.code || 'PROVIDER_FAILURE'
          });
        }
        results.push(result);
        if (onTurnResult) await onTurnResult(result);
        turnsRun += 1;
        // Human-ish pause between turns so a fast back-to-back loop doesn't trip
        // per-account rate limits / bot challenges (researched best practice). Skipped
        // after the final turn.
        if (turnDelayMs > 0 && turnsRun < totalTurns) {
          await new Promise((resolve) => setTimeout(resolve, turnDelayMs));
        }
      }
    }

    return this.report(results);
  }

  report(results = []) {
    return {
      results,
      transcript: this.transcriptStore.list(),
      diagnostics: this.diagnosticsStore.list(),
      traces: this.traceStore.list(),
      promptLedger: this.promptLedger.snapshot(),
      quota: this.quotaGuard.snapshot(),
      health: this.providerHealthStore.snapshot(),
      // Each AI's reasoning/thinking, captured separately from the answers in transcript.
      reasoning: this.reasoningStore ? this.reasoningStore.list() : []
    };
  }
}

module.exports = {
  Orchestrator
};
