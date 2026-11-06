'use strict';

const { normalizeResponseCandidate } = require('./response-normalizer');
const { redactSensitiveText } = require('./redact');
const { withDeadline } = require('./deadline');

// Reduce a send-controller result to verification METADATA only. Never carry
// composerTextAfterSend (the raw prompt) into a diagnostic — the report contract
// (redactBodyText) forbids raw prompt/response text in persisted artifacts.
function summarizeSendResult(sendResult) {
  if (!sendResult || typeof sendResult !== 'object') {
    return { verified: false };
  }
  return {
    verified: sendResult.verified === true,
    verifyReason: sendResult.verifyReason,
    code: sendResult.code,
    responseCountSelector: sendResult.responseCountSelector,
    baselineResponseCount: sendResult.baselineResponseCount,
    finalResponseCount: sendResult.finalResponseCount
  };
}

const PROVIDER_STATES = Object.freeze({
  IDLE: 'IDLE',
  PREPARING_PROMPT: 'PREPARING_PROMPT',
  BUDGET_CHECK: 'BUDGET_CHECK',
  READY_TO_SEND: 'READY_TO_SEND',
  SENDING: 'SENDING',
  SEND_VERIFIED: 'SEND_VERIFIED',
  WAITING_RESPONSE: 'WAITING_RESPONSE',
  CAPTURE_CANDIDATE: 'CAPTURE_CANDIDATE',
  NORMALIZING_RESPONSE: 'NORMALIZING_RESPONSE',
  CAPTURED: 'CAPTURED',
  FAILED_DIAGNOSTIC: 'FAILED_DIAGNOSTIC',
  COOLDOWN: 'COOLDOWN',
  DISABLED_FOR_RUN: 'DISABLED_FOR_RUN'
});

const VALID_TRANSITIONS = Object.freeze({
  IDLE: ['PREPARING_PROMPT', 'DISABLED_FOR_RUN'],
  PREPARING_PROMPT: ['BUDGET_CHECK', 'FAILED_DIAGNOSTIC'],
  BUDGET_CHECK: ['READY_TO_SEND', 'FAILED_DIAGNOSTIC'],
  READY_TO_SEND: ['SENDING', 'FAILED_DIAGNOSTIC'],
  SENDING: ['SEND_VERIFIED', 'FAILED_DIAGNOSTIC'],
  SEND_VERIFIED: ['WAITING_RESPONSE', 'FAILED_DIAGNOSTIC'],
  WAITING_RESPONSE: ['CAPTURE_CANDIDATE', 'FAILED_DIAGNOSTIC'],
  CAPTURE_CANDIDATE: ['NORMALIZING_RESPONSE', 'FAILED_DIAGNOSTIC'],
  NORMALIZING_RESPONSE: ['CAPTURED', 'FAILED_DIAGNOSTIC'],
  CAPTURED: ['COOLDOWN'],
  FAILED_DIAGNOSTIC: ['COOLDOWN'],
  COOLDOWN: ['IDLE', 'DISABLED_FOR_RUN'],
  DISABLED_FOR_RUN: []
});

class ProviderActor {
  constructor({
    provider,
    transcriptStore,
    diagnosticsStore,
    traceStore,
    promptLedger,
    promptBuilder,
    budgetGuard,
    quotaGuard,
    reasoningStore = null
  }) {
    this.provider = provider;
    this.providerId = provider.id;
    this.providerName = provider.name || provider.id;
    this.transcriptStore = transcriptStore;
    this.diagnosticsStore = diagnosticsStore;
    this.traceStore = traceStore;
    this.promptLedger = promptLedger;
    this.promptBuilder = promptBuilder;
    this.budgetGuard = budgetGuard;
    this.quotaGuard = quotaGuard;
    // Optional: separate channel for each AI's reasoning/thinking (kept out of transcript).
    this.reasoningStore = reasoningStore;
    this.state = PROVIDER_STATES.IDLE;
  }

  transition(toState, meta = {}) {
    const fromState = this.state;
    const allowed = VALID_TRANSITIONS[fromState] || [];
    if (!allowed.includes(toState)) {
      throw new Error(`Invalid provider state transition for ${this.providerId}: ${fromState} -> ${toState}`);
    }
    this.state = toState;
    if (this.onState) this.onState(toState, meta);
    this.traceStore.transition(this.providerId, fromState, toState, meta);
  }

