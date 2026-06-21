'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { assert, makeTempDir } = require('./test-utils');
const { runEndurance30, DEFAULT_PROVIDER_IDS, REAL_DISCUSSION_ROUNDS } = require('../scripts/realistic-validation-runner');
const { detectProblems } = require('../src/core/problem-detector');

async function run() {
  const dir = makeTempDir('ai-team-v3-endurance-');
  const reportPath = path.join(dir, 'ENDURANCE_30_REAL_DISCUSSION_REPORT.md');
  const { report, analysis } = await runEndurance30({ reportPath });

  assert.equal(analysis.ok, true);
  assert.equal(report.roundResults.length, 30);
  assert.equal(report.providerIds.length, 7);
  assert.deepEqual(report.providerIds, DEFAULT_PROVIDER_IDS);
  assert.equal(fs.existsSync(reportPath), true);

  for (const round of REAL_DISCUSSION_ROUNDS) {
    assert.equal(report.transcript.some((entry) => entry.text.includes(round)), true, `missing round in transcript: ${round}`);
  }

  for (const provider of report.promptLedger) {
    const sent = provider.sentPrompts;
    const briefingCount = sent.filter((prompt) => prompt.promptMode === 'briefing').length;
    assert.equal(briefingCount <= 1, true, `${provider.providerId} briefing repeated`);
    sent.slice(1).forEach((prompt) => assert.equal(prompt.promptMode, 'delta', `${provider.providerId} non-delta after first prompt`));
    sent.forEach((prompt) => assert.equal(prompt.promptChars <= 12000, true, `${provider.providerId} prompt exceeded budget`));
  }

  const codes = report.diagnostics.map((entry) => entry.code);
  for (const expected of [
    'PROMPT_ECHO',
    'BRIEFING_ECHO',
    'THINKING_LEAK',
    'UI_CHROME_CAPTURE',
    'PROVIDER_RUNTIME_ERROR',
    'STALE_DUPLICATE_RESPONSE',
    'PARTIAL_RESPONSE',
    'PROVIDER_LIMIT_REACHED',
    'PROVIDER_CHALLENGE',
    'EMPTY_RESPONSE',
    'SECRET_LEAK_RESPONSE',
    'UNSAFE_INSTRUCTION_RESPONSE',
    'DIAGNOSTIC_SHAPED_RESPONSE',
    'PROVIDER_PREFIX_LEAK',
    'PROVIDER_ERROR_PAGE'
  ]) {
    assert.equal(codes.includes(expected), true, `missing diagnostic ${expected}`);
  }

  const transcriptText = report.transcript.map((entry) => entry.text).join('\n');
  assert.match(transcriptText, /FINAL_READINESS_VERDICT/);
  assert.equal(/sk-fakefakefake|Cloudflare says verify|Stop generating|New chat\nUpgrade plan|\[SYSTEM DIAGNOSTIC\]/i.test(transcriptText), false);
  assert.equal(report.quota.some((entry) => entry.providerId === 'deepseek' && entry.disabledForRun === true), true);
  assert.equal(report.health.some((entry) => entry.providerId === 'deepseek' && entry.disabledForRun === true), true);

  const problems = detectProblems(report, {
    maxPromptChars: 12000,
    requireFinalSynthesis: true,
    providerIds: DEFAULT_PROVIDER_IDS
  });
  assert.equal(problems.length, 0, JSON.stringify(problems, null, 2));

  const reportText = fs.readFileSync(reportPath, 'utf8');
  assert.match(reportText, /Status: PASS/);
  assert.match(reportText, /No live providers were contacted/);
  console.log('PASS endurance 30 real discussion: stateful adversarial multi-provider validation passes');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
