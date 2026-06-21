'use strict';

const {
  assertProviderLiveAllowed,
  loadProviderSessionPolicy,
  resolveProviderPartition
} = require('../providers/provider-session-policy');
const {
  loadLocalStorageVault,
  buildInjectionScript,
  hasLocalStorageVault,
  clearLocalStorageVault
} = require('./localstorage-vault');

class ProviderWindowManager {
  constructor({ hostWindow, providerDefinitions, sessionPolicy = loadProviderSessionPolicy() }) {
    this.hostWindow = hostWindow;
    this.providerDefinitions = providerDefinitions;
    this.sessionPolicy = sessionPolicy;
    this.views = new Map();
  }

  getElectron() {
    return require('electron');
  }

  getDefinition(providerId) {
    const definition = this.providerDefinitions[providerId];
    if (!definition) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return definition;
  }

  async openProvider(providerId, { reset = false, loadTimeoutMs } = {}) {
    const definition = this.getDefinition(providerId);
    assertProviderLiveAllowed(providerId, { policy: this.sessionPolicy });
    const existing = this.views.get(providerId);
    if (existing && !reset) {
      this.focusView(providerId);
      return this.describeView(providerId);
    }

    const { session } = this.getElectron();
    const partitionResolution = resolveProviderPartition(definition, providerId, { policy: this.sessionPolicy });
    const partitionSession = session.fromPartition(partitionResolution.partition, { cache: true });
    const view = this.createView(partitionSession);
    this.attachView(view);
    try {
      await this.loadUrlWithTimeout(view.webContents, definition.url, providerId, loadTimeoutMs);
    } catch (error) {
      // Registration happens ONLY after a successful load — a timed-out/failed load must
      // not leave a stale about:blank view that a later openProvider() reports as ready.
      this.destroyView(view);
      throw error;
    }
    // Inject the imported localStorage vault (auth tokens for deepseek/z.ai/kimi, which
    // store their session in localStorage, not cookies). The page is now on the correct
    // origin, so executeJavaScript can write localStorage. Reload once so the SPA boots
    // with the restored session. Best-effort: never block or fail openProvider.
    await this.injectLocalStorageVault(providerId, view.webContents);
    // Dismiss any blocking overlay/modal/popup that covers the composer (e.g. deepseek's
    // "Abnormal usage environment" dialog, cookie banners, "Got it" tips). This is the
    // "something you have to close first" the user observed. Best-effort, never blocks.
    await this.dismissOverlays(providerId, view.webContents);
    this.views.set(providerId, {
      providerId,
      definition,
      partition: partitionResolution.partition,
      partitionSource: partitionResolution.source,
      view,
      webContents: view.webContents
    });
    return this.describeView(providerId);
  }

