'use strict';

function resolveStabilityMs(provider, fallbackStableMs) {
  const providerStableMs = provider && Number(provider.stabilityMs);
  if (Number.isFinite(providerStableMs) && providerStableMs >= 0) {
    return providerStableMs;
  }
  return fallbackStableMs;
}

class LifecycleMonitor {
  constructor({ webContents, traceStore }) {
    this.webContents = webContents;
    this.traceStore = traceStore;
  }

  async waitForStableResponse({
    provider,
    domCapture,
    timeoutMs = 60000,
    stableMs = 1200,
    pollMs = 250,
    baselineCount = null,
    baselineText = ''
  }) {
    const startedAt = Date.now();
    const effectiveStableMs = resolveStabilityMs(provider, stableMs);
    // Prefer a baseline captured BEFORE the prompt was sent (passed in by the caller).
    // Falling back to a baseline taken here would race the provider's own echo and let
    // pre-existing answers count as a fresh response.
    const effectiveBaselineCount = Number.isFinite(baselineCount)
      ? baselineCount
      : await domCapture.count(provider.responseCountSelector);
    const baseText = String(baselineText || '');
    let lastText = '';
    let lastChangedAt = Date.now();
    let lastCandidate = { text: '' };

    const stopSelectors = Array.isArray(provider.stopSelectors) ? provider.stopSelectors : [];
    let sawGenerationSignal = false;

    while (Date.now() - startedAt < timeoutMs) {
      const count = await domCapture.count(provider.responseCountSelector);
      const candidate = await domCapture.captureLatest(provider);
      if (candidate.text && candidate.text !== lastText) {
        lastText = candidate.text;
        lastCandidate = candidate;
        lastChangedAt = Date.now();
      }
      // A real new response means either a new response node appeared, or the latest
      // captured text differs from what was on screen before we sent the prompt.
      const textIsNew = Boolean(lastText) && lastText !== baseText;
      const hasNewResponse = count > effectiveBaselineCount || textIsNew;

      // Streaming completion via the Stop button: once it appears (generation started)
      // and then disappears (generation ended), the answer is complete — accept it
      // without waiting out the full stability window. More reliable than stableMs alone
      // for providers that stream tokens for tens of seconds.
      const generating = stopSelectors.length ? await this.hasActiveStopSignal(domCapture, stopSelectors) : false;
      sawGenerationSignal = sawGenerationSignal || generating;
      // The Stop control vanishing means generation ended, but some providers render the
      // final markdown a beat AFTER hiding Stop. Require a short post-stop settle (text
      // unchanged for ~600ms) so we don't forward a truncated answer.
      const POST_STOP_SETTLE_MS = Math.min(600, effectiveStableMs);
      const doneByStopSignal = sawGenerationSignal && !generating
        && Date.now() - lastChangedAt >= POST_STOP_SETTLE_MS;

      const providerStable = candidate.stable !== false;
      const textStable = providerStable && Date.now() - lastChangedAt >= effectiveStableMs;
      const stable = hasNewResponse && lastText && (doneByStopSignal || textStable);
      if (stable) {
        return {
          text: lastCandidate.text,
          // The AI's reasoning/thinking captured from its own DOM panel (kept separate from
          // the answer text, surfaced on the reasoning channel). Empty when none.
          reasoning: lastCandidate.reasoning || candidate.reasoning || '',
          selector: lastCandidate.selector,
          baselineCount: effectiveBaselineCount,
          finalCount: count,
          stableMs: effectiveStableMs,
          completedBy: doneByStopSignal ? 'stop_signal' : 'text_stable'
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(`Timed out waiting for stable ${provider.id} response.`);
  }

  // True while a generation/"Stop" control is visible on the page. Used to detect the
  // streaming start→end transition. Text-selectors (text=/.../) are ignored here.
  async hasActiveStopSignal(domCapture, stopSelectors) {
    if (!domCapture || typeof domCapture.countVisible !== 'function') return false;
    for (const selector of stopSelectors) {
      if (/^text=/i.test(String(selector))) continue;
      try {
        const result = await domCapture.countVisible(selector);
        if (Number(result) > 0) return true;
      } catch (_error) {}
    }
    return false;
  }

}

module.exports = {
  LifecycleMonitor,
  resolveStabilityMs
};
