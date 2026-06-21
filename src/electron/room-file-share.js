'use strict';

const { FileUploadController, validateFile, safeErrorMessage } = require('./file-upload-controller');

// Share ONE file with EVERY provider in the room: attach it to each provider's web UI via
// the FileUploadController, and report per-provider {providerId, ok, code}. This is the
// "human shares a file with the whole discussion" flow — opt-in, explicit, never automatic.
// Metadata only: never logs file contents. The file is validated ONCE up front.
//
// targets: array of { providerId, webContents, provider } (provider = the definition, for
//          its uploadSelectors). webContents must be a live provider view.
async function shareFileWithRoom(targets, filePath) {
  const v = validateFile(filePath);
  if (!v.ok) {
    return { ok: false, code: v.code, message: v.message, perProvider: [] };
  }
  const list = Array.isArray(targets) ? targets : [];
  if (list.length === 0) {
    return { ok: false, code: 'NO_TARGETS', message: 'No providers to share the file with.', fileName: v.abs.split(/[\\/]/).pop(), okCount: 0, total: 0, perProvider: [] };
  }
  const perProvider = [];
  for (const t of list) {
    const providerId = t && t.providerId;
    if (!t || !t.webContents || !providerId) {
      perProvider.push({ providerId: providerId || '(missing)', ok: false, code: 'NO_WEBCONTENTS' });
      continue;
    }
    try {
      const controller = new FileUploadController({ webContents: t.webContents });
      const r = await controller.attachFile(t.provider || { id: providerId }, v.abs);
      perProvider.push({ providerId, ok: r.ok === true, code: r.code, fileName: r.fileName });
    } catch (error) {
      perProvider.push({ providerId, ok: false, code: 'SHARE_ERROR', message: safeErrorMessage(error) });
    }
  }
  const okCount = perProvider.filter((p) => p.ok).length;
  return {
    ok: okCount > 0,
    code: okCount === list.length ? 'SHARED_ALL' : (okCount > 0 ? 'SHARED_PARTIAL' : 'SHARED_NONE'),
    fileName: v.abs.split(/[\\/]/).pop(),
    size: v.size,
    okCount,
    total: list.length,
    perProvider
  };
}

module.exports = {
  shareFileWithRoom
};
