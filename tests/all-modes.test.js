'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { assert, makeTempDir } = require('./test-utils');
const { runAllModes } = require('../scripts/realistic-validation-runner');
const { STANDARD_MODES } = require('../src/core/mode-definitions');

async function run() {
  const dir = makeTempDir('ai-team-v3-modes-');
  const reportPath = path.join(dir, 'ALL_MODES_TEST_REPORT.md');
  const result = await runAllModes({ reportPath });

  assert.equal(result.ok, true);
  assert.equal(result.modeReports.length, 12);
  assert.equal(result.modeReports.length, STANDARD_MODES.length);
  for (const { mode, report, analysis } of result.modeReports) {
    assert.equal(analysis.ok, true, `${mode.id} failed analysis`);
    assert.equal(report.roundResults.length, 5);
    assert.equal(report.diagnostics.length >= 1, true, `${mode.id} did not inject a failure`);
    assert.equal(analysis.metrics.maxObservedPromptChars <= 12000, true);
    const transcriptText = report.transcript.map((entry) => entry.text).join('\n');
    assert.match(transcriptText, /FINAL_READINESS_VERDICT/);
    assert.equal(/Cloudflare says verify you are human|PROMPT_OVER_BUDGET|FAILED_DIAGNOSTIC/i.test(transcriptText), false);
  }
  assert.match(fs.readFileSync(reportPath, 'utf8'), /Status: PASS/);
  console.log('PASS all modes: 12 realistic room modes run 5 offline rounds with clean transcript and isolated failures');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
