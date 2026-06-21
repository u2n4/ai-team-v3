'use strict';

const { assert } = require('../test-utils');
const { ApprovalGateManager, listApprovalGates } = require('../../src/core/approval-gate-manager');

async function run() {
  const manager = new ApprovalGateManager({ env: {} });

  assert.equal(manager.evaluate('OFFLINE_FAKE_LADDER', { offline: true }).ok, true);
  assert.equal(manager.evaluate('DASHBOARD_VIEW', { offline: true }).code, 'APPROVED_LOW_RISK_OFFLINE');

  const doctor = manager.evaluate('LIVE_PROVIDER_DOCTOR');
  assert.equal(doctor.ok, false);
  assert.equal(doctor.code, 'BLOCKED_HUMAN_CONFIRMATION_REQUIRED');

  const approvedDoctor = manager.evaluate('LIVE_PROVIDER_DOCTOR', {
    env: { AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1' }
  });
  assert.equal(approvedDoctor.ok, true);

  assert.equal(manager.evaluate('CLAUDE_LIVE', {
    env: { AI_TEAM_V3_APPROVE_CLAUDE_LIVE: '1' }
  }).code, 'FORBIDDEN_BY_DEFAULT');
  assert.equal(manager.evaluate('PERPLEXITY_LIVE', {
    env: { AI_TEAM_V3_APPROVE_PERPLEXITY_LIVE: '1' }
  }).code, 'FORBIDDEN_BY_DEFAULT');
  assert.equal(manager.evaluate('FULL_7_PROVIDER_LIVE', {
    env: { AI_TEAM_V3_APPROVE_FULL_7_PROVIDER_LIVE: '1' }
  }).code, 'FORBIDDEN_BY_DEFAULT');

  const gateIds = listApprovalGates().map((gate) => gate.id);
  for (const required of [
    'LIVE_PROVIDER_DOCTOR',
    'ONE_PROVIDER_SMOKE',
    'TWO_PROVIDER_SMOKE',
    'MULTI_PROVIDER_RUN',
    'CLAUDE_LIVE',
    'PERPLEXITY_LIVE',
    'FULL_7_PROVIDER_LIVE',
    'LONG_PROMPT_SEND',
    'PROVIDER_RELOAD',
    'SESSION_RESET'
  ]) {
    assert.equal(gateIds.includes(required), true, `${required} gate missing`);
  }

  console.log('PASS approval gates: live actions require explicit approval and forbidden providers stay blocked');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
