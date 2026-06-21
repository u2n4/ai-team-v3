'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { ProviderWindowManager } = require('./provider-window-manager');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../providers/webview-provider-adapter');
const { WebviewProviderAdapter } = require('../providers/webview-provider-adapter');
const { ApprovalGateManager } = require('../core/approval-gate-manager');
const { buildDashboardState } = require('../core/dashboard-state');
const { SendController } = require('./send-controller');
const { DomCapture } = require('./dom-capture');
const { LifecycleMonitor } = require('./lifecycle-monitor');
const { Orchestrator } = require('../core/orchestrator');
const { TranscriptStore } = require('../core/transcript-store');
const { ReasoningStore } = require('../core/reasoning-store');
const {
  resolveProviderSessionPolicy,
  FORBIDDEN_PROVIDER_MESSAGE
} = require('../providers/provider-session-policy');

let mainWindow;
let providerWindowManager;
const projectRoot = path.resolve(__dirname, '..', '..');
const approvalGateManager = new ApprovalGateManager();

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'approved'].includes(String(value || '').toLowerCase());
}

// Pure decision for provider:open. Requires TWO independent signals before a live
// provider window may open: (1) the renderer's explicit human confirmation
// (approval.confirmed === true) AND (2) the process-level env gate
// AI_TEAM_V3_CONFIRM_SAFE_SESSION. A renderer self-asserting {confirmed:true} can
// never open a live window on its own — the env gate must also be satisfied.
// Forbidden providers (chatgpt/claude) are rejected FIRST, before any approval.
function evaluateProviderOpen(providerId, approval = {}, {
  resolvePolicy = resolveProviderSessionPolicy,
  gateManager = approvalGateManager,
  env = process.env
} = {}) {
  const policy = resolvePolicy(providerId);
  if (!policy || policy.forbidden || policy.liveAllowed !== true) {
    return {
      ok: false,
      providerId,
      code: 'BLOCKED_PROVIDER_FORBIDDEN',
      message: FORBIDDEN_PROVIDER_MESSAGE
    };
  }
  const confirmed = approval && approval.confirmed === true;
  const envGateSatisfied = isTruthyEnv(env.AI_TEAM_V3_CONFIRM_SAFE_SESSION);
  // Force uiApproved to be the SOLE approval path by passing env:{} into the manager —
  // otherwise the manager would self-approve via its own env path (isTruthy(env[gate.env]))
  // when AI_TEAM_V3_CONFIRM_SAFE_SESSION alone is set, re-opening the single-signal bypass.
  const gate = gateManager.evaluate('LIVE_PROVIDER_DOCTOR', {
    uiApproved: confirmed && envGateSatisfied,
    env: {}
  });
  if (!gate.ok) {
    return {
      ok: false,
      providerId,
      gate,
      message: 'Provider web sessions are blocked from the dashboard until explicit human live confirmation.'
    };
  }
  return { ok: true, providerId };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  });

  providerWindowManager = new ProviderWindowManager({
    hostWindow: mainWindow,
    providerDefinitions: DEFAULT_PROVIDER_DEFINITIONS
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html')).catch(() => {
    mainWindow.loadURL('data:text/html,<main id="app">AI Team V3 Electron foundation</main>');
  });
}

function registerIpcHandlers() {
  ipcMain.handle('providers:list', () => Object.values(DEFAULT_PROVIDER_DEFINITIONS).map((provider) => ({
    id: provider.id,
    name: provider.name,
    url: provider.url,
    partition: provider.partition,
    stabilityMs: provider.stabilityMs,
    maxPromptChars: provider.maxPromptChars || 8000
  })));

  ipcMain.handle('dashboard:state', () => buildDashboardState({ projectRoot }));

  ipcMain.handle('provider:open', async (_event, providerId, approval = {}) => {
    // Forbidden providers (chatgpt/claude) are blocked at the IPC boundary BEFORE the
    // approval gate; opening additionally requires BOTH the renderer confirmation AND
    // the AI_TEAM_V3_CONFIRM_SAFE_SESSION env gate (see evaluateProviderOpen).
    const decision = evaluateProviderOpen(providerId, approval);
    if (!decision.ok) {
      return decision;
    }
    return providerWindowManager.openProvider(providerId);
  });

  ipcMain.handle('discussion:start', async (event, options = {}) => {
    return startDiscussion(event, options);
  });
}

let discussionInFlight = false;

