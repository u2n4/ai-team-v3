'use strict';

// Live PROVIDER HEALTH CHECK. For each live-allowed provider it opens the page and reports a
// clear verdict — READY / READY_SLOW / LOGIN_WALL / CHALLENGE / RATE_LIMITED / SELECTOR_DRIFT /
// SEND_FAILED / CAPTURE_TIMEOUT — so you instantly know which providers work and which are
// broken (and why). Gated behind the same human env vars as the live ladder; opens pages but
// only types/sends a benign sentinel when AI_TEAM_V3_HEALTH_SEND=1. Metadata only — never
// logs page text or secrets.
//
// Run (PowerShell):
//   $env:AI_TEAM_V3_LIVE='1'; $env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
//   npm run health:check                 # page/login/challenge/selector check only (no send)
//   $env:AI_TEAM_V3_HEALTH_SEND='1'; npm run health:check   # also verifies send+response

const { DEFAULT_PROVIDER_DEFINITIONS } = require('../src/providers/webview-provider-adapter');
const { loadProviderSessionPolicy, resolveProviderSessionPolicy, resolveProviderPartition, assertProviderLiveAllowed } = require('../src/providers/provider-session-policy');
const { classifyProviderHealth, isBrokenVerdict } = require('../src/core/provider-health-classifier');
const { classifyModel, describeTier } = require('../src/core/model-classifier');
const { SendController } = require('../src/electron/send-controller');
const { DomCapture } = require('../src/electron/dom-capture');
const { DiagnosticsStore } = require('../src/core/diagnostics-store');
const { redactSensitiveText } = require('../src/core/redact');

const LIVE_ENV = 'AI_TEAM_V3_LIVE';
const CONFIRM_ENV = 'AI_TEAM_V3_CONFIRM_SAFE_SESSION';
const SEND_ENV = 'AI_TEAM_V3_HEALTH_SEND';
const SENTINEL = 'Reply with exactly: HEALTH_OK';

const CHALLENGE_RE = /captcha|cloudflare|verify you are human|checking your browser|security check|just a moment/i;
const LOGIN_RE = /\b(log ?in|sign ?in|continue with google|continue with apple|create account|get started free)\b/i;
const LIMIT_RE = /\b(rate limit (exceeded|reached)|too many requests|usage limit|message limit|quota exceeded|you have reached)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function allowedProviders(policy) {
  return Object.keys(DEFAULT_PROVIDER_DEFINITIONS).filter((id) => {
    const r = resolveProviderSessionPolicy(id, { policy });
    return r.liveAllowed === true && !r.forbidden;
  });
}

