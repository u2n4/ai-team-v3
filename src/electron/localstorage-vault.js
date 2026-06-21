'use strict';

/**
 * Per-provider localStorage vault.
 *
 * Providers like deepseek (userToken), z.ai (token), and kimi (access_token) keep their
 * auth in localStorage, not cookies, so a cookie-only import can't log them in. We can't
 * reliably write localStorage during import (loading the origin in a hidden window hangs
 * on Cloudflare challenge pages), so instead we PERSIST the imported localStorage to a
 * vault file and inject it via a preload script the first time the real provider page
 * loads in its partition.
 *
 * Security: vault files live under .tmp/ls-vault/ (gitignored). They hold real session
 * tokens, so they are LOCAL-ONLY, encrypted with Electron safeStorage when saved, and
 * never committed. Values are never logged.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VAULT_DIR = path.join(__dirname, '..', '..', '.tmp', 'ls-vault');
const ENCRYPTED_VAULT_VERSION = 2;

function vaultPathFor(providerId) {
  const safe = String(providerId || '').replace(/[^a-z0-9_-]/gi, '');
  return path.join(VAULT_DIR, `${safe}.json`);
}

function getSafeStorage() {
  try {
    const electron = require('electron');
    if (
      electron &&
      electron.safeStorage &&
      typeof electron.safeStorage.isEncryptionAvailable === 'function' &&
      electron.safeStorage.isEncryptionAvailable()
    ) {
      return electron.safeStorage;
    }
  } catch (_error) {}
  return null;
}

function restrictVaultFile(filePath) {
  try { fs.chmodSync(filePath, 0o600); } catch (_error) {}
  if (process.platform !== 'win32') return;
  try {
    const sid = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
    ], { encoding: 'utf8', windowsHide: true }).trim();
    if (!sid) return;
    execFileSync('icacls.exe', [
      filePath,
      '/inheritance:r',
      '/grant:r',
      `*${sid}:F`,
      '*S-1-5-18:F',
      '*S-1-5-32-544:F'
    ], { stdio: 'ignore', windowsHide: true });
  } catch (_error) {}
}

function encodeVault(store) {
  const safeStorage = getSafeStorage();
  if (!safeStorage) return null;
  const encrypted = safeStorage.encryptString(JSON.stringify(store));
  return JSON.stringify({
    version: ENCRYPTED_VAULT_VERSION,
    encoding: 'electron-safe-storage-base64',
    data: encrypted.toString('base64')
  });
}

function decodeVault(raw) {
  const parsed = JSON.parse(raw);
  if (
    parsed &&
    parsed.version === ENCRYPTED_VAULT_VERSION &&
    parsed.encoding === 'electron-safe-storage-base64' &&
    typeof parsed.data === 'string'
  ) {
    const safeStorage = getSafeStorage();
    if (!safeStorage) return null;
    const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
    const store = JSON.parse(decrypted);
    return store && typeof store === 'object' ? store : null;
  }
  if (parsed && parsed.version === 1 && parsed.encoding === 'plain-json') {
    return parsed.data && typeof parsed.data === 'object' ? parsed.data : null;
  }
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/** Save a provider's localStorage map to its vault file. Returns the key count written. */
function saveLocalStorageVault(providerId, store) {
  if (!store || typeof store !== 'object') return 0;
  const keys = Object.keys(store);
  if (keys.length === 0) return 0;
  const encoded = encodeVault(store);
  if (!encoded) return 0;
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  const filePath = vaultPathFor(providerId);
  fs.writeFileSync(filePath, encoded, { encoding: 'utf8', mode: 0o600 });
  restrictVaultFile(filePath);
  return keys.length;
}

/** Load a provider's vault, or null if none exists. */
function loadLocalStorageVault(providerId) {
  try {
    const raw = fs.readFileSync(vaultPathFor(providerId), 'utf8');
    return decodeVault(raw);
  } catch {
    return null;
  }
}

/** True if a vault exists for this provider. */
function hasLocalStorageVault(providerId) {
  return fs.existsSync(vaultPathFor(providerId));
}

/** Delete a provider's vault (e.g. after it has been injected once). */
function clearLocalStorageVault(providerId) {
  try { fs.unlinkSync(vaultPathFor(providerId)); } catch {}
}

/**
 * Build the JS to inject a vault's localStorage into a page. Intended to run via
 * webContents.executeJavaScript on the provider page (same origin) after first load.
 * Only sets keys that are not already present unless overwrite is true.
 */
function buildInjectionScript(store, { overwrite = true } = {}) {
  const payload = JSON.stringify(Object.entries(store || {}));
  return `(() => {
    try {
      if (!location.origin || location.origin === 'null') return 0;
      const entries = ${payload};
      const overwrite = ${overwrite ? 'true' : 'false'};
      let n = 0;
      for (const [k, v] of entries) {
        try {
          if (overwrite || localStorage.getItem(k) === null) { localStorage.setItem(k, v); n++; }
        } catch (_e) {}
      }
      return n;
    } catch (_e) { return 0; }
  })();`;
}

module.exports = {
  VAULT_DIR,
  vaultPathFor,
  saveLocalStorageVault,
  loadLocalStorageVault,
  hasLocalStorageVault,
  clearLocalStorageVault,
  buildInjectionScript,
  decodeVault,
  encodeVault,
  restrictVaultFile
};
