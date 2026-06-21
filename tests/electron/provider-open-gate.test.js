'use strict';

const { assert } = require('../test-utils');
const { evaluateProviderOpen } = require('../../src/electron/main');
const { ApprovalGateManager } = require('../../src/core/approval-gate-manager');

// provider:open must require BOTH the renderer's explicit confirmation AND the
// AI_TEAM_V3_CONFIRM_SAFE_SESSION env gate before a live provider window can open.
// A renderer self-asserting {confirmed:true} must NOT be enough on its own, and the
// env var alone must NOT be enough either.
async function run() {
  const gateManager = new ApprovalGateManager({ env: {} });

  // 1) confirmed:true but env gate ABSENT -> REFUSED (renderer can't self-authorize).
  const refused = evaluateProviderOpen('qwen', { confirmed: true }, { gateManager, env: {} });
  assert.equal(refused.ok, false);

  // 2) env gate present but NOT confirmed -> REFUSED (env alone can't authorize — the
  //    single-signal bypass this fix closes).
  const envOnly = evaluateProviderOpen('qwen', { confirmed: false }, {
    gateManager,
    env: { AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1' }
  });
  assert.equal(envOnly.ok, false);

  // 3) BOTH confirmed:true AND env gate -> ALLOWED for qwen/kimi.
  for (const id of ['qwen', 'kimi']) {
    const allowed = evaluateProviderOpen(id, { confirmed: true }, {
      gateManager,
      env: { AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1' }
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.providerId, id);
  }

  // 4) forbidden providers blocked FIRST, regardless of confirmation/env.
  for (const id of ['chatgpt', 'claude']) {
    const blocked = evaluateProviderOpen(id, { confirmed: true }, {
      gateManager,
      env: { AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1' }
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'BLOCKED_PROVIDER_FORBIDDEN');
  }

  // 5) a newly room-allowed provider (gemini) also requires both signals and is openable
  //    with both (it is live-allowed under D20, just not on the smoke ladder).
  const geminiBoth = evaluateProviderOpen('gemini', { confirmed: true }, {
    gateManager,
    env: { AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1' }
  });
  assert.equal(geminiBoth.ok, true);

  console.log('PASS provider:open requires BOTH renderer confirmation and AI_TEAM_V3_CONFIRM_SAFE_SESSION env gate');
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = run;
