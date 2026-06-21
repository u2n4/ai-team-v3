'use strict';

/**
 * Manual login helper. Opens ONE provider in a visible window inside its V3 partition and
 * waits while YOU log in by hand. When you're done, press Enter in the terminal (or just
 * close the window) and it persists the session (cookies + localStorage stay in the
 * partition; localStorage is also saved to the vault for re-injection).
 *
 * Use this for providers that didn't import cleanly (paid wall, region gate, expired
 * token) — log in once, then doctor/smoke/discussion will reuse the session.
 *
 * Allowed for any live-allowed provider (D20: all except chatgpt/claude, which are refused
 * before any page opens). E.g. qwen, kimi, gemini, perplexity, deepseek, grok, zai, meta, manus.
 *
 * Run (PowerShell):
 *   $env:AI_TEAM_V3_LIVE='1'; $env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
 *   npm run login -- qwen          (or set $env:AI_TEAM_V3_LOGIN_PROVIDER='qwen')
 */

const path = require('node:path');
const fs = require('node:fs');

const { DEFAULT_PROVIDER_DEFINITIONS } = require('../src/providers/webview-provider-adapter');
const { loadProviderSessionPolicy, resolveProviderSessionPolicy, assertProviderLiveAllowed } = require('../src/providers/provider-session-policy');
const { saveLocalStorageVault } = require('../src/electron/localstorage-vault');

const LIVE_ENV = 'AI_TEAM_V3_LIVE';
const CONFIRM_ENV = 'AI_TEAM_V3_CONFIRM_SAFE_SESSION';
const STATUS_FILE = path.join(__dirname, '..', '.tmp', 'login-status.txt');

function writeStatus(line) {
  try { fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true }); fs.appendFileSync(STATUS_FILE, `${line}\n`); } catch {}
  console.log(line);
}

function providerFromArgs(argv = process.argv, env = process.env) {
  const arg = argv.slice(2).find((a) => !a.startsWith('-'));
  return String(arg || env.AI_TEAM_V3_LOGIN_PROVIDER || '').trim().toLowerCase();
}

async function main() {
  if (process.env[LIVE_ENV] !== '1' || process.env[CONFIRM_ENV] !== '1') {
    console.error(`Refused. Set ${LIVE_ENV}=1 and ${CONFIRM_ENV}=1 to open a manual login window.`);
    process.exitCode = 1;
    return;
  }
  const providerId = providerFromArgs();
  // Manual login is allowed for any provider the room policy live-allows (D20: all except
  // chatgpt/claude). assertProviderLiveAllowed below is the real gate — it throws for
  // forbidden / not-live-allowed providers before any page is opened.
  if (!providerId || !DEFAULT_PROVIDER_DEFINITIONS[providerId]) {
    const known = Object.keys(DEFAULT_PROVIDER_DEFINITIONS).join(', ');
    console.error(`Pass a known provider id. Got: "${providerId}". Known: ${known}.`);
    process.exitCode = 1;
    return;
  }

  const { app, BrowserWindow, session } = require('electron');
  await app.whenReady();
  const sessionPolicy = loadProviderSessionPolicy();
  try {
    assertProviderLiveAllowed(providerId, { policy: sessionPolicy });
  } catch (error) {
    console.error(`Refused. ${error.message}`);
    process.exitCode = 1;
    app.quit();
    return;
  }

  const def = DEFAULT_PROVIDER_DEFINITIONS[providerId];
  const policy = resolveProviderSessionPolicy(providerId);
  const partition = (policy && policy.partition) || def.partition;
  const part = session.fromPartition(partition);

  const win = new BrowserWindow({
    width: 1280, height: 900, show: true,
    title: `Log in to ${def.name} — close this window when done`,
    webPreferences: { session: part, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  });

  writeStatus(`Opening ${def.name} (${def.url}). Log in by hand, then CLOSE the window to save the session.`);
  await win.loadURL(def.url).catch(() => {});

  // When the user closes the window, snapshot localStorage into the vault and quit.
  win.on('close', async (e) => {
    e.preventDefault();
    try {
      const raw = await win.webContents.executeJavaScript(
        '(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o); })()'
      ).catch(() => '{}');
      let store = {};
      try { store = JSON.parse(raw) || {}; } catch {}
      const n = saveLocalStorageVault(providerId, store);
      writeStatus(`Saved ${providerId} session: ${n} localStorage keys (cookies persist in partition ${partition}).`);
    } catch (err) {
      writeStatus(`Session save warning: ${err.message}`);
    }
    try { win.destroy(); } catch {}
    app.quit();
  });
}

if (process.versions && process.versions.electron) {
  main().catch((error) => { writeStatus(`Manual login failed: ${error.message}`); process.exit(1); });
} else if (require.main === module) {
  console.error('Run under Electron: npm run login -- <provider>');
  process.exit(1);
}

module.exports = { providerFromArgs };