  // Detach and tear down a view that never finished loading, so no stale entry survives.
  destroyView(view) {
    try {
      if (this.hostWindow.contentView && view.constructor.name === 'WebContentsView') {
        this.hostWindow.contentView.removeChildView(view);
      } else if (typeof this.hostWindow.removeBrowserView === 'function') {
        this.hostWindow.removeBrowserView(view);
      }
    } catch (_error) {}
    try {
      if (view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    } catch (_error) {}
  }

  // Inject the imported localStorage vault for this provider (once per process), then
  // reload so the SPA picks up the restored session. Best-effort and fully guarded — a
  // missing vault, an injection error, or a reload failure must never break openProvider.
  async injectLocalStorageVault(providerId, webContents) {
    try {
      this._vaultInjected = this._vaultInjected || new Set();
      if (this._vaultInjected.has(providerId)) return;
      if (!hasLocalStorageVault(providerId)) return;
      const store = loadLocalStorageVault(providerId);
      if (!store || Object.keys(store).length === 0) return;
      const written = await webContents.executeJavaScript(buildInjectionScript(store, { overwrite: true }));
      this._vaultInjected.add(providerId);
      if (Number(written) > 0) {
        clearLocalStorageVault(providerId);
        // Reload so the SPA boots with the restored session, and WAIT for the page to
        // finish loading before returning — otherwise dismissOverlays / the first send
        // would race a half-booted page.
        const loaded = new Promise((resolve) => {
          webContents.once('did-finish-load', resolve);
          webContents.once('dom-ready', resolve);
        });
        webContents.reload();
        await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    } catch (_error) {
      // Never let vault injection break provider opening.
    }
  }

  // Close blocking overlays (modals, cookie/consent banners, "Got it" tips, anti-bot
  // notices) that sit on top of the composer. Tries provider-specific dismiss selectors
  // first, then a generic close-button sweep. Fully guarded — never throws or blocks open.
  async dismissOverlays(providerId, webContents) {
    if (!webContents || typeof webContents.executeJavaScript !== 'function') return;
    const definition = this.providerDefinitions[providerId] || {};
    const extra = Array.isArray(definition.dismissSelectors) ? definition.dismissSelectors : [];
    try {
      await webContents.executeJavaScript(`
        (() => {
          const extra = ${JSON.stringify(extra)};
          const clickIfVisible = (el) => {
            try { if (el && el.offsetParent !== null) { el.click(); return true; } } catch (_e) {}
            return false;
          };
          let clicked = 0;
          // 1) Provider-specific dismiss selectors.
          for (const sel of extra) {
            try { for (const el of document.querySelectorAll(sel)) { if (clickIfVisible(el)) clicked++; } } catch (_e) {}
          }
          // 2) Generic close buttons — ONLY inside a detected modal/dialog/banner so we
          //    can't accidentally click a real page action (account, delete, onboarding).
          //    Restricted to clear dismiss words; no broad "continue/ok/accept/agree".
          const re = /^\\s*(×|✕|✖|close|dismiss|got it|i understand|skip|not now|no thanks|maybe later|اغلاق|إغلاق|تخطّi|تخطي|فهمت|لاحقا)\\s*$/i;
          const ariaRe = /^(close|dismiss)$/i;
          const containers = document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="banner" i],[class*="toast" i],[class*="consent" i],[class*="cookie" i]');
          for (const cont of containers) {
            if (cont.offsetParent === null) continue;
            for (const b of cont.querySelectorAll('button,[role="button"],[aria-label]')) {
              const t = (b.innerText || '').trim();
              const a = b.getAttribute('aria-label') || '';
              if ((t && re.test(t)) || (a && ariaRe.test(a))) { if (clickIfVisible(b)) clicked++; }
            }
          }
          // 3) Buttonless modals (e.g. deepseek "Abnormal usage environment"): press ESC,
          //    then click the dimmed overlay backdrop to dismiss.
          const modal = document.querySelector('[role="dialog"],[class*="modal" i],[class*="overlay" i],[class*="backdrop" i]');
          if (modal && modal.offsetParent !== null) {
            for (const t of ['keydown', 'keyup']) {
              document.dispatchEvent(new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
            }
            const overlay = document.querySelector('[class*="overlay" i],[class*="backdrop" i],[class*="mask" i]');
            if (overlay && overlay.offsetParent !== null) { try { overlay.click(); clicked++; } catch (_e) {} }
          }
          return clicked;
        })();
      `);
      // Brief settle so the SPA can re-enable the composer after the overlay closes.
      await new Promise((resolve) => setTimeout(resolve, 400));
    } catch (_error) {
      // never block provider opening on a dismiss failure
    }
  }

  // loadURL has no built-in deadline; a stalled navigation would hang the doctor/smoke
  // forever before their own timeouts could start. Race it against a configurable
  // deadline and surface a typed error so callers can write a BLOCKED report.
  async loadUrlWithTimeout(webContents, url, providerId, loadTimeoutMs) {
    const ms = Number.isFinite(loadTimeoutMs)
      ? loadTimeoutMs
      : Number(process.env.AI_TEAM_V3_LOAD_TIMEOUT_MS) || 45000;
    let timer = null;
    try {
      await Promise.race([
        webContents.loadURL(url),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`Provider ${providerId} navigation timed out after ${ms}ms.`);
            error.code = 'PROVIDER_LOAD_TIMEOUT';
            reject(error);
          }, ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  createView(partitionSession) {
    const electron = this.getElectron();
    const webPreferences = {
      session: partitionSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // Keep the provider page running at full speed even when the window is hidden,
      // minimized, or the screen is off. Chromium THROTTLES background/occluded pages
      // (slower timers, paused rAF, deferred DOM work), which made qwen's streamed
      // response stall and the capture time out when the user wasn't on screen. The room
      // must work unattended, so background throttling is disabled for provider views.
      backgroundThrottling: false,
      preload: undefined
    };

    if (electron.WebContentsView) {
      return new electron.WebContentsView({ webPreferences });
    }
    return new electron.BrowserView({ webPreferences });
  }

  attachView(view) {
    if (this.hostWindow.contentView && view.constructor.name === 'WebContentsView') {
      this.hostWindow.contentView.addChildView(view);
    } else {
      this.hostWindow.setBrowserView(view);
    }
    const bounds = this.hostWindow.getContentBounds();
    view.setBounds({
      x: 320,
      y: 0,
      width: Math.max(800, bounds.width - 320),
      height: bounds.height
    });
  }

  focusView(providerId) {
    const entry = this.views.get(providerId);
    if (entry) {
      this.attachView(entry.view);
      entry.webContents.focus();
    }
  }

  getWebContents(providerId) {
    const entry = this.views.get(providerId);
    return entry ? entry.webContents : null;
  }

  describeView(providerId) {
    const entry = this.views.get(providerId);
    if (!entry) {
      return null;
    }
    return {
      providerId,
      url: entry.webContents.getURL(),
      partition: entry.partition,
      partitionSource: entry.partitionSource
    };
  }
}

module.exports = {
  ProviderWindowManager
};
