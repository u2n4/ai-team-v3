'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assert, makeTempDir } = require('../test-utils');
const { FileUploadController, validateFile, ALLOWED_EXT } = require('../../src/electron/file-upload-controller');

async function run() {
  const dir = makeTempDir('ai-team-v3-upload-');
  const png = path.join(dir, 'pic.png');
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const exe = path.join(dir, 'bad.exe');
  fs.writeFileSync(exe, 'nope');

  // validateFile: allowed type ok, missing/forbidden rejected.
  assert.equal(validateFile(png).ok, true);
  assert.equal(validateFile(path.join(dir, 'nope.png')).code, 'FILE_NOT_FOUND');
  assert.equal(validateFile(exe).code, 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(ALLOWED_EXT.has('.pdf'), true);

  // Magic-byte check: a text file renamed .png is rejected (content/extension mismatch).
  const spoof = path.join(dir, 'spoof.png');
  fs.writeFileSync(spoof, 'this is plain text, not a PNG');
  assert.equal(validateFile(spoof).code, 'FILE_CONTENT_MISMATCH');

  // Error messages disclose only the basename, never the absolute path (metadata-only).
  const missing = validateFile(path.join(dir, 'secret-folder-name.png'));
  assert.equal(missing.message.includes(dir), false);

  // allowedRoot containment: a file outside the root is rejected.
  const outside = validateFile(png, { allowedRoot: path.join(dir, 'subfolder-that-does-not-contain-it') });
  assert.equal(outside.code, 'FILE_OUTSIDE_ROOT');

  // attachFile happy path with a mock webContents + CDP debugger.
  let setFiles = null;
  const webContents = {
    async executeJavaScript(script) {
      // findFileInput probe -> report a file input exists; final accepted probe -> true.
      if (script.includes('input[type="file"]')) return true;
      return true;
    },
    debugger: {
      _attached: false,
      isAttached() { return this._attached; },
      attach() { this._attached = true; },
      detach() { this._attached = false; },
      async sendCommand(method, params) {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') return { nodeId: 42 };
        if (method === 'DOM.setFileInputFiles') { setFiles = params.files; return {}; }
        return {};
      }
    }
  };
  const ctrl = new FileUploadController({ webContents });
  const r = await ctrl.attachFile({ id: 'qwen' }, png);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'FILE_ATTACHED');
  assert.equal(r.fileName, 'pic.png');
  assert.deepEqual(setFiles, [path.resolve(png)]);

  // Rejects a forbidden file before touching the debugger.
  const bad = await ctrl.attachFile({ id: 'qwen' }, exe);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'FILE_TYPE_NOT_ALLOWED');

  // No file input on page -> structured refusal, not a throw.
  const noInputWc = {
    async executeJavaScript() { return false; },
    debugger: { isAttached() { return false; }, attach() {}, detach() {}, async sendCommand() { return {}; } }
  };
  const noInput = await new FileUploadController({ webContents: noInputWc }).attachFile({ id: 'qwen' }, png);
  assert.equal(noInput.code, 'NO_FILE_INPUT');

  console.log('PASS file upload controller: validates files and attaches via CDP setFileInputFiles, refuses safely');
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = run;
