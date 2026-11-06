'use strict';

/**
 * Edge Cookie Importer (V3, allowlist-only).
 *
 * Imports cookies from a running Microsoft Edge instance via the Chrome
 * DevTools Protocol (Network.getAllCookies) and injects them into the V3
 * provider partitions, so the user does not have to log in manually.
 *
 * SAFETY:
 * - Only imports cookies for the user's ALLOWED live providers. The user's
 *   most sensitive accounts (ChatGPT/Claude/Gemini/Perplexity and the shared
 *   google/microsoft sign-in domains that carry those sessions) are NEVER
 *   imported — they are on an explicit blocklist checked before every cookie.
 * - Each provider's cookies go only into that provider's own partition.
 * - Cookie values are never logged.
 */

const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { withDeadline } = require('../core/deadline');
const { redactSensitiveText } = require('../core/redact');
const { LIVE_PROVIDER_ALLOWLIST } = require('../providers/provider-contract');

// Map allowed provider ids -> the cookie domains that carry their session.
// Deliberately excludes chatgpt/claude/gemini and the shared Google/Microsoft
// identity domains (which would also unlock the forbidden accounts).
const PROVIDER_COOKIE_DOMAINS = Object.freeze({
  qwen: ['chat.qwen.ai', 'qwen.ai', 'qwenlm.ai'],
  kimi: ['kimi.com', 'www.kimi.com', 'moonshot.cn']
});

// Hard blocklist — cookies whose domain matches any of these are NEVER
// imported, even if some other rule would catch them. Protects the user's
// sensitive accounts and the shared identity providers behind them.
const FORBIDDEN_COOKIE_DOMAINS = Object.freeze([
  'chatgpt.com', 'chat.openai.com', 'openai.com',
  'claude.ai', 'anthropic.com',
  'gemini.google.com', 'bard.google.com',
  'google.com', 'accounts.google.com',
  'microsoft.com', 'live.com', 'microsoftonline.com', 'office.com'
]);

const DEBUG_PORT = 9222;

function normalizeDomain(domain) {
  return String(domain || '').replace(/^\./, '').toLowerCase();
}

function isForbiddenDomain(domain) {
  const d = normalizeDomain(domain);
  return FORBIDDEN_COOKIE_DOMAINS.some((bad) => d === bad || d.endsWith(`.${bad}`));
}

/** Which allowed provider (if any) a cookie domain belongs to. */
function providerForDomain(domain, allowedProviderIds) {
  const d = normalizeDomain(domain);
  for (const providerId of allowedProviderIds) {
    const domains = PROVIDER_COOKIE_DOMAINS[providerId] || [];
    if (domains.some((pd) => d === pd || d.endsWith(`.${pd}`))) {
      return providerId;
    }
  }
  return null;
}

function findEdgePath() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function httpGetJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('error', () => resolve(null));
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

async function isDebugPortAvailable() {
  const info = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  if (!info || !/Edg\/|Microsoft Edge\//i.test(String(info.Browser || '') + ' ' + String(info['User-Agent'] || ''))) return false;
  if (process.platform !== 'win32') return false;
  // Browser metadata alone can be spoofed. Verify the listening process image.
  const executable = await new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction Stop | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction Stop).Path } | Select-Object -Unique) -join [Environment]::NewLine'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? '' : stdout.trim()));
  });
  const expected = findEdgePath();
  return Boolean(expected && executable.toLowerCase() === expected.toLowerCase());
}

async function startEdgeWithDebugging() {
  if (await isDebugPortAvailable()) return { started: false };
  throw new Error('No verified Edge debug session on port 9222. Default Edge profiles cannot be debugged. Open a dedicated debug profile manually; no existing browser was changed.');
}

async function stopStartedEdgeDebugging() { return false; }

function importableProviderIds(ids) {
  return (ids || [])
    .map((id) => String(id || '').trim().toLowerCase())
    .filter((id) => LIVE_PROVIDER_ALLOWLIST.includes(id) && PROVIDER_COOKIE_DOMAINS[id]);
}

