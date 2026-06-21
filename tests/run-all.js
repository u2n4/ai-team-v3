'use strict';

const tests = [
  require('./core/smoke.test'),
  require('./core/api-contracts.test'),
  require('./core/approval-gate-manager.test'),
  require('./core/core-invariants.test'),
  require('./core/dashboard-state.test'),
  require('./core/problem-detector.test'),
  require('./core/run-analyzer.test'),
  require('./core/mode-definitions.test'),
  require('./core/budget-guard.test'),
  require('./core/delta-context.test'),
  require('./core/settings-store.test'),
  require('./core/report-viewer.test'),
  require('./providers/transcript-firewall.test'),
  require('./providers/provider-contract.test'),
  require('./providers/provider-session-policy.test'),
  require('./providers/webview-provider-adapter.test'),
  require('./integration/selector-doctor.test'),
  require('./integration/smoke-one-provider.test'),
  require('./integration/live-mode-validation.test'),
  require('./integration/live-discussion-gate.test'),
  require('./integration/fake-ladder.test'),
  require('./endurance-30-real-discussion.test'),
  require('./all-modes.test'),
  require('./chaos-validation.test'),
  require('./electron/send-controller.test'),
  require('./electron/wait-assertions.test'),
  require('./electron/dom-capture.test'),
  require('./electron/lifecycle-monitor.test'),
  require('./electron/cdp-monitor.test'),
  require('./electron/edge-cookie-importer.test'),
  require('./electron/localstorage-vault.test'),
  require('./electron/provider-open-gate.test'),
  require('./electron/discussion-request.test'),
  require('./electron/file-upload-controller.test'),
  require('./electron/room-file-share.test'),
  require('./core/quota-guard.test'),
  require('./core/provider-health.test'),
  require('./core/provider-health-classifier.test'),
  require('./core/reasoning-store.test'),
  require('./core/model-classifier.test'),
  require('./integration/fake-7x4.test'),
  require('./integration/failure-isolation.test')
];

async function run() {
  for (const test of tests) {
    await test();
  }
  console.log('PASS test:v3-all');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
