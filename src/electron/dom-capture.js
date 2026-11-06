'use strict';

function cssStringList(selectors) {
  return JSON.stringify(selectors || []);
}

class DomCapture {
  constructor({ webContents }) {
    this.webContents = webContents;
    this.captureState = new Map();
  }

  // Scrape the model name the provider is currently running, from the model switcher /
  // badge. Tries per-provider modelSelectors first, then generic model-switcher heuristics.
  // Returns a short label string ('' if none found). Metadata only — no page content.
  async detectModelLabel(provider = {}) {
    const modelSelectors = Array.isArray(provider.modelSelectors) ? provider.modelSelectors : [];
    return this.webContents.executeJavaScript(`
      (() => {
        const sels = ${cssStringList(modelSelectors)};
        const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
        // 1) Per-provider selectors.
        for (const s of sels) {
          try { const el = document.querySelector(s); if (el) { const t = clean(el.getAttribute('aria-label') || el.innerText || el.textContent); if (t) return t; } } catch (_e) {}
        }
        // 2) Generic: a model-switcher button/badge usually contains a model name keyword.
        const KW = /(gpt|claude|gemini|qwen|kimi|deepseek|grok|glm|llama|opus|sonnet|haiku|flash|turbo|mini|pro|max|o[13]\\b|r1|thinking|reason)/i;
        const cands = document.querySelectorAll('button,[role="button"],[class*="model" i],[data-testid*="model" i],[aria-label*="model" i],[class*="switch" i] *');
        // Bound the scan so a huge/provider-mutated DOM can't make this expensive.
        const MAX = 400;
        const n = Math.min(cands.length, MAX);
        for (let i = 0; i < n; i += 1) {
          try {
            const el = cands[i];
            const t = clean(el.getAttribute('aria-label') || el.innerText || el.textContent);
            if (t && t.length <= 60 && KW.test(t)) return t;
          } catch (_e) {}
        }
        return '';
      })();
    `).catch(() => '');
  }

  async count(selector) {
    return this.webContents.executeJavaScript(`
      (() => {
        try { return document.querySelectorAll(${JSON.stringify(selector)}).length; }
        catch (_error) { return 0; }
      })();
    `);
  }

  // Count only nodes that are actually visible (used for Stop-button streaming detection).
  async countVisible(selector) {
    return this.webContents.executeJavaScript(`
      (() => {
        try {
          let n = 0;
          for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
            const s = window.getComputedStyle(el);
            if (s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0) n++;
          }
          return n;
        } catch (_error) { return 0; }
      })();
    `);
  }

