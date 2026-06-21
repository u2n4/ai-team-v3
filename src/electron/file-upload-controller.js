'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Strip absolute filesystem paths (and any secret-shaped text) from an error message before
// it can be returned/persisted — error messages are metadata-only, never path/secret disclosure.
function safeErrorMessage(error) {
  let msg = String((error && error.message) || error || '').slice(0, 200);
  msg = msg
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '[path]')   // Windows absolute paths
    .replace(/\/(?:[^\s'"/]+\/)+[^\s'"/]*/g, '[path]'); // POSIX absolute paths
  return msg;
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
    const root = path.resolve(allowedRoot);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
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
  constructor({ webContents }) {
    this.webContents = webContents;
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
  async attachFile(provider, filePath) {
    const v = validateFile(filePath);
    if (!v.ok) return v;

    const hasInput = await this.findFileInput(provider);
    if (!hasInput) {
      return { ok: false, code: 'NO_FILE_INPUT', message: 'No <input type=file> found on the provider page (and no attach button revealed one).' };
    }

    const dbg = this.webContents.debugger;
    let attachedHere = false;
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true; }
      await dbg.sendCommand('DOM.enable');
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
      if (!nodeId) {
        return { ok: false, code: 'NO_FILE_INPUT', message: 'File input vanished before it could be set.' };
      }
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [v.abs], nodeId });
      // Let the page register the file (preview/upload pipeline) before the caller sends.
      await new Promise((r) => setTimeout(r, 600));
      const accepted = await this.webContents.executeJavaScript(`
        (() => { const el = document.querySelector('input[type="file"]'); return !!(el && el.files && el.files.length > 0); })()
      `).catch(() => false);
      return {
        ok: accepted === true,
        code: accepted === true ? 'FILE_ATTACHED' : 'FILE_NOT_REGISTERED',
        fileName: path.basename(v.abs),
        size: v.size,
        ext: v.ext
      };
    } catch (error) {
      return { ok: false, code: 'UPLOAD_ERROR', message: safeErrorMessage(error) };
    } finally {
      try { if (attachedHere && dbg.isAttached()) dbg.detach(); } catch (_e) {}
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
