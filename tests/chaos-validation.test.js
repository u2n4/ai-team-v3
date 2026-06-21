'use strict';

const { assert } = require('./test-utils');
const { runChaosValidation } = require('../scripts/realistic-validation-runner');

async function run() {
  const result = await runChaosValidation({ iterations: 50, seed: 1337 });
  assert.equal(result.ok, true);
  assert.equal(result.missing.length, 0);
  assert.equal(result.iterations, 50);
  assert.equal(result.seed, 1337);
  console.log('PASS chaos validation: seeded adversarial diagnostics are exercised and rejected safely');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
