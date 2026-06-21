'use strict';

const { runEndurance30 } = require('./realistic-validation-runner');

async function main() {
  const { analysis } = await runEndurance30();
  console.log(`endurance:30 ${analysis.status}`);
  for (const check of analysis.checks) {
    console.log(`${check.status} ${check.id}: ${check.message}`);
  }
  process.exitCode = analysis.ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  main,
  runEndurance30
};