// Pure validation for a discussion request — no Electron, no side effects, unit-testable.
// Returns {ok:true, promptText, roster, cycles} or {ok:false, code, message}.
function validateDiscussionRequest({ prompt, roster, rounds = 3 } = {}, { inFlight = false } = {}) {
  if (inFlight) {
    return { ok: false, code: 'DISCUSSION_IN_FLIGHT', message: 'A discussion is already running.' };
  }
  const promptText = String(prompt || '').trim();
  if (!promptText) {
    return { ok: false, code: 'EMPTY_PROMPT', message: 'Enter a question for the AIs to discuss.' };
  }
  const requested = Array.isArray(roster) ? roster.map((r) => String(r).toLowerCase()) : [];
  if (requested.length < 2) {
    return { ok: false, code: 'ROSTER_TOO_SMALL', message: 'Pick at least two AIs for a discussion.' };
  }
  // Default to 3 only when rounds isn't a finite number; a finite 0 or negative clamps to 1
  // (not the default), so an explicit small value isn't silently bumped to 3.
  const parsedRounds = Number(rounds);
  const cycles = Math.max(1, Math.min(20, Number.isFinite(parsedRounds) ? parsedRounds : 3));
  return { ok: true, promptText, roster: requested, cycles };
}

// Run a REAL multi-AI discussion from inside the app: open the requested roster (each
// provider passes the SAME open gate as provider:open — forbidden providers + the env
// gate are enforced), then run the orchestrator. Every AI turn (answer + separately
// captured thinking) is streamed to the renderer via 'discussion:turn' as it lands, so
// the user watches the debate live. One discussion at a time. Errors are isolated per
// provider — one broken AI never stops the room.
async function startDiscussion(event, { prompt, roster, rounds = 3, approval = {} } = {}) {
  const valid = validateDiscussionRequest({ prompt, roster, rounds }, { inFlight: discussionInFlight });
  if (!valid.ok) {
    return valid;
  }
  const { promptText, roster: requested, cycles } = valid;
  const send = (channel, payload) => { try { event.sender.send(channel, payload); } catch (_e) {} };

  discussionInFlight = true;
  try {
    // Open each provider through the gate; skip any that are forbidden/blocked/failed.
    const providers = [];
    for (const providerId of requested) {
      const decision = evaluateProviderOpen(providerId, approval);
      if (!decision.ok) {
        send('discussion:status', { providerId, joined: false, reason: decision.code || 'BLOCKED' });
        continue;
      }
      try {
        await providerWindowManager.openProvider(providerId);
        const webContents = providerWindowManager.getWebContents(providerId);
        const definition = DEFAULT_PROVIDER_DEFINITIONS[providerId];
        const domCapture = new DomCapture({ webContents });
        const sendController = new SendController({ webContents, hostWindow: mainWindow, verificationTimeoutMs: 30000, verificationPollMs: 500 });
        const lifecycleMonitor = new LifecycleMonitor({ webContents });
        providers.push(new WebviewProviderAdapter({ definition, sendController, lifecycleMonitor, domCapture }));
        send('discussion:status', { providerId, joined: true });
      } catch (err) {
        send('discussion:status', { providerId, joined: false, reason: 'OPEN_FAILED' });
      }
    }
    if (providers.length < 2) {
      return { ok: false, code: 'NOT_ENOUGH_PROVIDERS', message: 'Fewer than two AIs could join.' };
    }

    const transcriptStore = new TranscriptStore();
    const reasoningStore = new ReasoningStore();
    const orchestrator = new Orchestrator({ providers, transcriptStore, reasoningStore });

    // Stream each new AI turn (answer + its captured thinking) to the renderer.
    let streamed = 0;
    const pump = () => {
      const turns = transcriptStore.list().filter((e) => e.role === 'ai');
      for (let i = streamed; i < turns.length; i += 1) {
        const turn = turns[i];
        const reasoning = reasoningStore.latestForProvider
          ? reasoningStore.latestForProvider(turn.senderId)
          : null;
        send('discussion:turn', {
          providerId: turn.senderId,
          providerName: turn.senderName || turn.senderId,
          answer: String(turn.text || ''),
          reasoning: reasoning && reasoning.reasoning ? String(reasoning.reasoning) : ''
        });
      }
      streamed = turns.length;
    };
    const poll = setInterval(pump, 1200);

    let report;
    try {
      report = await orchestrator.run({ userMessage: promptText, cycles, turnDelayMs: 1200 });
    } finally {
      clearInterval(poll);
      pump();
    }
    send('discussion:done', {
      turns: transcriptStore.list().filter((e) => e.role === 'ai').length,
      rounds: cycles,
      providers: providers.length
    });
    return { ok: true, turns: (report && report.transcript ? report.transcript.length : undefined), rounds: cycles, providers: providers.length };
  } finally {
    discussionInFlight = false;
  }
}

function registerLifecycle() {
  app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

// Only wire up Electron side effects when running under a real Electron runtime.
// Under plain `node` (the test runner) require('electron') resolves to a string
// path, so `app`/`ipcMain` are undefined and this module must load side-effect-free
// so evaluateProviderOpen can be unit-tested.
if (app && typeof app.whenReady === 'function' && ipcMain && typeof ipcMain.handle === 'function') {
  registerLifecycle();
  registerIpcHandlers();
}

module.exports = {
  createMainWindow,
  evaluateProviderOpen,
  validateDiscussionRequest
};
