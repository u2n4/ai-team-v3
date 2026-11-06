'use strict';

// Bounds even an executeJavaScript promise whose renderer has stopped answering.
// Callers cancel the underlying operation on expiry; the timer is always released.
async function withDeadline(operation, timeoutMs, code, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          try { if (onTimeout) onTimeout(); } catch {}
          const error = new Error(`${code}: operation timed out after ${timeoutMs}ms.`);
          error.code = code;
          reject(error);
        }, timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}

module.exports = { withDeadline };
