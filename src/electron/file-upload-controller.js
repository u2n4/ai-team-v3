'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { redactSensitiveText } = require('../core/redact');
const { FORBIDDEN_LIVE_PROVIDERS } = require('../providers/provider-contract');

// Strip absolute filesystem paths (and any secret-shaped text) from an error message before
// it can be returned/persisted — error messages are metadata-only, never path/secret disclosure.
function safeErrorMessage(error) {
  let msg = redactSensitiveText((error && error.message) || error || '');
  msg = msg
    .replace(/[A-Za-z]:[\\/][^'"\r\n)]+/g, '[path]')
    .replace(/(^|[\s'"(])\/[^'"\r\n)]+/g, '$1[path]');
  return msg.slice(0, 200);
}

// Generic attach-button selectors that reveal a hidden <input type=file> on most provider
// chat UIs. Per-provider `uploadSelectors` (in the provider definition) take precedence.
const GENERIC_ATTACH_SELECTORS = [
  'button[aria-label*="attach" i]',
  'button[aria-label*="upload" i]',
  'button[aria-label*="file" i]',
  'button[aria-label*="image" i]',
  'button[title*="attach" i]',
  'button[title*="upload" i]',
  '[data-testid*="attach" i]',
  '[data-testid*="upload" i]',
  'label[for]'
];

// Reasonable safety caps so we never push a huge/odd file into a provider page.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt', '.md', '.csv', '.json', '.docx', '.xlsx']);

// Magic-byte signatures for the binary types we allow, so a text file renamed .png (or any
// extension spoof) is rejected. Text-ish types (.txt/.md/.csv/.json) have no fixed signature
// and are accepted by extension. docx/xlsx are ZIP containers (PK..).
const MAGIC = {
  '.png': [[0x89, 0x50, 0x4e, 0x47]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]],
  '.pdf': [[0x25, 0x50, 0x44, 0x46]],
  '.docx': [[0x50, 0x4b, 0x03, 0x04]],
  '.xlsx': [[0x50, 0x4b, 0x03, 0x04]]
};

function matchesMagic(abs, ext) {
  const sigs = MAGIC[ext];
  if (!sigs) return true; // text types: no signature to check
  let fd;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    const headOk = sigs.some((sig) => sig.every((b, i) => buf[i] === b));
    if (!headOk) return false;
    // Deeper checks for container formats whose prefix alone is ambiguous:
    // - WEBP is "RIFF....WEBP" (the 'WEBP' marker is at bytes 8-11).
    if (ext === '.webp') {
      return buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    }
    return true;
  } catch (_e) {
    return false;
  } finally {
    try { if (fd != null) fs.closeSync(fd); } catch (_e) {}
  }
}

// Validate a file for upload. `allowedRoot` (optional) confines the real path to a directory
// (defense in depth against traversal). Error messages are metadata-only: they NEVER include
// the absolute path (only the basename), so a persisted diagnostic can't disclose local paths.
function validateFile(filePath, { allowedRoot = null } = {}) {
  const raw = String(filePath || '');
  let abs;
  try { abs = fs.realpathSync(path.resolve(raw)); } catch (_e) { abs = path.resolve(raw); }
  const base = path.basename(abs) || '(unnamed)';
  if (!fs.existsSync(abs)) {
    return { ok: false, code: 'FILE_NOT_FOUND', message: `File not found: ${base}` };
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    return { ok: false, code: 'NOT_A_FILE', message: `Not a file: ${base}` };
  }
  if (allowedRoot) {
    let root;
    try { root = fs.realpathSync(path.resolve(allowedRoot)); }
    catch { return { ok: false, code: 'FILE_OUTSIDE_ROOT', message: 'Allowed upload folder is unavailable.' }; }
    const relative = path.relative(root, abs);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return { ok: false, code: 'FILE_OUTSIDE_ROOT', message: `File is outside the allowed folder: ${base}` };
    }
  }
  if (stat.size > MAX_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: `File exceeds the ${MAX_FILE_BYTES}-byte limit: ${base}` };
  }
  const ext = path.extname(abs).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, code: 'FILE_TYPE_NOT_ALLOWED', message: `Extension not allowed (${ext || 'none'}): ${base}` };
  }
  if (!matchesMagic(abs, ext)) {
    return { ok: false, code: 'FILE_CONTENT_MISMATCH', message: `File contents do not match the ${ext} type: ${base}` };
  }
  return { ok: true, abs, size: stat.size, ext };
}

class FileUploadController {
  constructor({ webContents, allowedRoot = null }) {
    this.webContents = webContents;
    this.allowedRoot = allowedRoot;
  }

