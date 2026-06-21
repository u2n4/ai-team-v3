'use strict';

// Classifies the MODEL a provider is running into a tier — POWERFUL (deep reasoning, slower)
// vs FAST (quick, lighter) vs BALANCED — from the model name shown on the page. Pure and
// testable: a caller scrapes the model label (a badge / model-switcher text) and passes it in.
//
// Tiers:
//   POWERFUL  — frontier / reasoning / "pro" / "max" / "opus" / "o1/o3" / "r1" / "thinking"
//   FAST      — "flash" / "mini" / "lite" / "fast" / "turbo" / "instant" / "air" / "haiku" / "8b"
//   BALANCED  — everything recognized but not clearly fast or powerful (default "sonnet"/"4o")
//   UNKNOWN   — no recognizable model name

const TIER = Object.freeze({ POWERFUL: 'POWERFUL', BALANCED: 'BALANCED', FAST: 'FAST', UNKNOWN: 'UNKNOWN' });

// Order matters: more specific / stronger signals first.
const POWERFUL_PATTERNS = [
  /\bo[13](?:[-\s]?(?:pro|preview|mini-high))?\b/i, // OpenAI o1/o3 reasoning
  /\b(opus)\b/i,
  /\b(reason(?:ing|er)|think(?:ing)?|deepthink|r1)\b/i,
  /\b(pro|max|ultra|advanced|expert|heavy)\b/i,
  /\b(gpt-?4\.?5|gpt-?5|gemini[-\s]?\d*\.?\d*[-\s]?pro|grok[-\s]?\d*[-\s]?heavy|qwen[-\s]?max|kimi[-\s]?k\d|claude[-\s]?(?:opus|3\.7|4))\b/i
];
const FAST_PATTERNS = [
  /\b(flash|mini|lite|fast|turbo|instant|air|haiku|nano|small|8b|7b|tiny|speed)\b/i,
  /\b(gemini[-\s]?\d*\.?\d*[-\s]?flash|gpt-?4o-?mini|qwen[-\s]?turbo|grok[-\s]?\d*[-\s]?mini)\b/i
];
const BALANCED_PATTERNS = [
  /\b(sonnet|gpt-?4o|gpt-?4\.1|gemini[-\s]?\d*\.?\d*[-\s]?(?:flash|pro)?|qwen[-\s]?plus|grok[-\s]?\d|deepseek[-\s]?(?:chat|v\d)|kimi)\b/i
];

function classifyModel(modelLabel) {
  const raw = String(modelLabel || '').trim();
  if (!raw) return { tier: TIER.UNKNOWN, model: '', reason: 'No model name detected on the page.' };
  // A FAST marker beats a generic BALANCED match, but an explicit POWERFUL marker
  // (reasoning/pro/opus) beats FAST (e.g. "pro flash" is rare; prefer the stronger signal
  // only when it is a real reasoning/frontier word, not just "pro" inside a fast model).
  const hasReasoning = /\b(o[13]\b|opus|reason|think|deepthink|\br1\b|ultra|heavy|max)\b/i.test(raw);
  if (hasReasoning) {
    return { tier: TIER.POWERFUL, model: raw, reason: 'Reasoning / frontier model marker detected.' };
  }
  for (const p of FAST_PATTERNS) {
    if (p.test(raw)) return { tier: TIER.FAST, model: raw, reason: 'Fast/lightweight model marker detected.' };
  }
  for (const p of POWERFUL_PATTERNS) {
    if (p.test(raw)) return { tier: TIER.POWERFUL, model: raw, reason: 'Powerful model marker detected.' };
  }
  for (const p of BALANCED_PATTERNS) {
    if (p.test(raw)) return { tier: TIER.BALANCED, model: raw, reason: 'Recognized balanced model.' };
  }
  return { tier: TIER.UNKNOWN, model: raw, reason: 'Model name not in the known registry.' };
}

// Human-friendly one-liner for the dashboard.
function describeTier(tier) {
  switch (tier) {
    case TIER.POWERFUL: return 'Powerful (deep reasoning, slower)';
    case TIER.FAST: return 'Fast (quick, lighter)';
    case TIER.BALANCED: return 'Balanced';
    default: return 'Unknown model';
  }
}

module.exports = { TIER, classifyModel, describeTier };
