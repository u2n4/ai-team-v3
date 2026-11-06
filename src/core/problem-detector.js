'use strict';

const SECRET_PATTERNS = Object.freeze([
  /\bauthorization["']?\s*[:=]\s*bearer\s+[a-z0-9._~+/=-]+/i,
  /\bcookie\s*[:=]\s*[^\s]+/i,
  /\bset-cookie\s*[:=]\s*[^\s]+/i,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?id|client[_-]?secret)["']?\s*[:=]\s*['"]?[a-z0-9._~+/=-]{8,}/i,
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  /\bsk-[a-z0-9_-]{12,}/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/i
]);

const CONTAMINATION_PATTERNS = Object.freeze([
  { code: 'THINKING_LEAK', pattern: /<think>|chain of thought|internal reasoning|the user is asking|reasoning:/i },
  { code: 'BRIEFING_LEAK', pattern: /AI TEAM SESSION BRIEFING/i },
  { code: 'UI_CHROME_LEAK', pattern: /new chat|upgrade plan|cookie preferences|keyboard shortcuts|attach file|sidebar/i },
  { code: 'DIAGNOSTICS_LEAK', pattern: /\[SYSTEM DIAGNOSTIC\]|PROMPT_OVER_BUDGET|FAILED_DIAGNOSTIC|PROVIDER_RUNTIME_ERROR/i },
  { code: 'CHALLENGE_LEAK', pattern: /captcha|cloudflare|verify you are human|checking your browser/i },
  { code: 'LIMIT_LEAK', pattern: /message limit|usage limit|rate limit|too many requests|quota exceeded/i },
  { code: 'PARTIAL_LEAK', pattern: /stop generating|continue generating|response paused|\btyping\.?$/i },
  { code: 'UNSAFE_INSTRUCTION_LEAK', pattern: /\bbypass\b.*\b(captcha|cloudflare|login|rate limit|paywall|paid wall)\b/i }
]);

// 2026-06-21 (D20): ChatGPT, Claude and Gemini remain forbidden live. A forbidden-provider
// live attempt in a run report is still a problem-detector finding.
const FORBIDDEN_LIVE_PROVIDERS = Object.freeze(['chatgpt', 'claude', 'gemini']);

function asArray(value) {
  return Array.isArray(value) ? value.filter(item => item != null) : [];
}

function textOf(value) {
  return String(value == null ? '' : value);
}

function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(textOf(text)));
}

function detectSecretsInText(text, { source = 'text' } = {}) {
  return containsSecret(text)
    ? [{ code: 'SECRET_IN_ARTIFACT', source, severity: 'fail', message: `${source} contains secret-shaped text.` }]
    : [];
}

function detectTranscriptContamination(transcript = []) {
  const problems = [];
  for (const entry of asArray(transcript).filter(Boolean)) {
    const text = textOf(entry.text);
    if (containsSecret(text)) {
      problems.push({
        code: 'SECRET_IN_TRANSCRIPT',
        severity: 'fail',
        turnId: entry.turnId,
        providerId: entry.senderId,
        message: 'Public transcript contains secret-shaped text.'
      });
    }
    if (entry.role !== 'ai') {
      continue;
    }
    for (const detector of CONTAMINATION_PATTERNS) {
      if (detector.pattern.test(text)) {
        problems.push({
          code: detector.code,
          severity: 'fail',
          turnId: entry.turnId,
          providerId: entry.senderId,
          message: `Public transcript contains ${detector.code}.`
        });
      }
    }
  }
  return problems;
}

function detectDiagnosticsLeak(transcript = []) {
  return asArray(transcript)
    .filter((entry) => entry && entry.meta && entry.meta.diagnostic === true)
    .map((entry) => ({
      code: 'DIAGNOSTIC_META_IN_TRANSCRIPT',
      severity: 'fail',
      turnId: entry.turnId,
      providerId: entry.senderId,
      message: 'Diagnostic metadata entered the public transcript.'
    }));
}

function detectRepeatedBriefing(promptLedger = []) {
  const problems = [];
  for (const provider of asArray(promptLedger)) {
    const briefingCount = asArray(provider.sentPrompts).filter((prompt) => prompt.promptMode === 'briefing').length;
    if (briefingCount > 1) {
      problems.push({
        code: 'REPEATED_BRIEFING',
        severity: 'fail',
        providerId: provider.providerId,
        briefingCount,
        message: 'SESSION_BRIEFING was delivered more than once.'
      });
    }
  }
  return problems;
}

function detectDeltaOnlyViolations(promptLedger = []) {
  const problems = [];
  for (const provider of asArray(promptLedger)) {
    const prompts = asArray(provider.sentPrompts);
    prompts.forEach((prompt, index) => {
      if (index > 0 && prompt.promptMode !== 'delta') {
        problems.push({
          code: 'DELTA_ONLY_VIOLATION',
          severity: 'fail',
          providerId: provider.providerId,
          promptIndex: index,
          message: 'A non-initial prompt was not delta-only.'
        });
      }
    });
  }
  return problems;
}

