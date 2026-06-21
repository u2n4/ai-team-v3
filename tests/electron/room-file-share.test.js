'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assert, makeTempDir } = require('../test-utils');
const { shareFileWithRoom } = require('../../src/electron/room-file-share');

// A mock provider webContents whose CDP debugger accepts setFileInputFiles. `hasInput`
// controls whether the page reports a file input (to simulate a provider with no upload).
function mockWebContents(hasInput) {
  return {
    async executeJavaScript() { return hasInput; },
    debugger: {
      _a: false,
      isAttached() { return this._a; },
      attach() { this._a = true; },
      detach() { this._a = false; },
      async sendCommand(method) {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') return { nodeId: 7 };
        return {};
      }
    }
  };
}

async function run() {
  const dir = makeTempDir('ai-team-v3-roomshare-');
  const png = path.join(dir, 'doc.png');
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  // All providers can take the file.
  const targets = [
    { providerId: 'qwen', webContents: mockWebContents(true), provider: { id: 'qwen' } },
    { providerId: 'gemini', webContents: mockWebContents(true), provider: { id: 'gemini' } }
  ];
  const r = await shareFileWithRoom(targets, png);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'SHARED_ALL');
  assert.equal(r.okCount, 2);
  assert.equal(r.perProvider.every((p) => p.ok), true);

  // One provider has no file input -> partial.
  const mixed = [
    { providerId: 'qwen', webContents: mockWebContents(true), provider: { id: 'qwen' } },
    { providerId: 'kimi', webContents: mockWebContents(false), provider: { id: 'kimi' } }
  ];
  const rp = await shareFileWithRoom(mixed, png);
  assert.equal(rp.code, 'SHARED_PARTIAL');
  assert.equal(rp.okCount, 1);
  assert.equal(rp.perProvider.find((p) => p.providerId === 'kimi').code, 'NO_FILE_INPUT');

  // A forbidden/invalid file is rejected once, before touching any provider.
  const exe = path.join(dir, 'x.exe');
  fs.writeFileSync(exe, 'no');
  const bad = await shareFileWithRoom(targets, exe);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(bad.perProvider.length, 0);

  // A target missing webContents is reported, not thrown.
  const broken = await shareFileWithRoom([{ providerId: 'meta' }], png);
  assert.equal(broken.perProvider[0].code, 'NO_WEBCONTENTS');

  console.log('PASS room file share: a file fans out to all providers with per-provider results, rejects bad files once');
}

if (require.main === module) {
  run().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = run;
