'use strict';

/**
 * Encrypt existing .tmp/ls-vault localStorage snapshots in place.
 *
 * This script never prints values. It is intended for one-time local hardening after a
 * manual login/import created legacy plaintext vault files.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  VAULT_DIR,
  loadLocalStorageVault,
  saveLocalStorageVault,
  vaultPathFor,
  restrictVaultFile
} = require('../src/electron/localstorage-vault');

function providerIdsFromDisk() {
  try {
    return fs.readdirSync(VAULT_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.basename(name, '.json'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  const { app, safeStorage } = require('electron');
  await app.whenReady();

  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    console.error('Vault encryption is not available in this Electron session.');
    process.exitCode = 1;
    app.quit();
    return;
  }

  const providerIds = process.argv.slice(2).map((id) => String(id).trim()).filter(Boolean);
  const targets = providerIds.length > 0 ? providerIds : providerIdsFromDisk();
  if (targets.length === 0) {
    console.log('No localStorage vault files found.');
    app.quit();
    return;
  }

  let secured = 0;
  for (const providerId of targets) {
    const filePath = vaultPathFor(providerId);
    const store = loadLocalStorageVault(providerId);
    if (!store || Object.keys(store).length === 0) {
      if (fs.existsSync(filePath)) restrictVaultFile(filePath);
      console.log(`${providerId}: no readable keys`);
      continue;
    }
    const count = saveLocalStorageVault(providerId, store);
    if (count > 0) {
      secured += 1;
      console.log(`${providerId}: secured ${count} localStorage keys`);
    } else {
      console.log(`${providerId}: not secured`);
    }
  }

  console.log(`Vault secure complete: ${secured}/${targets.length} files secured.`);
  app.quit();
}

if (process.versions && process.versions.electron) {
  main().catch((error) => {
    console.error(`Vault secure failed: ${error.message}`);
    process.exit(1);
  });
} else if (require.main === module) {
  console.error('Run under Electron: npm run vault:secure');
  process.exit(1);
}

module.exports = { providerIdsFromDisk };
