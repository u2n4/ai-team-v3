'use strict';

const fs = require('node:fs');

const { assert } = require('../test-utils');
const {
  clearLocalStorageVault,
  loadLocalStorageVault,
  saveLocalStorageVault,
  vaultPathFor
} = require('../../src/electron/localstorage-vault');

async function run() {
  const providerId = `testvault-${Date.now()}`;
  const filePath = vaultPathFor(providerId);
  clearLocalStorageVault(providerId);

  assert.equal(saveLocalStorageVault(providerId, { access_token: 'local-test-value' }), 0);
  assert.equal(fs.existsSync(filePath), false);

  fs.mkdirSync(require('node:path').dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ access_token: 'legacy-test-value' }), 'utf8');
  assert.equal(loadLocalStorageVault(providerId), null);
  assert.deepEqual(loadLocalStorageVault(providerId, { allowLegacy: true }), { access_token: 'legacy-test-value' });
  clearLocalStorageVault(providerId);
  assert.equal(fs.existsSync(filePath), false);

  console.log('PASS localStorage vault: Node fallback refuses new plaintext vaults and legacy plaintext is accessible only through explicit migration');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
