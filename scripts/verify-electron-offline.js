'use strict';

// Real Electron dashboard only: isolated profile and all external requests blocked.
// This script never enables live gates, opens provider pages or reads real sessions.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp', 'final-round');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron-profile'));
app.commandLine.appendSwitch('disable-background-networking');
const result = { electron: process.versions.electron, entrypointIsMain: require.main === module, consoleErrors: [], preloadErrors: [], runtimeErrors: [], externalRequests: 0 };
let completed = false;
function finish(code) {
  if (completed) return;
  completed = true;
  clearTimeout(watchdog);
  fs.writeFileSync(path.join(output, 'electron-offline.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(code);
}
process.on('uncaughtException', error => { result.runtimeErrors.push(error.message); finish(1); });
process.on('unhandledRejection', error => { result.runtimeErrors.push(String(error && error.message || error)); finish(1); });
const watchdog = setTimeout(() => { result.runtimeErrors.push('OFFLINE_WINDOW_TIMEOUT'); finish(1); }, 30000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', details => { if (details.level === 'error' || details.level === 3) result.consoleErrors.push(details.message); });
  win.webContents.on('preload-error', (_event, _file, error) => result.preloadErrors.push(error.message));
  win.webContents.on('render-process-gone', (_event, details) => result.runtimeErrors.push(details.reason));
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1200));
      result.visible = win.isVisible();
      result.title = win.getTitle();
      result.dashboard = await win.webContents.executeJavaScript(`({ cards: document.querySelectorAll('.provider-card').length, bridge: Boolean(window.aiTeamV3), discussion: Boolean(document.querySelector('.discussion-panel')), textLength: document.getElementById('app').textContent.length })`);
      // A prohibited roster must be rejected with no provider window creation.
      result.forbiddenRequest = await win.webContents.executeJavaScript(`window.aiTeamV3.startDiscussion({ prompt: 'offline validation only', roster: ['gemini', 'qwen'] })`);
      await win.webContents.executeJavaScript(`(() => { const input = document.createElement('textarea'); input.id = 'offline-key-probe'; input.addEventListener('keydown', e => { input.dataset.key = e.key; }); document.body.appendChild(input); input.focus(); })()`);
      win.focus(); win.webContents.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await new Promise(resolve => setTimeout(resolve, 50));
      result.returnKey = await win.webContents.executeJavaScript(`(() => { const input = document.getElementById('offline-key-probe'); const key = input.dataset.key; input.remove(); return key; })()`);
      result.windows = BrowserWindow.getAllWindows().length;
      const prefs = win.webContents.getLastWebPreferences();
      result.sandbox = prefs.sandbox; result.contextIsolation = prefs.contextIsolation; result.nodeIntegration = prefs.nodeIntegration;
      fs.writeFileSync(path.join(output, 'electron-window.png'), (await win.webContents.capturePage()).toPNG());
      const ok = result.electron.startsWith('45.') && result.visible && result.dashboard.cards > 0 && result.dashboard.discussion && result.dashboard.bridge &&
        result.windows === 1 && result.forbiddenRequest.code === 'BLOCKED_PROVIDER_FORBIDDEN' && result.sandbox && result.contextIsolation && !result.nodeIntegration &&
        result.returnKey === 'Enter' && !result.consoleErrors.length && !result.preloadErrors.length && !result.runtimeErrors.length;
      result.ok = ok;
      finish(ok ? 0 : 1);
    } catch (error) { result.runtimeErrors.push(error.message); finish(1); }
  });
});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
    result.externalRequests++; callback({ cancel: true });
  });
  require('../src/electron/main');
});