  // Resolve the CDP backendNodeId of an <input type=file> on the page, optionally after
  // clicking a provider attach button to reveal it. Returns null if none found.
  async findFileInput(provider) {
    const inPage = await this.webContents.executeJavaScript(`
      (() => {
        const found = !!document.querySelector('input[type="file"]');
        if (found) return true;
        // Try clicking a provider/generic attach control to reveal a hidden file input.
        const sels = ${JSON.stringify((provider && provider.uploadSelectors) || GENERIC_ATTACH_SELECTORS)};
        for (const s of sels) {
          try { const el = document.querySelector(s); if (el) { el.click(); } } catch (_e) {}
        }
        return !!document.querySelector('input[type="file"]');
      })()
    `).catch(() => false);
    return inPage === true;
  }

  // Attach a single file to the provider's file input via CDP DOM.setFileInputFiles — this
  // sets the file programmatically without an OS dialog and fires the page's change handler,
  // exactly as a real user picking a file would. Returns a structured result (metadata only).
  async attachFile(provider, filePath, { allowedRoot = this.allowedRoot } = {}) {
    if (provider && FORBIDDEN_LIVE_PROVIDERS.includes(provider.id)) {
      return { ok: false, code: 'BLOCKED_PROVIDER_FORBIDDEN', message: 'File upload to this provider is forbidden.' };
    }
    const v = validateFile(filePath, { allowedRoot });
    if (!v.ok) return v;
    let stagingDir;
    let dbg;
    let attachedHere = false;
    try {
      if (this.webContents.isDestroyed && this.webContents.isDestroyed()) throw new Error('Provider view was closed.');
      if (provider && provider.url && this.webContents.getURL && new URL(this.webContents.getURL()).origin !== new URL(provider.url).origin) {
        return { ok: false, code: 'PROVIDER_ORIGIN_MISMATCH', message: 'Provider navigated away before file upload.' };
      }
      // CDP reads a path later. Give it a private snapshot whose actual bytes are
      // validated, so changes to the selected original cannot change the upload.
      stagingDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-team-v3-upload-'));
      await fs.promises.chmod(stagingDir, 0o700);
      const stagedPath = path.join(stagingDir, path.basename(v.abs));
      let copied = 0;
      await pipeline(fs.createReadStream(v.abs), new Transform({
        transform(chunk, _encoding, callback) {
          copied += chunk.length;
          callback(copied > MAX_FILE_BYTES ? new Error('File exceeded the upload size limit while being copied.') : null, chunk);
        }
      }), fs.createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 }));
      await fs.promises.chmod(stagedPath, 0o600);
      const snapshot = validateFile(stagedPath, { allowedRoot: stagingDir });
      if (!snapshot.ok) return snapshot;
      const deadline = Date.now() + 2000;
      let hasInput = await this.findFileInput(provider);
      while (!hasInput && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        hasInput = await this.webContents.executeJavaScript('Boolean(document.querySelector(\'input[type="file"]\'))').catch(() => false);
      }
      if (!hasInput) return { ok: false, code: 'NO_FILE_INPUT', message: 'No file input appeared after opening the attachment control.' };
      dbg = this.webContents.debugger;
      if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true; }
      await dbg.sendCommand('DOM.enable');
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
      if (!nodeId) {
        return { ok: false, code: 'NO_FILE_INPUT', message: 'File input vanished before it could be set.' };
      }
      if (provider && provider.url && this.webContents.getURL && new URL(this.webContents.getURL()).origin !== new URL(provider.url).origin) {
        return { ok: false, code: 'PROVIDER_ORIGIN_MISMATCH', message: 'Provider navigated away before file upload.' };
      }
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [stagedPath], nodeId });
      // Let the page register the file (preview/upload pipeline) before the caller sends.
      await new Promise((r) => setTimeout(r, 600));
      const accepted = await this.webContents.executeJavaScript(`
        (() => { const el = document.querySelector('input[type="file"]'); return !!(el && el.files && el.files.length > 0); })()
      `).catch(() => false);
      return {
        ok: accepted === true,
        code: accepted === true ? 'FILE_ATTACHED' : 'FILE_NOT_REGISTERED',
        fileName: path.basename(v.abs),
        size: snapshot.size,
        ext: v.ext
      };
    } catch (error) {
      return { ok: false, code: 'UPLOAD_ERROR', message: safeErrorMessage(error) };
    } finally {
      try { if (attachedHere && dbg.isAttached()) dbg.detach(); } catch (_e) {}
      if (stagingDir) await fs.promises.rm(stagingDir, { recursive: true, force: true });
    }
  }
}

module.exports = {
  FileUploadController,
  validateFile,
  safeErrorMessage,
  MAX_FILE_BYTES,
  ALLOWED_EXT,
  GENERIC_ATTACH_SELECTORS
};
