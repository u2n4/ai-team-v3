'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assert, makeTempDir } = require('../test-utils');
const { buildDashboardState, extractStatus } = require('../../src/core/dashboard-state');

async function run() {
  const dir = makeTempDir('ai-team-v3-dashboard-');
  fs.mkdirSync(path.join(dir, 'coordination'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'coordination', 'CURRENT_STATUS.md'), '**Status:** READY_FOR_HUMAN_LIVE_DOCTOR', 'utf8');
  fs.writeFileSync(path.join(dir, 'FINAL_STATUS.md'), '# VERDICT: **WAITING_FOR_HUMAN_LIVE_CONFIRMATION**', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs', 'ONE_PROVIDER_REPORT.md'), 'Status: NOT_RUN', 'utf8');

  const state = buildDashboardState({ projectRoot: dir });
  assert.equal(state.currentStatus, 'READY_FOR_HUMAN_LIVE_DOCTOR');
  assert.equal(state.finalStatus, 'WAITING_FOR_HUMAN_LIVE_CONFIRMATION');
  assert.equal(state.liveAutoStart, false);
  assert.equal(state.safety.contactsLiveProvidersOnStartup, false);
  assert.equal(state.safety.claudeLiveAllowed, false);
  assert.equal(state.providers.some((provider) => provider.id === 'qwen'), true);
  assert.equal(state.approvalGates.some((gate) => gate.id === 'ONE_PROVIDER_SMOKE'), true);
  assert.equal(extractStatus('nothing here', 'FALLBACK'), 'FALLBACK');

  // Conversation view: AI answer + its reasoning are paired and separated; empty-safe by default.
  assert.deepEqual(state.conversation, []); // no transcript passed -> empty, offline-safe
  const convState = buildDashboardState({
    transcript: [
      { role: 'user', text: 'hi' },
      { role: 'ai', senderId: 'qwen', senderName: 'Qwen', turnId: 2, text: 'Hello there.', meta: { hasReasoning: true } }
    ],
    reasoning: [{ providerId: 'qwen', providerName: 'Qwen', turnId: 2, reasoning: 'The user greeted me; keep it short.' }]
  });
  const aiTurn = convState.conversation.find((c) => c.role === 'ai');
  assert.equal(aiTurn.answer, 'Hello there.');                       // answer only
  assert.equal(aiTurn.answer.includes('greeted me'), false);         // no thinking in the answer
  assert.equal(aiTurn.reasoning.includes('keep it short'), true);    // thinking shown separately
  assert.equal(convState.conversation[0].role, 'user');

  // Absent FINAL_STATUS.md and coordination/* are handled cleanly without UNKNOWN or empty broken rows.
  const emptyDir = makeTempDir('ai-team-v3-dashboard-empty-');
  const absentState = buildDashboardState({ projectRoot: emptyDir });
  assert.equal(absentState.currentStatus, 'OFFLINE_READY');
  assert.equal(absentState.finalStatus, 'HUMAN_GATED');
  assert.equal(absentState.reports.some((r) => r.label === 'CURRENT_STATUS' || r.label === 'FINAL_STATUS'), false);
  assert.equal(absentState.reports.every((r) => Boolean(r.label && r.path && r.status && r.status !== 'UNKNOWN')), true);

  console.log('PASS dashboard state: local status, providers, gates, safe defaults, and answer+reasoning conversation render offline');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
