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
const net = require('node:net');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
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
    if (domains.some((pd) => d === pd || d.endsWith(`.${pd}`) || pd.endsWith(`.${d}`))) {
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
  return Boolean(info);
}

async function startEdgeWithDebugging() {
  const edgePath = findEdgePath();
  if (!edgePath) {
    throw new Error('Microsoft Edge not found.');
  }
  if (await isDebugPortAvailable()) {
    return { started: false };
  }
  const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run'
  ];
  const child = spawn(edgePath, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isDebugPortAvailable()) return { started: true, child };
    await new Promise((r) => setTimeout(r, 500));
  }
  try { child.kill(); } catch {}
  throw new Error('Timed out waiting for the Edge debug port. Close Edge manually and retry.');
}

async function stopStartedEdgeDebugging(debugSession) {
  if (!debugSession || debugSession.started !== true) return false;
  try {
    const version = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 1000);
    if (version && version.webSocketDebuggerUrl) {
      await Promise.race([
        cdpCall(version.webSocketDebuggerUrl, 'Browser.close', {}, { timeoutMs: 2000, id: 99 }),
        new Promise((resolve) => setTimeout(resolve, 2500))
      ]);
    }
  } catch {}
  try {
    if (debugSession.child && debugSession.child.killed !== true) debugSession.child.kill();
  } catch {}
  return true;
}

function importableProviderIds(ids) {
  return (ids || Object.keys(PROVIDER_COOKIE_DOMAINS))
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
    const response = await cdpGetAllCookies(page.webSocketDebuggerUrl, { method: 'Network.getAllCookies' });
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
    return domains.some((d) => host === d || host.endsWith(`.${d}`) || d.endsWith(`.${host}`));
  });
  if (!tab) return null;
  // Read localStorage as a JSON object via Runtime.evaluate (returnByValue).
  const expr = '(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o); })()';
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
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; try { socket.destroy(); } catch {} fn(arg); } };

    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect({ host: u.hostname, port: Number(u.port) || 80 }, () => {
      const req =
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n';
      socket.write(req);
    });

    const timer = setTimeout(() => finish(reject, new Error('CDP cookie request timed out.')), timeoutMs);
    socket.setTimeout(timeoutMs, () => finish(reject, new Error('CDP socket timed out.')));

    let handshakeDone = false;
    let buffer = Buffer.alloc(0);
    const messageChunks = [];

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeDone) {
        const sep = buffer.indexOf('\r\n\r\n');
        if (sep === -1) return;
        const header = buffer.slice(0, sep).toString('utf8');
        if (!/101/.test(header.split('\r\n')[0])) {
          clearTimeout(timer);
          return finish(reject, new Error('WebSocket handshake failed.'));
        }
        handshakeDone = true;
        buffer = buffer.slice(sep + 4);
        // Send a single masked text frame with the CDP request.
        socket.write(encodeTextFrame(JSON.stringify({ id: 1, method })));
      }
      // Parse server frames (unmasked) from the buffer.
      let parsed;
      while ((parsed = decodeFrame(buffer)) && parsed.complete) {
        buffer = parsed.rest;
        if (parsed.opcode === 0x8) { clearTimeout(timer); return finish(reject, new Error('WebSocket closed by Edge.')); }
        if (parsed.opcode === 0x1 || parsed.opcode === 0x0) {
          messageChunks.push(parsed.payload.toString('utf8'));
          if (parsed.fin) {
            try {
              const json = JSON.parse(messageChunks.join(''));
              clearTimeout(timer);
              return finish(resolve, json);
            } catch (err) {
              clearTimeout(timer);
              return finish(reject, err);
            }
          }
        }
      }
    });
    socket.on('error', (err) => { clearTimeout(timer); finish(reject, err); });
    socket.on('close', () => { clearTimeout(timer); if (!settled) finish(reject, new Error('CDP socket closed early.')); });
  });
}

/**
 * General CDP-over-raw-WebSocket call: send {id, method, params}, resolve the matching
 * response. Reuses the same framing as cdpGetAllCookies. Used for Runtime.evaluate to
 * read a page's localStorage (providers like deepseek/z.ai store auth there, not cookies).
 */
function cdpCall(wsUrl, method, params = {}, { timeoutMs = 15000, id = 1 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; try { socket.destroy(); } catch {} fn(arg); } };
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect({ host: u.hostname, port: Number(u.port) || 80 }, () => {
      socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    const timer = setTimeout(() => finish(reject, new Error('CDP call timed out.')), timeoutMs);
    socket.setTimeout(timeoutMs, () => finish(reject, new Error('CDP socket timed out.')));
    let handshakeDone = false;
    let buffer = Buffer.alloc(0);
    const chunks = [];
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeDone) {
        const sep = buffer.indexOf('\r\n\r\n');
        if (sep === -1) return;
        if (!/101/.test(buffer.slice(0, sep).toString('utf8').split('\r\n')[0])) {
          clearTimeout(timer);
          return finish(reject, new Error('WebSocket handshake failed.'));
        }
        handshakeDone = true;
        buffer = buffer.slice(sep + 4);
        socket.write(encodeTextFrame(JSON.stringify({ id, method, params })));
      }
      let parsed;
      while ((parsed = decodeFrame(buffer)) && parsed.complete) {
        buffer = parsed.rest;
        if (parsed.opcode === 0x8) { clearTimeout(timer); return finish(reject, new Error('WebSocket closed by Edge.')); }
        if (parsed.opcode === 0x1 || parsed.opcode === 0x0) {
          chunks.push(parsed.payload.toString('utf8'));
          if (parsed.fin) {
            let json;
            try { json = JSON.parse(chunks.join('')); }
            catch (err) { clearTimeout(timer); return finish(reject, err); }
            // Skip CDP events / mismatched ids; wait for our response id.
            if (json.id !== id) { chunks.length = 0; continue; }
            clearTimeout(timer);
            return finish(resolve, json);
          }
        }
      }
    });
    socket.on('error', (err) => { clearTimeout(timer); finish(reject, err); });
    socket.on('close', () => { clearTimeout(timer); if (!settled) finish(reject, new Error('CDP socket closed early.')); });
  });
}

/** Encode a client->server masked text frame (RFC 6455). */
function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/** Decode one server->client frame (server frames are unmasked). */
function decodeFrame(buf) {
  if (buf.length < 2) return { complete: false };
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return { complete: false };
    len = buf.readUInt16BE(2); offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return { complete: false };
    len = Number(buf.readBigUInt64BE(2)); offset = 10;
  }
  let maskKey;
  if (masked) {
    if (buf.length < offset + 4) return { complete: false };
    maskKey = buf.slice(offset, offset + 4); offset += 4;
  }
  if (buf.length < offset + len) return { complete: false };
  let payload = buf.slice(offset, offset + len);
  if (masked && maskKey) {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i += 1) out[i] = payload[i] ^ maskKey[i % 4];
    payload = out;
  }
  return { complete: true, fin, opcode, payload, rest: buf.slice(offset + len) };
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
        if (process.env.AI_TEAM_V3_COOKIE_DEBUG === '1') console.error(`[cookie-debug] ${providerId} "${cookie.name}" (${cookie.domain}) rejected: ${error.message}`);
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
          const store = await Promise.race([
            getProviderLocalStorageFromEdge(providerId),
            new Promise((resolve) => setTimeout(() => resolve(null), 15000))
          ]);
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
          const written = await Promise.race([
            Promise.resolve(importLocalStorageForProvider(providerId, store)).catch(() => 0),
            new Promise((resolve) => setTimeout(() => resolve('__timeout__'), 30000))
          ]);
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
    message: total > 0
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