  failDiagnostic(code, message, details = {}) {
    this.diagnosticsStore.add({
      providerId: this.providerId,
      code,
      severity: details.severity || 'warning',
      message,
      details
    });
    this.transition(PROVIDER_STATES.FAILED_DIAGNOSTIC, { code });
    this.transition(PROVIDER_STATES.COOLDOWN, { code });
    if (this.quotaGuard.isDisabled(this.providerId)) {
      this.transition(PROVIDER_STATES.DISABLED_FOR_RUN, { code });
    } else {
      this.transition(PROVIDER_STATES.IDLE, { code });
    }
    return {
      ok: false,
      providerId: this.providerId,
      code,
      diagnostic: true,
      message: redactSensitiveText(message)
    };
  }

  async runTurn({ cycleIndex, turnIndex, userGoal, activeProviders }) {
    if (!this.quotaGuard.canSend(this.providerId)) {
      if (this.state !== PROVIDER_STATES.DISABLED_FOR_RUN) {
        this.transition(PROVIDER_STATES.DISABLED_FOR_RUN, { reason: 'quota_guard' });
      }
      this.diagnosticsStore.add({
        providerId: this.providerId,
        code: 'PROVIDER_DISABLED_FOR_RUN',
        message: `${this.providerName} is disabled for this run.`
      });
      return { ok: false, providerId: this.providerId, code: 'PROVIDER_DISABLED_FOR_RUN' };
    }

    try {
    this.transition(PROVIDER_STATES.PREPARING_PROMPT, { cycleIndex, turnIndex });
    const prompt = this.promptBuilder({
      providerId: this.providerId,
      providerName: this.providerName,
      cycleIndex,
      turnIndex,
      userGoal,
      transcriptStore: this.transcriptStore,
      promptLedger: this.promptLedger,
      activeProviders
    });

    this.transition(PROVIDER_STATES.BUDGET_CHECK, { promptMode: prompt.promptMode });
    const budget = this.budgetGuard.check({
      providerId: this.providerId,
      cycleIndex,
      turnIndex,
      promptText: prompt.text,
      sections: prompt.sections,
      includedTurnIds: prompt.includedTurnIds,
      transcriptChars: this.transcriptStore.characterLength()
    });
    this.traceStore.event('PROMPT_BUDGET_CHECK', budget.metrics);

    try {
      this.budgetGuard.assertWithinBudget(prompt.text, budget.metrics.limitChars, budget.metrics);
    } catch (error) {
      if (error.code === 'PROMPT_OVER_BUDGET') {
        return this.failDiagnostic('PROMPT_OVER_BUDGET', 'Prompt exceeded provider budget and was blocked before send.', error.metrics);
      }
      throw error;
    }

    this.transition(PROVIDER_STATES.READY_TO_SEND, budget.metrics);
      this.transition(PROVIDER_STATES.SENDING, { promptChars: budget.metrics.promptChars });
      this.quotaGuard.recordSendAttempt(this.providerId);
      const cancelPending = () => {
        this.quotaGuard.disableForRun(this.providerId);
        if (this.provider.cancelPending) this.provider.cancelPending();
      };
      const sendResult = await withDeadline(() => this.provider.send(prompt.text, {
        prompt,
        budget,
        transcriptStore: this.transcriptStore
      }), this.provider.sendTimeoutMs || 45000, 'PROVIDER_SEND_TIMEOUT', cancelPending);
      if (!sendResult || sendResult.verified !== true) {
        this.quotaGuard.recordFailure(this.providerId);
        // Store only verification metadata — never composerTextAfterSend, which is the
        // raw prompt the firewall/redaction contract forbids in reports/diagnostics.
        return this.failDiagnostic('SEND_NOT_VERIFIED', `Provider send could not be verified (${redactSensitiveText(sendResult && (sendResult.verifyReason || sendResult.code) || 'no acknowledgement')}).`, {
          sendResult: summarizeSendResult(sendResult)
        });
      }
      this.quotaGuard.recordPromptSent(this.providerId, budget.metrics.promptChars);
      this.promptLedger.commitDelivery(this.providerId, {
        promptMode: prompt.promptMode,
        latestTurnId: prompt.latestTurnId,
        includedTurnIds: prompt.includedTurnIds,
        promptChars: budget.metrics.promptChars
      });

      // Trace metadata ONLY — summarizeSendResult drops composerTextAfterSend (the raw
      // prompt), which the redaction contract forbids in traces/reports.
      this.transition(PROVIDER_STATES.SEND_VERIFIED, { sendResult: summarizeSendResult(sendResult) });
      this.transition(PROVIDER_STATES.WAITING_RESPONSE, {});
      const capture = await withDeadline(() => this.provider.waitForResponse({
        prompt,
        transcriptStore: this.transcriptStore,
        timeoutMs: this.provider.timeoutMs
      }), this.provider.timeoutMs || 60000, 'PROVIDER_RESPONSE_TIMEOUT', cancelPending);

      this.transition(PROVIDER_STATES.CAPTURE_CANDIDATE, { hasText: Boolean(capture && capture.text) });
      this.transition(PROVIDER_STATES.NORMALIZING_RESPONSE, {});
      const normalized = normalizeResponseCandidate({
        providerId: this.providerId,
        text: capture && capture.text,
        promptText: prompt.text,
        briefingText: prompt.sections.briefing,
        transcriptStore: this.transcriptStore,
        // Reasoning captured from the provider's own DOM thinking panel (deepseek/qwen/grok).
        // Preferred over inline <think> extraction when present.
        capturedReasoning: capture && capture.reasoning
      });

      if (!normalized.ok) {
        if (normalized.limitDetected) {
          this.quotaGuard.markLimitDetected(this.providerId);
        } else {
          this.quotaGuard.recordFailure(this.providerId);
        }
        // Metadata only: the rejected text may be secret-/account-shaped (it tripped the
        // firewall). Persist its length, not its content, so the run report stays clean.
        return this.failDiagnostic(normalized.code, `Response rejected by transcript firewall: ${normalized.code}`, {
          rejectedLength: String(normalized.text || '').length,
          limitDetected: normalized.limitDetected === true
        });
      }

      const transcriptEntry = this.transcriptStore.appendAIResponse({
        providerId: this.providerId,
        providerName: this.providerName,
        text: normalized.text,
        meta: {
          normalizerCode: normalized.code,
          removedThinking: normalized.removedThinking === true,
          hasReasoning: Boolean(normalized.reasoning)
        }
      });
      // The ANSWER went to the transcript above. Store the AI's reasoning/thinking SEPARATELY
      // (never in the transcript), so the UI can show "what this AI is thinking" on its own.
      if (this.reasoningStore && normalized.reasoning) {
        this.reasoningStore.append({
          providerId: this.providerId,
          providerName: this.providerName,
          turnId: transcriptEntry.turnId,
          reasoning: normalized.reasoning
        });
      }
      this.quotaGuard.recordSuccess(this.providerId);
      this.transition(PROVIDER_STATES.CAPTURED, { turnId: transcriptEntry.turnId, normalizerCode: normalized.code });
      this.transition(PROVIDER_STATES.COOLDOWN, { ok: true });
      this.transition(PROVIDER_STATES.IDLE, { ok: true });
      return {
        ok: true,
        providerId: this.providerId,
        text: normalized.text,
        transcriptEntry,
        budget: budget.metrics
      };
    } catch (error) {
      this.quotaGuard.recordFailure(this.providerId);
      // Keep the error name and a redacted message; drop the raw stack (it can embed
      // filesystem paths / env detail) from the report-visible diagnostic.
      return this.failDiagnostic(/^PROVIDER_(SEND|RESPONSE)_TIMEOUT$|^WEBVIEW_CLOSED$/.test(error.code || '') ? error.code : 'PROVIDER_RUNTIME_ERROR', redactSensitiveText(error.message), {
        name: error.name
      });
    }
  }
}

module.exports = {
  ProviderActor,
  PROVIDER_STATES,
  VALID_TRANSITIONS
};
