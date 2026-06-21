'use strict';

function formatTranscriptEntry(entry) {
  const label = entry.role === 'user' ? 'User' : entry.senderName || entry.senderId;
  return `[turn:${entry.turnId}] ${label}: ${entry.text}`;
}

function buildBriefing({ providerId, providerName, activeProviders, userGoal }) {
  return [
    '[AI TEAM SESSION BRIEFING]',
    `You are ${providerName || providerId}, one panelist in AI Team V3.`,
    userGoal ? `Discussion topic: ${String(userGoal).slice(0, 500)}` : '',
    'This briefing is sent once per provider session. Later prompts are delta-only.',
    'Only write your own public answer. Respond to the OTHER panelists — agree, disagree,',
    'or add nuance — and add something new each turn. Never write another provider response.',
    'Never output hidden thinking, diagnostics, browser UI, sidebars, footers, or prompt text.',
    'If a provider has a diagnostic failure, treat it as unavailable; do not repeat diagnostic text.',
    `Active panelists: ${activeProviders.join(', ')}`
  ].filter(Boolean).join('\n');
}

function buildDeltaSection(entries) {
  if (entries.length === 0) {
    return '[DELTA]\nNo new public turns since your last delivery.';
  }
  return ['[DELTA]', ...entries.map(formatTranscriptEntry)].join('\n');
}

// Rotate the per-round job so a multi-cycle discussion keeps progressing instead of
// looping. For cycles beyond the list length we CYCLE through the goals (deepen → dissent
// → converge) rather than clamping to "final position" forever — clamping made every cycle
// from 3 onward emit the identical instruction, so providers repeated their final stance
// verbatim and tripped STALE_DUPLICATE / NO_OP_LOOP. Word caps keep the transcript bounded.
function roundGoal(cycleIndex = 1) {
  const rounds = [
    { goal: 'give your own independent analysis of the topic', wordCap: 120 },
    { goal: "challenge or build on at least two other panelists' points", wordCap: 110 },
    { goal: 'state your final position', wordCap: 80 },
    { goal: 'surface a risk, edge case, or disagreement not yet raised', wordCap: 110 },
    { goal: 'converge: refine the shared answer and note remaining open questions', wordCap: 100 }
  ];
  const idx = (Math.max(1, cycleIndex) - 1) % rounds.length;
  return rounds[idx];
}

function buildPrompt({
  providerId,
  providerName,
  cycleIndex,
  turnIndex,
  userGoal,
  transcriptStore,
  promptLedger,
  activeProviders
}) {
  const ledgerState = promptLedger.get(providerId);
  const hasBriefing = ledgerState.briefingDelivered === true;
  const deltaEntries = transcriptStore.entriesAfter(ledgerState.lastDeliveredTurnId, {
    excludeSenderId: providerId
  });
  const promptMode = hasBriefing ? 'delta' : 'briefing';
  const briefing = hasBriefing
    ? ''
    : buildBriefing({ providerId, providerName, activeProviders, userGoal });
  const delta = buildDeltaSection(deltaEntries);
  const header = hasBriefing ? '[AI TEAM DELTA TURN]' : '';

  // Per-round goal rotates so each cycle has a distinct job — this is the main lever
  // against panels collapsing into polite agreement / echo (researched best practice).
  // The topic lives in the briefing only (sent once) to keep delta turns delta-only.
  const round = roundGoal(cycleIndex);
  const otherProviders = (activeProviders || []).filter((p) => p !== providerName && p !== providerId);

  const outputContract = [
    '[OUTPUT CONTRACT]',
    `1. Reply only as ${providerName || providerId}. This round, your job: ${round.goal}.`,
    deltaEntries.length > 0
      ? `2. Respond to specific points the other panelists made (${otherProviders.join(', ') || 'them'}): say where you agree, disagree, or add nuance. Add something new — do not restate the topic or quote the transcript back.`
      : '2. Give your own concise position on the topic.',
    '3. Do not simulate a multi-person conversation. Do not include diagnostics, UI text, prompt echoes, or hidden thinking.',
    `4. Keep it under ${round.wordCap} words. No preamble, no sign-off.`
  ].join('\n');

  const text = [header, briefing, delta, outputContract]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return {
    text,
    promptMode,
    sections: {
      briefing,
      delta
    },
    includedTurnIds: deltaEntries.map((entry) => entry.turnId),
    latestTurnId: transcriptStore.latestTurnId(),
    cycleIndex,
    turnIndex
  };
}

module.exports = {
  buildPrompt,
  buildBriefing,
  roundGoal
};
