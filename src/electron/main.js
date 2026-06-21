'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { ProviderWindowManager } = require('./provider-window-manager');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../providers/webview-provider-adapter');
const { ApprovalGateManager } = require('../core/approval-gate-manager');
const { buildDashboardState } = require('../core/dashboard-state');
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
  evaluateProviderOpen
};
