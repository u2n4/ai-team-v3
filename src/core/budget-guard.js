'use strict';

const DEFAULT_PROMPT_LIMITS = Object.freeze({
  chatgpt: 12000,
  claude: 8000,
  perplexity: 8000,
  gemini: 12000,
  deepseek: 12000,
  qwen: 12000,
  kimi: 12000
});

class PromptOverBudgetError extends Error {
  constructor(metrics) {
    super(`Prompt exceeds budget: ${metrics.promptChars} chars > ${metrics.limitChars} chars for ${metrics.providerId || 'provider'}.`);
    this.name = 'PromptOverBudgetError';
    this.code = 'PROMPT_OVER_BUDGET';
    this.metrics = metrics;
  }
}

function estimateTokensFromChars(chars) {
  return Math.ceil(chars / 4);
}

class BudgetGuard {
  constructor({ limits = DEFAULT_PROMPT_LIMITS } = {}) {
    this.limits = { ...limits };
  }

  limitFor(providerId) {
    return this.limits[providerId] || 8000;
  }

  check({ providerId, cycleIndex, turnIndex, promptText, sections, includedTurnIds, transcriptChars }) {
    const promptChars = String(promptText || '').length;
    const briefingChars = sections && sections.briefing ? sections.briefing.length : 0;
    const deltaChars = sections && sections.delta ? sections.delta.length : 0;
    const metrics = {
      providerId,
      cycleIndex,
      turnIndex,
      promptChars,
      estimatedTokens: estimateTokensFromChars(promptChars),
      briefingChars,
      deltaChars,
      transcriptChars: transcriptChars || 0,
      includedTurnIds: [...(includedTurnIds || [])],
      limitChars: this.limitFor(providerId)
    };

    return {
      ok: promptChars <= metrics.limitChars,
      code: promptChars <= metrics.limitChars ? 'PROMPT_WITHIN_BUDGET' : 'PROMPT_OVER_BUDGET',
      metrics
    };
  }

  assertWithinBudget(renderedPromptString, providerCap, meta = {}) {
    const promptChars = String(renderedPromptString || '').length;
    const metrics = {
      providerId: meta.providerId,
      cycleIndex: meta.cycleIndex,
      turnIndex: meta.turnIndex,
      promptChars,
      estimatedTokens: estimateTokensFromChars(promptChars),
      briefingChars: meta.briefingChars || 0,
      deltaChars: meta.deltaChars || 0,
      transcriptChars: meta.transcriptChars || 0,
      includedTurnIds: [...(meta.includedTurnIds || [])],
      limitChars: providerCap
    };
    if (promptChars > providerCap) {
      throw new PromptOverBudgetError(metrics);
    }
    return metrics;
  }
}

module.exports = {
  BudgetGuard,
  PromptOverBudgetError,
  DEFAULT_PROMPT_LIMITS,
  estimateTokensFromChars
};
