'use strict';

const RAW_STANDARD_MODES = [
  {
    id: 'podcast',
    purpose: 'All AIs discuss freely without strict roles.',
    flow: ['open discussion', 'cross-response', 'host synthesis'],
    expectedTranscriptShape: 'Short public answers from multiple providers, followed by a clean synthesis.',
    expectedDiagnostics: 'Only injected provider failures; no diagnostic text in transcript.',
    acceptanceTests: ['5 offline rounds', 'one injected failure', 'final synthesis', 'clean transcript'],
    failureRisks: ['dominant provider repeats old context', 'UI text enters transcript'],
    bugsRevealed: ['prompt explosion', 'stale capture', 'diagnostic contamination']
  },
  {
    id: 'proDiscussion',
    purpose: 'Sequence into free discussion, then final summary.',
    flow: ['ordered first pass', 'free discussion', 'final summary'],
    expectedTranscriptShape: 'Provider responses move from proposals to critique to summary.',
    expectedDiagnostics: 'Failures are isolated as warning diagnostics.',
    acceptanceTests: ['ordered opening', 'free discussion turn', 'summary turn'],
    failureRisks: ['summary includes diagnostics', 'providers receive full transcript repeatedly'],
    bugsRevealed: ['mode flow violation', 'delta-only violation']
  },
  {
    id: 'sequential',
    purpose: 'AI1 responds, AI2 reacts, then each next provider reacts to the room.',
    flow: ['qwen first', 'kimi reaction', 'deepseek/gemini reactions', 'synthesis'],
    expectedTranscriptShape: 'Each provider references the current round instead of restarting.',
    expectedDiagnostics: 'Late/failing provider does not block subsequent providers.',
    acceptanceTests: ['ordered provider turns', 'failure isolation', 'final synthesis'],
    failureRisks: ['one timeout stalls the sequence'],
    bugsRevealed: ['provider stuck waiting', 'infinite retry loops']
  },
  {
    id: 'debate',
    purpose: 'Two sides argue opposing viewpoints.',
    flow: ['pro side', 'con side', 'rebuttal', 'judge summary'],
    expectedTranscriptShape: 'Clearly opposed arguments with a final neutral decision.',
    expectedDiagnostics: 'Contradictions stay public but diagnostics stay separate.',
    acceptanceTests: ['opposing claims', 'rebuttal', 'judge summary'],
    failureRisks: ['consensus claimed without disagreement list'],
    bugsRevealed: ['mode flow violation', 'consensus missing']
  },
  {
    id: 'criticReview',
    purpose: 'One AI proposes and others critique architecture, security, and tests.',
    flow: ['proposal', 'security critique', 'test critique', 'fix summary'],
    expectedTranscriptShape: 'Proposal and critiques remain distinguishable.',
    expectedDiagnostics: 'Unsafe suggestions rejected by firewall.',
    acceptanceTests: ['proposal accepted', 'critique accepted', 'unsafe output rejected'],
    failureRisks: ['unsafe bypass advice enters transcript'],
    bugsRevealed: ['firewall gap', 'problem-detector gap']
  },
  {
    id: 'researchBoard',
    purpose: 'AIs compare evidence and produce synthesis without browsing live sites.',
    flow: ['hypothesis', 'evidence comparison', 'risk grading', 'synthesis'],
    expectedTranscriptShape: 'Evidence claims are compared and uncertainty is stated.',
    expectedDiagnostics: 'Provider hallucination/failure captured as diagnostic.',
    acceptanceTests: ['evidence comparison', 'uncertainty statement', 'synthesis'],
    failureRisks: ['old answer reused as new evidence'],
    bugsRevealed: ['stale duplicate accepted']
  },
  {
    id: 'codeReviewBoard',
    purpose: 'One AI proposes code and others review architecture, security, and tests.',
    flow: ['code proposal', 'architecture review', 'security review', 'test review', 'decision'],
    expectedTranscriptShape: 'Findings lead; summary stays secondary.',
    expectedDiagnostics: 'Fake secret/code leak rejected.',
    acceptanceTests: ['review findings', 'secret rejected', 'decision produced'],
    failureRisks: ['fake secret in code block accepted'],
    bugsRevealed: ['secret redaction gap', 'firewall gap']
  },
  {
    id: 'redTeam',
    purpose: 'One AI attacks assumptions; others defend and fix.',
    flow: ['attack', 'defense', 'patch proposal', 'residual risk'],
    expectedTranscriptShape: 'Attack does not become unsafe operational advice.',
    expectedDiagnostics: 'Bypass/cookie export instructions rejected.',
    acceptanceTests: ['attack present', 'unsafe rejected', 'fix plan present'],
    failureRisks: ['bypass instructions accepted'],
    bugsRevealed: ['approval gate bypass', 'unsafe instruction leak']
  },
  {
    id: 'consensus',
    purpose: 'AIs must agree on final decision and list disagreements.',
    flow: ['independent positions', 'merge', 'disagreements', 'final decision'],
    expectedTranscriptShape: 'Final answer lists consensus and remaining disagreements.',
    expectedDiagnostics: 'Contradictions are public analysis, not diagnostics.',
    acceptanceTests: ['consensus marker', 'disagreements marker', 'final decision'],
    failureRisks: ['silent disagreement hidden'],
    bugsRevealed: ['consensus missing', 'mode flow violation']
  },
  {
    id: 'silentJury',
    purpose: 'AIs respond independently first, then compare answers.',
    flow: ['sealed independent answers', 'comparison', 'combined verdict'],
    expectedTranscriptShape: 'Initial answers do not quote earlier providers in the same round.',
    expectedDiagnostics: 'Prompt echo is rejected.',
    acceptanceTests: ['independent first pass', 'comparison pass', 'verdict'],
    failureRisks: ['early providers leak into later prompts incorrectly'],
    bugsRevealed: ['delta context bug', 'prompt echo acceptance']
  },
  {
    id: 'routerMode',
    purpose: 'The orchestrator decides which providers should receive which task.',
    flow: ['route decision', 'selected provider responses', 'skipped provider diagnostics', 'summary'],
    expectedTranscriptShape: 'Only selected providers answer; routing rationale stays clean.',
    expectedDiagnostics: 'Skipped/failing providers represented as diagnostics only.',
    acceptanceTests: ['route marker', 'selected responses', 'summary'],
    failureRisks: ['all providers receive every prompt in a routed task'],
    bugsRevealed: ['budget waste', 'quota burn']
  },
  {
    id: 'failureRecoveryMode',
    purpose: 'One or more providers fail and the room continues.',
    flow: ['failure injection', 'diagnostic isolation', 'remaining-provider continuation', 'recovery verdict'],
    expectedTranscriptShape: 'No user-facing transcript contains provider error pages.',
    expectedDiagnostics: 'Timeout, challenge, and limit diagnostics are present.',
    acceptanceTests: ['failed provider isolated', 'continuation', 'recovery verdict'],
    failureRisks: ['one provider blocks room'],
    bugsRevealed: ['failure isolation regression', 'quota guard bypass']
  }
];

