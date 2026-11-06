'use strict';

const UI_CHROME_PATTERNS = [
  /\bskip to content\b/i,
  /\bcookie preferences\b/i,
  /\bnew chat\b/i,
  /\bupgrade plan\b/i,
  /\blog in\b/i,
  /\bsign up\b/i,
  /\battach file\b/i,
  /\bsidebar\b/i,
  /\bkeyboard shortcuts\b/i,
  /\bterms of use\b/i,
  /\bprivacy policy\b/i
];

const PROVIDER_PREFIX_PATTERNS = [
  /^\s*(chatgpt|claude|gemini|deepseek|qwen|kimi|perplexity)\s*(said)?\s*:/im
];

const DIAGNOSTIC_PATTERNS = [
  /\[SYSTEM DIAGNOSTIC\]/i,
  /"__internal__"\s*:/i,
  /"diagnostic"\s*:\s*true/i,
  /\bPROMPT_OVER_BUDGET\b/i,
  /\bFAILED_DIAGNOSTIC\b/i
];

const ERROR_PATTERNS = [
  /\bsomething went wrong\b/i,
  /\btry again later\b/i,
  /\bservice unavailable\b/i,
  /\bapplication error\b/i,
  /\b502 bad gateway\b/i,
  /\b503 service unavailable\b/i
];

// Limit detection disables a provider immediately (no 3-strike grace), so the patterns must
// match a PROVIDER limit notice, not an answer that merely discusses limits as content. The
// already-specific notices (quota/rate-limit/"you have reached … limit") stay; the two bare
// phrases ("limit reached", "too many requests") are anchored to account/provider framing so
// a panelist saying "the rate limit reached in 2023…" no longer kills a healthy provider.
const LIMIT_PATTERNS = [
  /\bquota exceeded\b/i,
  /\bmessage limit\b/i,
  /\busage limit\b/i,
  /\brate limit exceeded\b/i,
  /\byou have reached\b.*\blimit\b/i,
  /\byou've reached\b.*\blimit\b/i,
  // "limit reached" / "rate limit reached/hit" / "too many requests" only count as a
  // provider notice when paired with account/plan or retry framing — so a panelist
  // discussing limits as topic content does not disable a healthy provider.
  /\b(your|account|daily|plan|free|trial)\b[^.\n]{0,40}\b(rate )?limit (reached|hit)\b/i,
  /\b(rate )?limit (reached|hit)\b[^.\n]{0,40}\b(upgrade|try again|reset|plan|account)\b/i,
  /\btoo many requests\b[^.\n]{0,40}\b(try again|slow down|wait|later)\b/i,
  /\b(try again|slow down|wait)\b[^.\n]{0,40}\btoo many requests\b/i
];

const CHALLENGE_PATTERNS = [
  /\bcloudflare\b/i,
  /\bverify you are human\b/i,
  /\bcaptcha\b/i,
  /\bchecking your browser\b/i,
  /\bsecurity check\b/i
];

