'use strict';

const { runChaosValidation, runEndurance30, runAllModes } = require('./realistic-validation-runner');

async function main() {
  const endurance = await runEndurance30();
  const modes = await runAllModes();
  const chaos = await runChaosValidation();
  const ok = endurance.analysis.ok && modes.ok && chaos.ok;
  console.log(`validate:offline-real ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`endurance=${endurance.analysis.status} modes=${modes.status} chaos=${chaos.status}`);
  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  main
};