/** Read all cookies from the running Edge via CDP, then keep only allowed ones. */
async function getAllowedCookiesViaCDP(allowedProviderIds) {
  // The BROWSER-level endpoint + Storage.getCookies returns ALL cookies across every
  // domain in the profile. A page endpoint + Network.getAllCookies only exposes a
  // subset (cookies scoped to that page), which is why provider sessions for sites not
  // currently open came back nearly empty. (Ref: chromedp/chromedp#1350.)
  let cookies = [];
  const version = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  if (version && version.webSocketDebuggerUrl) {
    try {
      const response = await cdpGetAllCookies(version.webSocketDebuggerUrl, { method: 'Storage.getCookies' });
      if (response.error) throw new Error(response.error.message || 'CDP error');
      cookies = (response.result && response.result.cookies) || [];
    } catch (error) {
      if (process.env.AI_TEAM_V3_COOKIE_DEBUG === '1') console.error('[cookie-debug] browser endpoint failed:', error.message);
      cookies = [];
    }
  }
  if (process.env.AI_TEAM_V3_COOKIE_DEBUG === '1') {
    const zaiSeen = cookies.filter((c) => /z\.ai/i.test(c.domain || '')).length;
    const dsSeen = cookies.filter((c) => /deepseek/i.test(c.domain || '')).length;
    console.error(`[cookie-debug] browser endpoint cookies=${cookies.length} | z.ai=${zaiSeen} deepseek=${dsSeen}`);
  }

  // Fallback: if the browser endpoint yielded nothing, try a page endpoint.
  if (cookies.length === 0) {
    const pages = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
    const page = Array.isArray(pages) ? pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl) : null;
    if (!page) {
      throw new Error('No Edge browser or page endpoint available for CDP.');
    }
    const response = await cdpGetAllCookies(page.webSocketDebuggerUrl, { method: 'Storage.getCookies' });
    if (response.error) throw new Error(response.error.message || 'CDP error');
    cookies = (response.result && response.result.cookies) || [];
  }

  return cookies.filter((cookie) => {
    if (isForbiddenDomain(cookie.domain)) return false;
    return providerForDomain(cookie.domain, allowedProviderIds) !== null;
  });
}

/**
 * Read localStorage for a provider from an OPEN Edge tab on that provider's origin.
 * Some providers store auth in localStorage, not cookies, so a cookie-only import
 * can never log them in. Returns { [key]: value } or null
 * if no matching tab is open. The tab must already be open in Edge (the importer asks the
 * user to open these sites first).
 */
async function getProviderLocalStorageFromEdge(providerId) {
  const domains = PROVIDER_COOKIE_DOMAINS[providerId] || [];
  if (domains.length === 0) return null;
  const pages = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  if (!Array.isArray(pages)) return null;
  // Find an open tab whose URL host matches one of the provider's domains.
  const tab = pages.find((p) => {
    if (p.type !== 'page' || !p.webSocketDebuggerUrl || !p.url) return false;
    let host;
    try { host = new URL(p.url).hostname; } catch { return false; }
    if (isForbiddenDomain(host)) return false;
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  });
  if (!tab) return null;
  // Read localStorage as a JSON object via Runtime.evaluate (returnByValue).
  const expr = `(() => { if (location.origin !== ${JSON.stringify(new URL(tab.url).origin)}) throw new Error('Provider origin changed'); const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o); })()`;
  const res = await cdpCall(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: false
  });
  if (res.error || (res.result && res.result.exceptionDetails)) return null;
  const value = res.result && res.result.result && res.result.result.value;
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

/** Minimal CDP-over-raw-WebSocket call. Defaults to Storage.getCookies (browser-wide). */
function cdpGetAllCookies(wsUrl, { timeoutMs = 15000, method = 'Storage.getCookies' } = {}) {
  return cdpCall(wsUrl, method, {}, { timeoutMs });
}

// Native WebSocket validates the handshake and framing; ignore unsolicited CDP
// events and resolve only the response matching this command's request id.
function cdpCall(wsUrl, method, params = {}, { timeoutMs = 15000, id = 1, webSocketFactory = url => new WebSocket(url) } = {}) {
  const url = new URL(wsUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== DEBUG_PORT || url.username || url.password) {
    return Promise.reject(new Error('Untrusted CDP endpoint.'));
  }
  return new Promise((resolve, reject) => {
    const socket = webSocketFactory(url.href);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('CDP request timed out.')), timeoutMs);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id, method, params })));
    socket.addEventListener('error', () => finish(new Error('CDP WebSocket connection failed.')));
    socket.addEventListener('close', () => finish(new Error('CDP WebSocket closed early.')));
    socket.addEventListener('message', event => {
      try { const response = JSON.parse(String(event.data)); if (response.id === id) finish(null, response); }
      catch (error) { finish(error); }
    });
  });
}

function toElectronCookie(cookie) {
  const bareDomain = normalizeDomain(cookie.domain);
  const sameSite = cookie.sameSite === 'Strict' ? 'strict'
    : cookie.sameSite === 'Lax' ? 'lax'
      : 'no_restriction';
  // Chromium rejects "SameSite=None" cookies unless Secure is set. Many providers
  // (z.ai, deepseek) ship analytics/session cookies as SameSite=None;Secure=false in
  // the source profile, but Electron's session.cookies.set enforces the spec and drops
  // them. Force Secure for no_restriction so they import (the URL is https anyway).
  const secure = cookie.secure || sameSite === 'no_restriction';
  return {
    url: `https://${bareDomain}${cookie.path || '/'}`,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure,
    httpOnly: cookie.httpOnly || false,
    expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
    sameSite
  };
}

/**
 * Import Edge cookies for the allowed providers into their partitions.
 *
 * @param {object} deps
 * @param {Function} deps.sessionForProvider - (providerId) => Electron Session
 *        for that provider's partition.
 * @param {string[]} deps.allowedProviderIds - provider ids permitted to import.
 * @returns {Promise<{success:boolean, perProvider:object, message:string}>}
 */
