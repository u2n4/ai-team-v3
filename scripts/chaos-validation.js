'use strict';

const { runChaosValidation } = require('./realistic-validation-runner');

async function main() {
  const result = await runChaosValidation();
  console.log(`chaos:test ${result.status}`);
  console.log(`seed=${result.seed} iterations=${result.iterations}`);
  if (result.missing.length > 0) {
    console.log(`missing=${result.missing.join(', ')}`);
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
  runChaosValidation
};