const MODE_ACCEPTANCE_CRITERIA = Object.freeze({
  podcast: (text) => /turn-taking:/i.test(text) && /FINAL_READINESS_VERDICT/i.test(text),
  proDiscussion: (text) => /professional summary:/i.test(text) && /FINAL_READINESS_VERDICT/i.test(text),
  sequential: (text) => /sequence step:/i.test(text) && /FINAL_READINESS_VERDICT/i.test(text),
  debate: (text) => /position: pro/i.test(text) && /position: con/i.test(text),
  criticReview: (text) => /review:/i.test(text) && /critic/i.test(text),
  researchBoard: (text) => /reference:/i.test(text) && /synthesis/i.test(text),
  codeReviewBoard: (text) => /```diff/i.test(text) && /review/i.test(text),
  redTeam: (text) => /risk:/i.test(text) && /fix/i.test(text),
  consensus: (text) => /consensus:/i.test(text) && /disagreements:/i.test(text),
  silentJury: (text) => /jury verdict:/i.test(text) && /independent/i.test(text),
  routerMode: (text) => /route:/i.test(text) && /selected provider/i.test(text),
  failureRecoveryMode: (text) => /recovery summary:/i.test(text) && /continued/i.test(text)
});

const STANDARD_MODES = Object.freeze(RAW_STANDARD_MODES.map((mode) => Object.freeze({
  name: mode.id,
  ...mode,
  acceptanceCriterion: MODE_ACCEPTANCE_CRITERIA[mode.id]
})));

function getModeDefinition(modeId) {
  return STANDARD_MODES.find((mode) => mode.id === modeId);
}

function validateModeSpecificAcceptance(modeId, report = {}) {
  const mode = getModeDefinition(modeId);
  if (!mode || typeof mode.acceptanceCriterion !== 'function') {
    return {
      ok: false,
      code: 'MODE_ACCEPTANCE_CRITERION_MISSING',
      modeId
    };
  }
  const text = (report.transcript || [])
    .filter((entry) => entry.role === 'ai')
    .map((entry) => entry.text)
    .join('\n');
  return {
    ok: mode.acceptanceCriterion(text),
    code: mode.acceptanceCriterion(text) ? 'MODE_ACCEPTANCE_PASS' : 'MODE_ACCEPTANCE_FAIL',
    modeId
  };
}

module.exports = {
  MODE_ACCEPTANCE_CRITERIA,
  STANDARD_MODES,
  getModeDefinition,
  validateModeSpecificAcceptance
};
