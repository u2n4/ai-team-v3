'use strict';

/**
 * Import Edge cookies for the allowed live providers into their V3 partitions.
 *
 * Run inside Electron (needs `session.fromPartition`):
 *   electron scripts/import-edge-cookies.js
 *
 * Human safety gate: requires AI_TEAM_V3_LIVE=1 and AI_TEAM_V3_CONFIRM_SAFE_SESSION=1,
 * mirroring the doctor/smoke flows. The user's ChatGPT/Claude/Gemini/Perplexity
 * accounts and the shared Google/Microsoft identity domains are never imported
 * (enforced inside the importer's blocklist).
 *
 * Optional: set AI_TEAM_V3_IMPORT_PROVIDERS="qwen,kimi" to limit which allowed
 * providers to import (defaults to all currently allowed providers).
 */

const path = require('node:path');
const fs = require('node:fs');
const { importEdgeCookies } = require('../src/electron/edge-cookie-importer');

// Electron main-process stdout is unreliable here; also write a status line to
// a file so callers can read the result deterministically.
const STATUS_FILE = path.join(__dirname, '..', '.tmp', 'edge-import-status.txt');
function writeStatus(line) {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.appendFileSync(STATUS_FILE, `${line}\n`);
  } catch {}
  console.log(line);
}
const {
  loadProviderSessionPolicy,
  resolveProviderSessionPolicy
} = require('../src/providers/provider-session-policy');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../src/providers/webview-provider-adapter');
const { LIVE_PROVIDER_ALLOWLIST } = require('../src/providers/provider-contract');
const { saveLocalStorageVault } = require('../src/electron/localstorage-vault');

const LIVE_ENV = 'AI_TEAM_V3_LIVE';
const CONFIRM_ENV = 'AI_TEAM_V3_CONFIRM_SAFE_SESSION';

function selectedProviders(env = process.env) {
  const requested = String(env.AI_TEAM_V3_IMPORT_PROVIDERS || '').trim();
  const ids = requested
    ? requested.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [...LIVE_PROVIDER_ALLOWLIST];
  // Only keep ids that are actually live-allowed by policy (defence in depth).
  return ids.filter((id) => {
    const policy = resolveProviderSessionPolicy(id);
    return policy && policy.liveAllowed === true;
  });
}

async function main() {
  if (process.env[LIVE_ENV] !== '1' || process.env[CONFIRM_ENV] !== '1') {
    console.error(`Refused. Set ${LIVE_ENV}=1 and ${CONFIRM_ENV}=1 to import Edge cookies for the allowed providers.`);
    process.exitCode = 1;
    if (process.versions.electron) require('electron').app.exit(1);
    return;
  }

  const { app, session } = require('electron');
  // Avoid GPU/network-service churn for this windowless utility run.
  try { app.disableHardwareAcceleration(); } catch {}
  writeStatus('waiting for app ready...');
  await app.whenReady();
  writeStatus('app ready.');

  loadProviderSessionPolicy();
  const providerIds = selectedProviders();
  if (providerIds.length === 0) {
    writeStatus('No live-allowed providers selected for import.');
    process.exitCode = 1;
    app.quit();
    return;
  }
  writeStatus(`importing for: ${providerIds.join(', ')}`);

  const { BrowserWindow } = require('electron');
  const partitionFor = (providerId) => {
    const def = DEFAULT_PROVIDER_DEFINITIONS[providerId];
    const policy = resolveProviderSessionPolicy(providerId);
    return (policy && policy.partition) || (def && def.partition) || null;
  };

  const result = await importEdgeCookies({
    allowedProviderIds: providerIds,
    sessionForProvider: (providerId) => {
      const partition = partitionFor(providerId);
      return partition ? session.fromPartition(partition) : null;
    },
    // Persist Edge's localStorage to a vault file per provider. Opening a hidden window
    // to write it directly is unreliable (Cloudflare challenge pages hang loadURL), so
    // instead the provider window manager injects this vault via a preload script the
    // first time the real provider page loads. This logs in allowed providers whose
    // auth token lives in localStorage, not cookies. The token value is never logged.
    importLocalStorageForProvider: async (providerId, store) => {
      const written = saveLocalStorageVault(providerId, store);
      return written;
    }
  });

  writeStatus(result.message);
  for (const [providerId, count] of Object.entries(result.perProvider)) {
    const ls = (result.perProviderStorage && result.perProviderStorage[providerId]) || 0;
    writeStatus(`  ${providerId}: ${count} cookies${ls > 0 ? ` + ${ls} localStorage keys` : ''}`);
  }
  process.exitCode = result.success ? 0 : 1;
  app.quit();
}

// This file is an Electron entry point; under Electron `require.main === module`
// is false, so invoke main() directly. The require.exports guard below still
// lets tests import { selectedProviders } without auto-running.
if (process.versions && process.versions.electron) {
  main().catch((error) => {
    writeStatus(`Edge cookie import failed: ${error.message}`);
    process.exit(1);
  });
} else if (require.main === module) {
  main().catch((error) => {
    console.error(`Edge cookie import failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, selectedProviders };