async function gatherSignals(electron, providerId, doSend) {
  const { BrowserWindow, session } = electron;
  const def = DEFAULT_PROVIDER_DEFINITIONS[providerId];
  const policy = loadProviderSessionPolicy();
  assertProviderLiveAllowed(providerId, { policy });
  const partition = resolveProviderPartition(def, providerId, { policy }).partition || def.partition;
  const win = new BrowserWindow({ width: 1100, height: 800, show: true,
    webPreferences: { session: session.fromPartition(partition), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
  const signals = { composerFound: false, challengeText: false, loginText: false, limitText: false, sendVerified: null, responseStarted: null, sendMs: null };
  try {
    const t0 = Date.now();
    await win.loadURL(def.url);
    const wc = win.webContents;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const state = await wc.executeJavaScript(`(() => {
        const inSel = ${JSON.stringify(def.inputSelectors || [])};
        let composer = false;
        for (const s of inSel) { const e = document.querySelector(s); if (e && !e.disabled && !e.readOnly) { composer = true; break; } }
        const body = (document.body && document.body.innerText || '').slice(0, 5000);
        return { composer, challenge: ${CHALLENGE_RE}.test(body), login: ${LOGIN_RE}.test(body), limit: ${LIMIT_RE}.test(body) };
      })()`).catch(() => ({ composer: false }));
      signals.challengeText = signals.challengeText || Boolean(state.challenge);
      signals.limitText = signals.limitText || Boolean(state.limit);
      if (state.composer) { signals.composerFound = true; break; }
      if (state.challenge) break;
      await sleep(1000);
    }
    if (!signals.composerFound) {
      signals.loginText = await wc.executeJavaScript(`(() => { const b=(document.body&&document.body.innerText||'').slice(0,5000); return ${LOGIN_RE}.test(b); })()`).catch(() => false);
    }
    signals.pageReadyMs = Date.now() - t0;

    // Detect which MODEL the provider is running and classify power vs speed.
    if (signals.composerFound) {
      try {
        const dc = new DomCapture({ webContents: wc });
        const label = await dc.detectModelLabel(def);
        const m = classifyModel(label);
        signals.model = m.model;
        signals.modelTier = m.tier;
      } catch (_e) {}
    }

    if (signals.composerFound && doSend && !signals.challengeText && !signals.limitText) {
      win.show(); win.focus(); win.moveTop();
      const ctrl = new SendController({ webContents: wc, hostWindow: win, diagnosticsStore: new DiagnosticsStore(), verificationTimeoutMs: 30000, verificationPollMs: 400 });
      const tSend = Date.now();
      const r = await ctrl.sendPrompt({ provider: def, promptText: SENTINEL });
      signals.sendMs = Date.now() - tSend;
      signals.sendVerified = r.verified === true;
      if (signals.sendVerified) {
        const respDeadline = Date.now() + 45000;
        signals.responseStarted = false;
        while (Date.now() < respDeadline) {
          const seen = await wc.executeJavaScript(`(() => {
            let count = 0; try { count = document.querySelectorAll(${JSON.stringify(def.responseCountSelector || '')}).length; } catch (e) {}
            const cand = document.querySelectorAll('[class*="response"],[class*="assistant"],[class*="markdown"],[class*="agent"],[class*="message"]');
            const lastLen = cand.length ? (cand[cand.length-1].innerText || '').length : 0;
            return { count, lastLen };
          })()`).catch(() => ({ count: 0, lastLen: 0 }));
          if (seen.count > (r.baselineResponseCount || 0) || seen.lastLen > 15) { signals.responseStarted = true; break; }
          await sleep(1000);
        }
      }
    }
  } catch (error) {
    signals.error = redactSensitiveText(error.message);
  } finally {
    // Tear the window down gracefully: stop loading, then destroy, then settle. A bare
    // destroy() mid-loop can race a pending executeJavaScript microtask, so we stop the
    // webContents first and give a short settle before opening the next provider.
    try { win.webContents.stop(); } catch (_e) {}
    try { win.destroy(); } catch (_e) {}
    await sleep(800);
  }
  return signals;
}

async function main() {
  if (process.env[LIVE_ENV] !== '1' || process.env[CONFIRM_ENV] !== '1') {
    console.error(`Refused. Set ${LIVE_ENV}=1 and ${CONFIRM_ENV}=1 to run a live health check.`);
    process.exitCode = 1;
    if (process.versions.electron) require('electron').app.exit(1);
    return;
  }
  const electron = require('electron');
  // Some machines have an unusable GPU process under Electron headless — it FATALs before the
  // health loop runs (stdout looked empty). Disable GPU so the worker boots reliably.
  try { electron.app.disableHardwareAcceleration(); } catch (_e) {}
  try { electron.app.commandLine.appendSwitch('disable-gpu'); } catch (_e) {}
  await electron.app.whenReady();
  const policy = loadProviderSessionPolicy();
  const doSend = process.env[SEND_ENV] === '1';
  // Parse the provider list from args AFTER this script file (Electron's argv puts the script
  // path at index 1, but extra Chromium flags can shift indices — find __filename, take the rest).
  const argv = process.argv;
  const selfIdx = argv.findIndex((a) => a && a.endsWith('health-check.js'));
  const rest = selfIdx >= 0 ? argv.slice(selfIdx + 1) : argv.slice(2);
  const only = rest.find((a) => a && !a.startsWith('-'));
  const providers = only ? only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : allowedProviders(policy);



  // One Electron worker checks the selected providers sequentially. JavaScript
  // failures are isolated per provider; a native worker crash stops this probe.
  for (const id of providers) {
    let health;
    let signals = {};
    try {
      signals = await gatherSignals(electron, id, doSend);
      health = classifyProviderHealth(signals);
    } catch (error) {
      health = { verdict: 'UNKNOWN', broken: true, reason: 'health probe errored: ' + redactSensitiveText(error.message) };
    }
    const flag = isBrokenVerdict(health.verdict) ? 'BROKEN' : 'OK';
    if (flag === 'BROKEN') process.exitCode = 1;
    const modelInfo = signals.model ? `model="${signals.model}" [${signals.modelTier}]` : 'model=?';
    console.log(`[health] ${(id + '          ').slice(0, 11)} ${(health.verdict + '              ').slice(0, 16)} ${flag}  pageReady=${signals.pageReadyMs || '?'}ms send=${signals.sendMs != null ? signals.sendMs + 'ms' : '-'}  ${modelInfo}  | ${health.reason}`);
  }
  electron.app.quit();
}

// NODE ORCHESTRATOR MODE: launch ONE electron process that checks all providers in sequence,
// with stdio INHERITED so [health] lines print straight to the terminal (no parent-capture
// race, which previously swallowed the output). GPU is disabled at the binary level so the
// electron process boots on machines whose GPU process FATALs.
async function orchestrate() {
  if (process.env[LIVE_ENV] !== '1' || process.env[CONFIRM_ENV] !== '1') {
    console.error(`Refused. Set ${LIVE_ENV}=1 and ${CONFIRM_ENV}=1 to run a live health check.`);
    process.exit(1);
  }
  const { spawn } = require('node:child_process');
  const electronPath = require('electron');
  const passthrough = process.argv.slice(2).filter((a) => a && !a.startsWith('-'));
  const child = spawn(
    electronPath,
    ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', __filename, ...passthrough],
    { env: { ...process.env, AI_TEAM_V3_HEALTH_WORKER: '1' }, stdio: 'inherit' }
  );
  const code = await new Promise((resolve) => { child.on('exit', (code) => resolve(code ?? 1)); child.on('error', () => resolve(1)); });
  process.exitCode = code;
}

if (process.versions && process.versions.electron) {
  // Electron worker: check the selected providers passed as argv.
  main().catch((error) => { console.error('[health] fatal:', redactSensitiveText(error.message)); process.exit(1); });
} else if (require.main === module) {
  // Node orchestrator: spawn one Electron worker for the selected roster.
  orchestrate().catch((error) => { console.error('[health] orchestrator failed:', redactSensitiveText(error.message)); process.exit(1); });
}

module.exports = { allowedProviders };
