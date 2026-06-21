'use strict';

const { runAllModes } = require('./realistic-validation-runner');

async function main() {
  const result = await runAllModes();
  console.log(`modes:test ${result.status}`);
  for (const entry of result.modeReports) {
    console.log(`${entry.analysis.status} ${entry.mode.id}: ${entry.analysis.metrics.aiTurns} accepted AI turns`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  main,
  runAllModes
};
