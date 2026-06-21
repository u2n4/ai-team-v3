'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assert, makeTempDir } = require('../test-utils');
const { assertDiscussionGateOrThrow } = require('../../scripts/live-discussion');

// The gate is pure and throws BEFORE require('electron'), so this runs under plain node
// and proves no Electron process/window is ever created.
function evidenceFiles({ selector = '', smoke = '' } = {}) {
  const dir = makeTempDir('ai-team-v3-discussion-gate-');
  const selectorReportPath = path.join(dir, 'selector.md');
  const smokeReportPath = path.join(dir, 'smoke.md');
  fs.writeFileSync(selectorReportPath, selector, 'utf8');
  fs.writeFileSync(smokeReportPath, smoke, 'utf8');
  return { selectorReportPath, smokeReportPath };
}

const FULL_EVIDENCE = {
  selector: 'Status: READY_FOR_ONE_PROVIDER_SMOKE\n',
  smoke: 'Status: PASS\n'
};

async function run() {
  // 1) Full evidence but NO approval env -> refused (the old uiApproved no-op is gone).
  assert.throws(() => assertDiscussionGateOrThrow(
    { AI_TEAM_V3_LIVE: '1', AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1', AI_TEAM_V3_DISCUSSION_PROVIDERS: 'qwen,kimi' },
    evidenceFiles(FULL_EVIDENCE)
  ), /LIVE_DISCUSSION|approval|AI_TEAM_V3_APPROVE_DISCUSSION/i);

  // 2) Approval set but NO evidence -> refused on static evidence.
  assert.throws(() => assertDiscussionGateOrThrow(
    { AI_TEAM_V3_LIVE: '1', AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1', AI_TEAM_V3_APPROVE_DISCUSSION: '1', AI_TEAM_V3_DISCUSSION_PROVIDERS: 'qwen,kimi' },
    evidenceFiles()
  ), /BLOCKED_DOCTOR_NOT_PASSED/);

  // 3) Approval + doctor READY but smoke missing PASS -> refused.
  assert.throws(() => assertDiscussionGateOrThrow(
    { AI_TEAM_V3_LIVE: '1', AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1', AI_TEAM_V3_APPROVE_DISCUSSION: '1', AI_TEAM_V3_DISCUSSION_PROVIDERS: 'qwen,kimi' },
    evidenceFiles({ selector: 'Status: READY_FOR_ONE_PROVIDER_SMOKE\n', smoke: 'Status: RUNNING\n' })
  ), /BLOCKED_ONE_PROVIDER_SMOKE_NOT_PASSED/);

  // 4) Full evidence + approval but a forbidden provider in the requested roster -> refused.
  assert.throws(() => assertDiscussionGateOrThrow(
    { AI_TEAM_V3_LIVE: '1', AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1', AI_TEAM_V3_APPROVE_DISCUSSION: '1', AI_TEAM_V3_DISCUSSION_PROVIDERS: 'qwen,claude' },
    evidenceFiles(FULL_EVIDENCE)
  ), /Forbidden live providers/);

  // 5) Missing CONFIRM env -> refused.
  assert.throws(() => assertDiscussionGateOrThrow(
    { AI_TEAM_V3_LIVE: '1', AI_TEAM_V3_APPROVE_DISCUSSION: '1', AI_TEAM_V3_DISCUSSION_PROVIDERS: 'qwen,kimi' },
    evidenceFiles(FULL_EVIDENCE)
  ), /CONFIRM_SAFE_SESSION/);

  // 6) HAPPY PATH: env + explicit approval + full evidence + safe roster -> returns roster,
  //    and validation alone spawns NO Electron/process.
  const roster = assertDiscussionGateOrThrow(
    { AI_TEAM_V3_LIVE: '1', AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1', AI_TEAM_V3_APPROVE_DISCUSSION: '1', AI_TEAM_V3_DISCUSSION_PROVIDERS: 'qwen,kimi' },
    evidenceFiles(FULL_EVIDENCE)
  );
  assert.deepEqual(roster, ['qwen', 'kimi']);

  assert.equal(typeof require('../../scripts/live-discussion').assertDiscussionGateOrThrow, 'function');

  console.log('PASS live discussion gate: refuses without evidence/approval, never spawns Electron');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