  async captureLatest({ id = 'provider', responseSelectors = [], thinkingSelectors = [], stabilityMs = 0 }) {
    const captured = await this.webContents.executeJavaScript(`
      (() => {
        const providerId = ${JSON.stringify(id)};
        const responseSelectors = ${cssStringList(responseSelectors)};
        const thinkingSelectors = ${cssStringList(thinkingSelectors)};
        const stabilityMs = ${JSON.stringify(stabilityMs || 0)};
        const isInsideThinking = (node) => thinkingSelectors.some((selector) => {
          try { return node.closest && node.closest(selector); } catch (_error) { return false; }
        });
        // Collect non-empty assistant candidates across all response selectors (skipping
        // thinking blocks), then take the LAST one in DOM order = the newest assistant
        // turn. Selectors should be scoped per-provider (assistant-only) so a broad
        // fallback doesn't capture chrome; ordering here is DOM order, which keeps the
        // newest reply even when strict + fallback selectors both match the same node.
        // Read a node's answer text with any DESCENDANT thinking panels removed first. If a
        // response selector matches a PARENT message container that holds a thinking child,
        // a plain innerText would include the reasoning — so clone, strip thinking descendants,
        // then read. This guarantees reasoning never rides into the answer/transcript.
        const answerTextOf = (node) => {
          try {
            let hasThinkingChild = false;
            for (const sel of thinkingSelectors) {
              try { if (node.querySelector && node.querySelector(sel)) { hasThinkingChild = true; break; } } catch (_e) {}
            }
            if (!hasThinkingChild) return (node.innerText || node.textContent || '').trim();
            const clone = node.cloneNode(true);
            for (const sel of thinkingSelectors) {
              try { clone.querySelectorAll(sel).forEach((n) => n.remove()); } catch (_e) {}
            }
            return (clone.innerText || clone.textContent || '').trim();
          } catch (_e) {
            return (node.innerText || node.textContent || '').trim();
          }
        };
        const candidates = [];
        for (const selector of responseSelectors) {
          try {
            for (const node of document.querySelectorAll(selector)) {
              if (!isInsideThinking(node)) {
                const text = answerTextOf(node);
                if (text) candidates.push({ selector, node, text });
              }
            }
          } catch (_error) {}
        }
        // De-dupe by node, then pick the one that appears LAST in document order.
        let latest = { selector: null, text: '' };
        if (candidates.length) {
          const ordered = candidates.sort((a, b) => {
            if (a.node === b.node) return 0;
            const pos = a.node.compareDocumentPosition(b.node);
            return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
          });
          const last = ordered[ordered.length - 1];
          latest = { selector: last.selector, text: last.text, node: last.node };
        }
        // Capture the AI's REASONING/thinking from its OWN DOM element (deepseek "Deep
        // Thinking", qwen/grok reasoning panels). It is excluded from the answer above; here
        // we associate it with THIS turn's answer: prefer the thinking node closest to the
        // latest answer node (reasoning usually sits just before its answer), so a stale
        // panel from a prior turn isn't mis-paired. Falls back to the last thinking node when
        // there is no answer node yet. Never merged into the answer text.
        let reasoning = '';
        const thinkingNodes = [];
        for (const selector of thinkingSelectors) {
          try { for (const n of document.querySelectorAll(selector)) thinkingNodes.push(n); } catch (_error) {}
        }
        if (thinkingNodes.length) {
          thinkingNodes.sort((a, b) => {
            if (a === b) return 0;
            const pos = a.compareDocumentPosition(b);
            return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
          });
          let chosen = thinkingNodes[thinkingNodes.length - 1];
          const ansNode = latest.node;
          if (ansNode) {
            // Prefer the LAST thinking node that PRECEDES (or contains/equals) the answer node —
            // that's this turn's reasoning; ignore thinking that appears AFTER the answer.
            let best = null;
            for (const tn of thinkingNodes) {
              try {
                const rel = tn.compareDocumentPosition(ansNode);
                const precedesOrContains = (rel & Node.DOCUMENT_POSITION_FOLLOWING) || (rel & Node.DOCUMENT_POSITION_CONTAINED_BY) || tn === ansNode || tn.contains(ansNode);
                if (precedesOrContains) best = tn; // keep the latest such node (array is in DOM order)
              } catch (_e) {}
            }
            chosen = best;
          }
          reasoning = chosen ? (chosen.innerText || chosen.textContent || '').trim() : '';
        }
        return {
          selector: latest.selector, text: latest.text,
          reasoning,
          stabilityMs,
          stable: false
        };
      })();
    `);
    const previous = this.captureState.get(id);
    const changedAt = previous && previous.text === captured.text ? previous.changedAt : Date.now();
    this.captureState.set(id, { text: captured.text, changedAt });
    const stableForMs = Date.now() - changedAt;
    return { ...captured, stableForMs, stable: !captured.text || stabilityMs <= 0 || stableForMs >= stabilityMs };
  }

  async xray(provider) {
    return this.webContents.executeJavaScript(`
      (() => {
        const provider = ${JSON.stringify(provider)};
        const selectorCounts = {};
        for (const [group, selectors] of Object.entries(provider)) {
          if (!Array.isArray(selectors)) continue;
          selectorCounts[group] = selectors.map((selector) => {
            try { return { selector, count: document.querySelectorAll(selector).length }; }
            catch (error) { return { selector, count: 0, error: error.message }; }
          });
        }
        return {
          url: location.href,
          title: document.title,
          selectorCounts
        };
      })();
    `);
  }
}

module.exports = {
  DomCapture
};