function detectPromptGrowthExplosion(promptLedger = [], { maxPromptChars = 12000, maxGrowthRatio = 3 } = {}) {
  const problems = [];
  for (const provider of asArray(promptLedger)) {
    const prompts = asArray(provider.sentPrompts);
    const promptChars = prompts.map((prompt) => Number(prompt.promptChars || 0)).filter((value) => value > 0);
    for (const value of promptChars) {
      if (value > maxPromptChars) {
        problems.push({
          code: 'PROMPT_BUDGET_EXCEEDED',
          severity: 'fail',
          providerId: provider.providerId,
          promptChars: value,
          maxPromptChars,
          message: 'Prompt exceeded validation budget.'
        });
      }
    }
    if (promptChars.length >= 3) {
      const first = promptChars[0];
      const latest = promptChars[promptChars.length - 1];
      if (first > 0 && latest / first > maxGrowthRatio) {
        problems.push({
          code: 'PROMPT_GROWTH_EXPLOSION',
          severity: 'fail',
          providerId: provider.providerId,
          firstPromptChars: first,
          latestPromptChars: latest,
          maxGrowthRatio,
          message: 'Prompt size grew faster than the allowed ratio.'
        });
      }
    }
  }
  return problems;
}

function detectStaleDuplicateTranscript(transcript = []) {
  const seen = new Map();
  const problems = [];
  for (const entry of asArray(transcript).filter((item) => item.role === 'ai')) {
    const normalized = textOf(entry.text).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      problems.push({
        code: 'STALE_DUPLICATE_ACCEPTED',
        severity: 'fail',
        turnId: entry.turnId,
        previousTurnId: seen.get(normalized),
        providerId: entry.senderId,
        message: 'A duplicate stale AI response was accepted into transcript.'
      });
    } else {
      seen.set(normalized, entry.turnId);
    }
  }
  return problems;
}

function detectForbiddenLiveAttempts(events = []) {
  return asArray(events)
    .filter((event) => event && event.live === true && FORBIDDEN_LIVE_PROVIDERS.includes(String(event.providerId || '').toLowerCase()))
    .map((event) => ({
      code: 'FORBIDDEN_PROVIDER_LIVE_ATTEMPT',
      severity: 'fail',
      providerId: event.providerId,
      message: 'Forbidden live provider was attempted.'
    }));
}

function detectNoOpLoop(report = {}) {
  const transcript = asArray(report.transcript);
  const aiTurns = transcript.filter((entry) => entry.role === 'ai');
  if (aiTurns.length === 0) {
    return [{ code: 'NO_AI_OUTPUT', severity: 'fail', message: 'Run produced no AI output.' }];
  }
  const unique = new Set(aiTurns.map((entry) => textOf(entry.text).toLowerCase().replace(/\s+/g, ' ').slice(0, 120)));
  if (aiTurns.length >= 10 && unique.size <= 2) {
    return [{ code: 'NO_OP_LOOP', severity: 'fail', message: 'Run appears to loop over near-identical AI outputs.' }];
  }
  return [];
}

function detectMissingFinalSynthesis(report = {}, { required = false } = {}) {
  if (!required) {
    return [];
  }
  const text = asArray(report.transcript)
    .filter((entry) => entry.role === 'ai')
    .map((entry) => textOf(entry.text))
    .join('\n');
  return /FINAL_(READINESS_)?VERDICT|FINAL SYNTHESIS|final decision/i.test(text)
    ? []
    : [{ code: 'FINAL_SYNTHESIS_MISSING', severity: 'fail', message: 'Final synthesis/verdict was not produced.' }];
}

function detectHealthNotUpdated(report = {}, { providerIds = [] } = {}) {
  const health = asArray(report.health);
  const missing = providerIds.filter((providerId) => !health.some((entry) => entry.providerId === providerId));
  return missing.map((providerId) => ({
    code: 'PROVIDER_HEALTH_NOT_UPDATED',
    severity: 'fail',
    providerId,
    message: 'Provider health was not updated.'
  }));
}

function detectProblems(report = {}, options = {}) {
  return [
    ...detectTranscriptContamination(report.transcript),
    ...detectDiagnosticsLeak(report.transcript),
    ...detectRepeatedBriefing(report.promptLedger),
    ...detectDeltaOnlyViolations(report.promptLedger),
    ...detectPromptGrowthExplosion(report.promptLedger, options),
    ...detectStaleDuplicateTranscript(report.transcript),
    ...detectForbiddenLiveAttempts(report.liveAttempts),
    ...detectNoOpLoop(report),
    ...detectMissingFinalSynthesis(report, { required: options.requireFinalSynthesis }),
    ...detectHealthNotUpdated(report, { providerIds: options.providerIds || [] })
  ];
}

module.exports = {
  CONTAMINATION_PATTERNS,
  FORBIDDEN_LIVE_PROVIDERS,
  SECRET_PATTERNS,
  containsSecret,
  detectDeltaOnlyViolations,
  detectDiagnosticsLeak,
  detectForbiddenLiveAttempts,
  detectHealthNotUpdated,
  detectMissingFinalSynthesis,
  detectNoOpLoop,
  detectProblems,
  detectPromptGrowthExplosion,
  detectRepeatedBriefing,
  detectSecretsInText,
  detectStaleDuplicateTranscript,
  detectTranscriptContamination
};