async function importEdgeCookies({ sessionForProvider, allowedProviderIds, importLocalStorageForProvider }) {
  if (typeof sessionForProvider !== 'function') {
    throw new Error('sessionForProvider callback is required.');
  }
  const providerIds = importableProviderIds(allowedProviderIds);
  if (providerIds.length === 0) {
    return {
      success: false,
      perProvider: {},
      perProviderStorage: {},
      message: 'No live-allowed providers selected for import.'
    };
  }

  if (!findEdgePath()) {
    return { success: false, perProvider: {}, message: 'Microsoft Edge is not installed.' };
  }

  const perProvider = {};
  for (const id of providerIds) perProvider[id] = 0;
  const perProviderStorage = {};
  for (const id of providerIds) perProviderStorage[id] = 0;

  let debugSession;
  try {
    debugSession = await startEdgeWithDebugging();
    const cookies = await getAllowedCookiesViaCDP(providerIds);

    for (const cookie of cookies) {
      const providerId = providerForDomain(cookie.domain, providerIds);
      if (!providerId) continue; // double-guard
      try {
        const session = sessionForProvider(providerId);
        if (!session) continue;
        await session.cookies.set(toElectronCookie(cookie));
        perProvider[providerId] += 1;
      } catch (error) {
        // Skip a cookie that the session rejects; never log its value.
        if (process.env.AI_TEAM_V3_COOKIE_DEBUG === '1') console.error(`[cookie-debug] ${providerId} "${cookie.name}" (${cookie.domain}) rejected: ${redactSensitiveText(error.message)}`);
      }
    }

    // localStorage transfer: some allowed providers keep auth in localStorage, not
    // cookies. If the caller can write localStorage into a partition, pull each
    // provider's localStorage from an OPEN Edge tab on that origin and replay it.
    // The token value is never logged.
    if (typeof importLocalStorageForProvider === 'function') {
      const dbg = process.env.AI_TEAM_V3_COOKIE_DEBUG === '1';
      // Phase 1: read ALL provider localStorage from Edge FIRST (raw CDP sockets), before
      // opening any Electron BrowserWindow. Interleaving reads with window-based writes was
      // hanging the next CDP socket. Each read is hard-timeout-bounded.
      const stores = {};
      for (const providerId of providerIds) {
        try {
          if (dbg) console.error(`[storage-debug] ${providerId}: reading Edge localStorage...`);
          const store = await getProviderLocalStorageFromEdge(providerId);
          if (store && Object.keys(store).length > 0) {
            stores[providerId] = store;
            if (dbg) console.error(`[storage-debug] ${providerId}: read ${Object.keys(store).length} keys`);
          } else if (dbg) {
            console.error(`[storage-debug] ${providerId}: no open Edge tab on this origin`);
          }
        } catch (error) {
          if (dbg) console.error(`[storage-debug] ${providerId} read failed: ${error.message}`);
        }
      }
      // Phase 2: now write them into partitions (window-based), no more CDP reads. The
      // whole write is hard-capped so a Cloudflare-challenged loadURL can never hang import.
      for (const [providerId, store] of Object.entries(stores)) {
        try {
          if (dbg) console.error(`[storage-debug] ${providerId}: writing ${Object.keys(store).length} keys to partition...`);
          const written = await withDeadline(() => importLocalStorageForProvider(providerId, store), 30000, 'VAULT_WRITE_TIMEOUT');
          perProviderStorage[providerId] = (written === '__timeout__' || !Number.isFinite(Number(written))) ? 0 : Number(written);
          if (dbg) console.error(`[storage-debug] ${providerId}: wrote ${perProviderStorage[providerId]} keys${written === '__timeout__' ? ' (TIMED OUT)' : ''}`);
        } catch (error) {
          if (dbg) console.error(`[storage-debug] ${providerId} write failed: ${error.message}`);
        }
      }
    }
  } finally {
    await stopStartedEdgeDebugging(debugSession);
  }

  const total = Object.values(perProvider).reduce((a, b) => a + b, 0);
  const storageTotal = Object.values(perProviderStorage).reduce((a, b) => a + b, 0);
  return {
    success: total > 0 || storageTotal > 0,
    perProvider,
    perProviderStorage,
    message: total > 0 || storageTotal > 0
      ? `Imported ${total} cookies${storageTotal > 0 ? ` + ${storageTotal} localStorage keys` : ''} for allowed providers.`
      : 'No cookies found for the allowed providers. Make sure you are logged in to them in Edge.'
  };
}

module.exports = {
  PROVIDER_COOKIE_DOMAINS,
  FORBIDDEN_COOKIE_DOMAINS,
  isForbiddenDomain,
  providerForDomain,
  importEdgeCookies,
  importableProviderIds,
  getProviderLocalStorageFromEdge,
  cdpCall
};
