'use strict';

const { SAFE_DOCTOR_COMMAND, runDoctor, DEFAULT_SELECTOR_REPORT_PATH } = require('./selector-doctor');

async function main() {
  const result = await runDoctor();

  // Surface the actual verdict so the human can see what happened (the detailed,
  // redacted report is written to the report file — metadata only, no secrets).
  console.log('\n=== Selector Doctor result ===');
  console.log(`provider:    ${result.providerId || '(missing)'}`);
  console.log(`status:      ${result.status || (result.ok ? 'READY_FOR_ONE_PROVIDER_SMOKE' : 'UNKNOWN')}`);
  console.log(`ok:          ${result.ok === true}`);
  if (result.summary && result.summary.message) {
    console.log(`message:     ${result.summary.message}`);
  }
  if (result.summary && result.summary.urlObserved) {
    console.log(`urlObserved: ${result.summary.urlObserved}`);
  }
  console.log(`report:      ${process.env.AI_TEAM_V3_SELECTOR_REPORT || DEFAULT_SELECTOR_REPORT_PATH}`);
  if (result.tracePath) {
    console.log(`trace:       ${result.tracePath}`);
  }
  if (result.ok) {
    console.log('\n✅ READY — you can now run:  npm run smoke:one-provider');
  } else {
    console.log('\n⛔ NOT READY — see status/message above. Make sure you are logged in and the env vars are set.');
  }

  console.log('\nSafe Selector Doctor command:');
  console.log(SAFE_DOCTOR_COMMAND);
  process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : (result.ok ? 0 : 1);
}

// Electron entry point: under Electron `require.main === module` is false, so
// invoke main() directly. In plain Node, keep the standard guard.
if ((process.versions && process.versions.electron) || require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  main
};
