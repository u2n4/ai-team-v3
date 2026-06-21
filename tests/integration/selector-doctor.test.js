'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { assert, makeTempDir } = require('../test-utils');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../../src/providers/webview-provider-adapter');
const {
  classifySelectorVerification,
  runDoctor,
  runSelectorDoctorForWebContents,
  sanitizeUrl,
  validateProvider
} = require('../../scripts/selector-doctor');

function tempPaths() {
  const dir = makeTempDir('ai-team-v3-doctor-');
  return {
    dir,
    reportPath: path.join(dir, 'LIVE_PREP_3_SELECTOR_VERIFICATION.md'),
    traceDir: path.join(dir, 'traces')
  };
}

function xray(provider, overrides = {}) {
  const inputCount = overrides.inputCount == null ? 1 : overrides.inputCount;
  const sendCount = overrides.sendCount == null ? 1 : overrides.sendCount;
  return {
    url: `${overrides.urlOverride || provider.url}?access_token=secret-token#session=secret-session`,
    title: 'Provider',
    readyState: overrides.readyState || 'complete',
    responseCountSelector: {
      selector: provider.responseCountSelector,
      count: overrides.responseCount == null ? 0 : overrides.responseCount,
      actionableCount: 0
    },
    selectorCounts: {
      inputSelectors: provider.inputSelectors.map((selector, index) => ({
        selector,
        count: index === 0 ? inputCount : 0,
        actionableCount: index === 0 ? inputCount : 0
      })),
      sendSelectors: provider.sendSelectors.map((selector, index) => ({
        selector,
        count: index === 0 ? sendCount : 0,
        actionableCount: index === 0 ? sendCount : 0
      })),
      responseSelectors: provider.responseSelectors.map((selector, index) => ({
        selector,
        count: index === 0 ? 1 : 0,
        actionableCount: 0
      })),
      thinkingSelectors: provider.thinkingSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      errorSelectors: provider.errorSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      limitSelectors: provider.limitSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      challengeSelectors: provider.challengeSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 }))
    },
    textSignals: {
      challengeCount: overrides.challengeCount || 0,
      limitCount: overrides.limitCount || 0,
      loginHintCount: overrides.loginHintCount || 0,
      paidWallCount: overrides.paidWallCount || 0
    }
  };
}

async function run() {
  assert.equal(validateProvider('qwen').ok, true);
  assert.equal(validateProvider('kimi').ok, true);
  assert.equal(validateProvider('grok').status, 'BLOCKED_UNSUPPORTED_PROVIDER');
  assert.equal(validateProvider('zai').status, 'BLOCKED_UNSUPPORTED_PROVIDER');
  assert.equal(validateProvider('meta').status, 'BLOCKED_UNSUPPORTED_PROVIDER');
  assert.equal(validateProvider('manus').status, 'BLOCKED_UNSUPPORTED_PROVIDER');
  assert.equal(validateProvider('deepseek').status, 'BLOCKED_UNSUPPORTED_PROVIDER');
  // 2026-06-21 (D20): gemini/perplexity are no longer forbidden, but stay outside the
  // doctor's qwen/kimi allowlist (UNSUPPORTED). Only ChatGPT/Claude stay forbidden.
  assert.equal(validateProvider('perplexity').status, 'BLOCKED_UNSUPPORTED_PROVIDER');
  assert.equal(validateProvider('gemini').status, 'BLOCKED_UNSUPPORTED_PROVIDER');
  assert.equal(validateProvider('claude').status, 'BLOCKED_PROVIDER_FORBIDDEN');
  assert.equal(validateProvider('chatgpt').status, 'BLOCKED_PROVIDER_FORBIDDEN');

  const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
  assert.equal(sanitizeUrl('https://chat.qwen.ai/?token=abc#session=def'), 'https://chat.qwen.ai/');
  assert.equal(classifySelectorVerification(provider, xray(provider, { challengeCount: 1 })).code, 'PROVIDER_CHALLENGE');
  assert.equal(classifySelectorVerification(provider, xray(provider, { limitCount: 1 })).code, 'PROVIDER_LIMIT');
  assert.equal(classifySelectorVerification(provider, xray(provider, { inputCount: 0, loginHintCount: 1 })).code, 'PROVIDER_LOGIN_WALL');
  assert.equal(classifySelectorVerification(provider, xray(provider, { paidWallCount: 1 })).code, 'PROVIDER_PAID_WALL');
  // Regression (found via live deepseek/zai): a login page that still exposes an
  // actionable OAuth button must NOT report READY. Either a login URL path or any
  // login-text hint blocks the smoke, regardless of actionable input count.
  assert.equal(
    classifySelectorVerification(provider, xray(provider, { urlOverride: 'https://chat.deepseek.com/sign_in', inputCount: 2, loginHintCount: 2 })).code,
    'PROVIDER_LOGIN_WALL'
  );
  assert.equal(
    classifySelectorVerification(provider, xray(provider, { inputCount: 1, sendCount: 2, loginHintCount: 2 })).code,
    'PROVIDER_LOGIN_WALL'
  );
  // A genuinely logged-in provider (no login hints, clean URL) still reports READY.
  assert.equal(classifySelectorVerification(provider, xray(provider, { inputCount: 1 })).code, 'READY');

  {
    const { reportPath, traceDir } = tempPaths();
    let scriptsEvaluated = 0;
    const result = await runSelectorDoctorForWebContents({
      provider,
      reportPath,
      traceDir,
      // This case verifies the classification/redaction from a settled xray; the
      // async composer wait is covered by the live runs, so skip it here.
      waitForComposer: false,
      webContents: {
        async executeJavaScript(script) {
          scriptsEvaluated += 1;
          assert.equal(/promptText|KeyboardEvent|dispatchEvent|\.click\(/.test(script), false);
          return xray(provider);
        }
      }
    });
    assert.equal(result.ok, true);
    assert.equal(scriptsEvaluated, 1);
    assert.equal(fs.existsSync(reportPath), true);
    assert.equal(fs.existsSync(result.tracePath), true);
    const combined = fs.readFileSync(reportPath, 'utf8') + fs.readFileSync(result.tracePath, 'utf8');
    assert.equal(combined.includes('secret-token'), false);
    assert.equal(combined.includes('secret-session'), false);
    assert.match(combined, /promptSent": false/);
  }

  {
    const { reportPath, traceDir } = tempPaths();
    const result = await runDoctor({
      argv: ['claude'],
      reportPath,
      traceDir,
      electronDoctor: async () => {
        throw new Error('doctor should not launch for forbidden provider');
      }
    });
    assert.equal(result.status, 'BLOCKED_PROVIDER_FORBIDDEN');
    assert.equal(fs.existsSync(reportPath), true);
    assert.equal(fs.existsSync(result.tracePath), true);
  }

  console.log('PASS selector doctor: provider allowlist, safe xray, redaction, and no-send behavior are covered offline');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