const THINKING_PATTERNS = [
  /<think>[\s\S]*?<\/think>/gi,
  // grok/qwen reasoning preface at the START of the answer: "Thought for 3s" (en) /
  // "فكرت لمدة 3s" (ar). Strip ONLY the preface, not the whole answer, so the real
  // content is forwarded to the next provider. Plus any provider self-label.
  /^\s*(?:thought for|فكّ?رت\s+لمدة)\s*\d+\s*(?:s|sec|secs|seconds|ث|ثانية|ثوان)?\b[\s.:،-]*/i,
  /^\s*[A-Za-z][A-Za-z]*['’]s response[\s:.-]+/i,
  // Generic mid-text reasoning blocks that run to a blank line.
  /\bthe user is asking\b[\s\S]*?(?:\n\n|$)/gi,
  /\bthinking[:\s]+[\s\S]*?(?:\n\n|$)/gi,
  /\breasoning[:\s]+[\s\S]*?(?:\n\n|$)/gi,
  /\bchain of thought\b[\s\S]*?(?:\n\n|$)/gi,
  /\binternal reasoning\b[\s\S]*?(?:\n\n|$)/gi
];

const PARTIAL_PATTERNS = [
  /\btyping\b\.?$/i,
  /\bgenerating\b\.?$/i,
  /\bstop generating\b/i,
  /\bcontinue generating\b/i,
  /\bresponse paused\b/i
];

const SECRET_LEAK_PATTERNS = [
  /\bauthorization["']?\s*[:=]\s*bearer\s+[a-z0-9._~+/=-]+/i,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?id|client[_-]?secret)["']?\s*[:=]\s*['"]?[a-z0-9._~+/=-]{8,}/i,
  /\bsk-[a-z0-9_-]{12,}/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/i
];

const UNSAFE_INSTRUCTION_PATTERNS = [
  /\bbypass\b[\s\S]*\b(captcha|cloudflare|login|rate limit|paywall|paid wall)\b/i,
  /\bexport\b[\s\S]*\b(cookies|tokens|session storage|local storage)\b/i,
  /\bcopy\b[\s\S]*\b(cookies|tokens|session ids?|authorization headers?)\b/i,
  /\bdisable\b[\s\S]*\b(transcript firewall|quota guard|budget guard|approval gate)\b/i
];

function compactText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeForCompare(text) {
  return compactText(text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

function hasPattern(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function stripThinking(text) {
  let cleaned = text;
  let removed = false;
  const reasoningParts = [];
  for (const pattern of THINKING_PATTERNS) {
    // Capture the reasoning we strip (so it can be shown separately as "what the AI is
    // thinking") instead of discarding it. The ANSWER (cleaned) still goes to the transcript
    // answer-only; the reasoning is returned on its own channel.
    const matches = cleaned.match(pattern);
    if (matches) {
      for (const m of matches) {
        const piece = String(m || '').trim();
        if (piece) reasoningParts.push(piece);
      }
    }
    const next = cleaned.replace(pattern, '').trim();
    if (next !== cleaned.trim()) {
      removed = true;
      cleaned = next;
    }
  }
  // Clean the captured reasoning: drop XML tags and the bare "Thought for Ns" prefaces so the
  // reasoning text itself is readable on its own.
  const reasoning = compactText(
    reasoningParts
      .map((p) => p.replace(/^<think>/i, '').replace(/<\/think>$/i, '').trim())
      .filter(Boolean)
      .join('\n\n')
  );
  return {
    cleaned: compactText(cleaned),
    removed,
    reasoning
  };
}

function looksLikePromptEcho(text, promptText) {
  const candidate = normalizeForCompare(text);
  const prompt = normalizeForCompare(promptText);
  if (!candidate || !prompt) {
    return false;
  }
  return candidate === prompt || (candidate.length > 800 && candidate.includes(prompt.slice(0, Math.min(400, prompt.length))));
}

function looksLikeBriefingEcho(text, briefingText) {
  const candidate = normalizeForCompare(text);
  const briefing = normalizeForCompare(briefingText);
  if (!candidate) {
    return false;
  }
  if (candidate.includes('ai team session briefing')) {
    return true;
  }
  if (!briefing) {
    return false;
  }
  // A briefing echo is when the RESPONSE reproduces the briefing — not the
  // reverse. The old `briefing.includes(candidate)` falsely rejected any short
  // legitimate response that happened to be a substring of the briefing.
  // Mirror looksLikePromptEcho: only flag a long response that contains the
  // briefing's opening.
  return candidate === briefing
    || (candidate.length > 200 && candidate.includes(briefing.slice(0, Math.min(300, briefing.length))));
}

// A stale duplicate is any provider re-emitting a previously-captured response verbatim —
// either its own (cached/old answer) or another provider's full answer (capture
// contamination). We intentionally compare against ALL providers' history: catching
// cross-provider verbatim duplicates protects against one provider's answer leaking into
// another's capture, which is the higher-value guarantee. (Rare consensus modes where two
// panelists give an identical one-liner are handled at the mode level, not here — loosening
// this guard would re-open the contamination path the firewall exists to block.) The
// providerId arg is accepted for callers that want same-provider-only semantics in future.
function isDuplicateStale(text, transcriptStore, providerId = null) {
  const candidate = normalizeForCompare(text);
  if (!candidate || !transcriptStore) {
    return false;
  }
  void providerId;
  return transcriptStore.previousAIResponses().some((entry) => normalizeForCompare(entry.text) === candidate);
}

function normalizeResponseCandidate({ providerId, text, promptText = '', briefingText = '', transcriptStore, capturedReasoning = '' }) {
  const rawText = compactText(text);
  if (!rawText) {
    return { ok: false, code: 'EMPTY_RESPONSE', providerId, text: '' };
  }

  if (hasPattern(CHALLENGE_PATTERNS, rawText)) {
    return { ok: false, code: 'PROVIDER_CHALLENGE', providerId, text: rawText };
  }
  if (hasPattern(DIAGNOSTIC_PATTERNS, rawText)) {
    return { ok: false, code: 'DIAGNOSTIC_SHAPED_RESPONSE', providerId, text: rawText };
  }
  if (hasPattern(PROVIDER_PREFIX_PATTERNS, rawText)) {
    return { ok: false, code: 'PROVIDER_PREFIX_LEAK', providerId, text: rawText };
  }
  if (hasPattern(LIMIT_PATTERNS, rawText)) {
    return { ok: false, code: 'PROVIDER_LIMIT_REACHED', providerId, text: rawText, limitDetected: true };
  }
  if (hasPattern(ERROR_PATTERNS, rawText)) {
    return { ok: false, code: 'PROVIDER_ERROR_PAGE', providerId, text: rawText };
  }
  if (looksLikePromptEcho(rawText, promptText)) {
    return { ok: false, code: 'PROMPT_ECHO', providerId, text: rawText };
  }
  if (looksLikeBriefingEcho(rawText, briefingText)) {
    return { ok: false, code: 'BRIEFING_ECHO', providerId, text: rawText };
  }
  if (isDuplicateStale(rawText, transcriptStore, providerId)) {
    return { ok: false, code: 'STALE_DUPLICATE_RESPONSE', providerId, text: rawText };
  }
  if (hasPattern(PARTIAL_PATTERNS, rawText)) {
    return { ok: false, code: 'PARTIAL_RESPONSE', providerId, text: rawText };
  }
  if (hasPattern(SECRET_LEAK_PATTERNS, rawText)) {
    return { ok: false, code: 'SECRET_LEAK_RESPONSE', providerId, text: rawText };
  }
  if (hasPattern(UNSAFE_INSTRUCTION_PATTERNS, rawText)) {
    return { ok: false, code: 'UNSAFE_INSTRUCTION_RESPONSE', providerId, text: rawText };
  }

  const thinkingResult = stripThinking(rawText);
  if (thinkingResult.removed && !thinkingResult.cleaned) {
    return { ok: false, code: 'THINKING_LEAK', providerId, text: rawText };
  }
  // Re-check duplicates on the CLEANED text: a stale prior answer prefixed with
  // "Thought for Ns" / "فكرت لمدة" evades the raw duplicate check above but is a dup
  // once the preface is stripped.
  if (thinkingResult.removed && isDuplicateStale(thinkingResult.cleaned, transcriptStore, providerId)) {
    return { ok: false, code: 'STALE_DUPLICATE_RESPONSE', providerId, text: rawText };
  }

  const uiChromeHitCount = UI_CHROME_PATTERNS.reduce((count, pattern) => count + (pattern.test(rawText) ? 1 : 0), 0);
  if (uiChromeHitCount >= 2) {
    return { ok: false, code: 'UI_CHROME_CAPTURE', providerId, text: rawText };
  }

  // Prefer reasoning captured from the provider's own DOM thinking panel (richer, e.g.
  // deepseek/qwen "Deep Thinking"); fall back to any inline <think>/preface we stripped.
  const reasoning = compactText(capturedReasoning) || thinkingResult.reasoning || '';
  return {
    ok: true,
    code: (thinkingResult.removed || reasoning) ? 'CLEANED_THINKING_LEAK' : 'CLEAN_RESPONSE',
    providerId,
    text: thinkingResult.cleaned,
    removedThinking: thinkingResult.removed || Boolean(reasoning),
    // The AI's reasoning/thinking, captured separately from the answer. Empty when none.
    // The transcript still receives ONLY `text` (the clean answer); this is for the
    // separate "what the AI is thinking" channel so it can be shown without polluting
    // the answer or being forwarded to the next provider.
    reasoning
  };
}

function normalize(rawText, providerId, options = {}) {
  return normalizeResponseCandidate({
    providerId,
    text: rawText,
    promptText: options.promptText || '',
    briefingText: options.briefingText || '',
    transcriptStore: options.transcriptStore
  });
}

module.exports = {
  normalize,
  normalizeResponseCandidate,
  normalizeForCompare,
  compactText,
  stripThinking
};
