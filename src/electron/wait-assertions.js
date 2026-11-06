'use strict';

function timeoutError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function waitForCondition(check, {
  timeoutMs = 5000,
  pollMs = 100,
  code = 'WAIT_TIMEOUT',
  message = 'Timed out waiting for condition.'
} = {}) {
  const startedAt = Date.now();
  let lastResult;
  while (Date.now() - startedAt <= timeoutMs) {
    lastResult = await check();
    if (lastResult) {
      return lastResult;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw timeoutError(code, message, { timeoutMs, lastResult });
}

async function waitForVisible(webContents, selectors, options = {}) {
  return waitForCondition(async () => webContents.executeJavaScript(`
    (() => {
      const selectors = ${JSON.stringify(selectors || [])};
      for (const selector of selectors) {
        try {
          const node = document.querySelector(selector);
          if (!node || !node.getClientRects || node.getClientRects().length === 0) continue;
          const style = window.getComputedStyle(node);
          if (style && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0) {
            return { selector };
          }
        } catch (_error) {}
      }
      return null;
    })();
  `), {
    ...options,
    code: options.code || 'VISIBLE_TIMEOUT',
    message: options.message || 'Timed out waiting for a visible selector.'
  });
}

async function waitForEnabled(webContents, selectors, options = {}) {
  return waitForCondition(async () => webContents.executeJavaScript(`
    (() => {
      const selectors = ${JSON.stringify(selectors || [])};
      for (const selector of selectors) {
        try {
          const node = document.querySelector(selector);
          if (node && !node.disabled && node.getAttribute('aria-disabled') !== 'true') {
            return { selector };
          }
        } catch (_error) {}
      }
      return null;
    })();
  `), {
    ...options,
    code: options.code || 'ENABLED_TIMEOUT',
    message: options.message || 'Timed out waiting for an enabled selector.'
  });
}

async function waitForStableText(readText, { stableMs = 1200, timeoutMs = 10000, pollMs = 100 } = {}) {
  const startedAt = Date.now();
  let lastText = '';
  let lastChangedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const text = String(await readText() || '');
    if (text !== lastText) {
      lastText = text;
      lastChangedAt = Date.now();
    }
    if (lastText && Date.now() - lastChangedAt >= stableMs) {
      return { text: lastText, stableMs };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw timeoutError('STABLE_TEXT_TIMEOUT', 'Timed out waiting for stable text.', { timeoutMs, stableMs });
}

async function waitForResponseCountIncrement(readCount, baselineCount, options = {}) {
  return waitForCondition(async () => {
    const count = Number(await readCount());
    return count > Number(baselineCount) ? { baselineCount, finalCount: count } : null;
  }, {
    ...options,
    code: options.code || 'RESPONSE_COUNT_TIMEOUT',
    message: options.message || 'Timed out waiting for response count increment.'
  });
}

async function waitForComposerClear(readComposerText, options = {}) {
  return waitForCondition(async () => {
    const text = String(await readComposerText() || '');
    return text.trim() === '' ? { cleared: true } : null;
  }, {
    ...options,
    code: options.code || 'COMPOSER_CLEAR_TIMEOUT',
    message: options.message || 'Timed out waiting for composer clear.'
  });
}

async function waitForNoChallenge(checkChallenge, options = {}) {
  return waitForCondition(async () => {
    const result = await checkChallenge();
    return result && result.challengeDetected === false ? { challengeDetected: false } : null;
  }, {
    timeoutMs: options.timeoutMs || 1000,
    pollMs: options.pollMs || 100,
    code: options.code || 'CHALLENGE_STILL_PRESENT',
    message: options.message || 'Timed out waiting for challenge-free provider page.'
  });
}

module.exports = {
  waitForComposerClear,
  waitForCondition,
  waitForEnabled,
  waitForNoChallenge,
  waitForResponseCountIncrement,
  waitForStableText,
  waitForVisible
};
