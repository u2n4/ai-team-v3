'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { assert, makeTempDir } = require('../test-utils');
const { validateLiveModeGate, writeLiveModeReport } = require('../../scripts/live-mode-validation');

function tempFiles() {
  const dir = makeTempDir('ai-team-v3-live-mode-');
  return {
    dir,
    selectorReportPath: path.join(dir, 'LIVE_PREP_3_SELECTOR_VERIFICATION.md'),
    smokeReportPath: path.join(dir, 'ONE_PROVIDER_REPORT.md'),
    reportPath: path.join(dir, 'LIVE_ENDURANCE_30_REPORT.md')
  };
}

async function run() {
  {
    const files = tempFiles();
    const result = validateLiveModeGate({
      env: {},
      selectorReportPath: files.selectorReportPath,
      smokeReportPath: files.smokeReportPath
    });
    assert.equal(result.status, 'NOT_RUN');
    assert.equal(result.exitCode, 0);
  }

  {
    const files = tempFiles();
    const result = validateLiveModeGate({
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1',
        AI_TEAM_V3_LIVE_PROVIDERS: 'qwen,chatgpt',
        AI_TEAM_V3_LIVE_MAX_MESSAGES: '30'
      },
      selectorReportPath: files.selectorReportPath,
      smokeReportPath: files.smokeReportPath
    });
    assert.equal(result.status, 'BLOCKED_PROVIDER_FORBIDDEN');
  }

  {
    const files = tempFiles();
    const result = validateLiveModeGate({
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1',
        AI_TEAM_V3_LIVE_PROVIDERS: 'qwen,gemini',
        AI_TEAM_V3_LIVE_MAX_MESSAGES: '30'
      },
      selectorReportPath: files.selectorReportPath,
      smokeReportPath: files.smokeReportPath
    });
    // 2026-06-21 (D20): gemini is no longer forbidden, but it is not on the live-ladder
    // allowlist (still gated to qwen/kimi), so the ladder refuses with NOT_ALLOWED, not FORBIDDEN.
    assert.equal(result.status, 'BLOCKED_PROVIDER_FORBIDDEN');
  }

  {
    const files = tempFiles();
    const result = validateLiveModeGate({
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1',
        AI_TEAM_V3_LIVE_PROVIDERS: 'qwen,grok',
        AI_TEAM_V3_LIVE_MAX_MESSAGES: '30'
      },
      selectorReportPath: files.selectorReportPath,
      smokeReportPath: files.smokeReportPath
    });
    assert.equal(result.status, 'BLOCKED_PROVIDER_NOT_ALLOWED');
  }

  {
    const files = tempFiles();
    const result = validateLiveModeGate({
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1',
        AI_TEAM_V3_LIVE_PROVIDERS: 'qwen,kimi',
        AI_TEAM_V3_LIVE_MAX_MESSAGES: '30'
      },
      selectorReportPath: files.selectorReportPath,
      smokeReportPath: files.smokeReportPath
    });
    assert.equal(result.status, 'BLOCKED_DOCTOR_NOT_PASSED');
  }

  {
    const files = tempFiles();
    fs.writeFileSync(files.selectorReportPath, 'Status: BLOCKED\nPROVIDER_LIMIT', 'utf8');
    const result = validateLiveModeGate({
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1',
        AI_TEAM_V3_LIVE_PROVIDERS: 'qwen,kimi',
        AI_TEAM_V3_LIVE_MAX_MESSAGES: '30'
      },
      selectorReportPath: files.selectorReportPath,
      smokeReportPath: files.smokeReportPath
    });
    assert.equal(result.status, 'BLOCKED_CHALLENGE_OR_LIMIT');
  }

  {
    const files = tempFiles();
    fs.writeFileSync(files.selectorReportPath, 'Status: READY_FOR_ONE_PROVIDER_SMOKE', 'utf8');
    fs.writeFileSync(files.smokeReportPath, 'Status: PASS', 'utf8');
    const result = validateLiveModeGate({
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1',
        AI_TEAM_V3_LIVE_PROVIDERS: 'qwen,kimi',
        AI_TEAM_V3_LIVE_MAX_MESSAGES: '30'
      },
      selectorReportPath: files.selectorReportPath,
      smokeReportPath: files.smokeReportPath
    });
    assert.equal(result.status, 'WAITING_FOR_HUMAN_LIVE_CONFIRMATION');
    writeLiveModeReport(result.status, result.details, { reportPath: files.reportPath });
    const report = fs.readFileSync(files.reportPath, 'utf8');
    assert.equal(/cookie:|authorization:|token=/i.test(report), false);
  }

  console.log('PASS live mode validation: qwen/kimi live ladder refuses unsafe or unproven execution');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
