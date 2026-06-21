'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ProviderWindowManager } = require('../src/electron/provider-window-manager');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../src/providers/webview-provider-adapter');
const {
  FORBIDDEN_LIVE_PROVIDERS,
  LIVE_PROVIDER_ALLOWLIST,
  assertProviderContract,
  liveProviderStatus
} = require('../src/providers/provider-contract');
const {
  FORBIDDEN_PROVIDER_MESSAGE,
  assertProviderLiveAllowed,
  loadProviderSessionPolicy,
  resolveProviderSessionPolicy
} = require('../src/providers/provider-session-policy');

const root = path.resolve(__dirname, '..');
const DEFAULT_SELECTOR_REPORT_PATH = path.join(root, 'docs', 'LIVE_PREP_3_SELECTOR_VERIFICATION.md');
const DEFAULT_TRACE_DIR = path.join(root, 'traces', 'selector-doctor');
const SAFE_PROVIDERS = new Set(LIVE_PROVIDER_ALLOWLIST);
const FORBIDDEN_PROVIDERS = new Set(FORBIDDEN_LIVE_PROVIDERS);
const SAFE_DOCTOR_COMMAND = 'npm run doctor:provider -- qwen';
// Human-gate env vars: the doctor opens a real, logged-in provider page, so a
// human must explicitly opt in — mirroring smoke-one-provider.js.
const LIVE_ENV = 'AI_TEAM_V3_LIVE';
const CONFIRM_ENV = 'AI_TEAM_V3_CONFIRM_SAFE_SESSION';
const SECRET_PATTERNS = [
  /(authorization|cookie|set-cookie)\s*[:=]\s*[^\s\n]+/gi,
  /(bearer)\s+[a-z0-9._~+/=-]+/gi,
  /((access|refresh|id)?_?token|secret|api[_-]?key|session|account[_-]?id|email)\s*[:=]\s*[^\s\n&]+/gi,
  /([?&#](?:access_token|id_token|refresh_token|token|session|code|state|account_id|email)=)[^&#\s]+/gi
];

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function redactSensitiveText(value) {
  let text = String(value || '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '$1[REDACTED]');
  }
  return text;
}

function sanitizeUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_error) {
    return '[unavailable]';
  }
}

function providerFromArg(argv = process.argv.slice(2)) {
  return String(argv[0] || '').trim().toLowerCase();
}

function validateProvider(providerId) {
  const sessionPolicy = resolveProviderSessionPolicy(providerId);
  if (sessionPolicy.forbidden) {
    return {
      ok: false,
      providerId,
      status: 'BLOCKED_PROVIDER_FORBIDDEN',
      message: FORBIDDEN_PROVIDER_MESSAGE
    };
  }
  const liveStatus = liveProviderStatus(providerId);
  if (liveStatus !== 'READY_FOR_PROVIDER_DOCTOR') {
    return {
      ok: false,
      providerId,
      status: liveStatus,
    message: `Selector Doctor refuses provider "${providerId || '(missing)'}". Use qwen or kimi only.`
    };
  }
  try {
    assertProviderContract(DEFAULT_PROVIDER_DEFINITIONS[providerId]);
  } catch (error) {
    return {
      ok: false,
      providerId,
      status: 'BLOCKED_CONTRACT_INVALID',
      message: error.message
    };
  }
  return {
    ok: true,
    providerId,
    provider: DEFAULT_PROVIDER_DEFINITIONS[providerId]
  };
}

function selectorSummaryValue(entries, field = 'count') {
  return (entries || []).reduce((sum, entry) => sum + Number(entry[field] || 0), 0);
}

function classifySelectorVerification(provider, xray) {
  const selectorCounts = xray.selectorCounts || {};
  const inputCount = selectorSummaryValue(selectorCounts.inputSelectors);
  const actionableInputCount = selectorSummaryValue(selectorCounts.inputSelectors, 'actionableCount');
  const sendCount = selectorSummaryValue(selectorCounts.sendSelectors);
  const actionableSendCount = selectorSummaryValue(selectorCounts.sendSelectors, 'actionableCount');
  const responseSelectorCount = selectorSummaryValue(selectorCounts.responseSelectors);
  const thinkingCount = selectorSummaryValue(selectorCounts.thinkingSelectors);
  const errorCount = selectorSummaryValue(selectorCounts.errorSelectors);
  const limitCount = selectorSummaryValue(selectorCounts.limitSelectors) + selectorSummaryValue(selectorCounts.rateLimitSelectors) + Number(xray.textSignals && xray.textSignals.limitCount || 0);
  const challengeCount = selectorSummaryValue(selectorCounts.challengeSelectors) + Number(xray.textSignals && xray.textSignals.challengeCount || 0);
  const loginHintCount = selectorSummaryValue(selectorCounts.loginWallSelectors) + Number(xray.textSignals && xray.textSignals.loginHintCount || 0);
  const paidWallCount = selectorSummaryValue(selectorCounts.paidWallSelectors) + Number(xray.textSignals && xray.textSignals.paidWallCount || 0);
  const responseCount = Number(xray.responseCountSelector && xray.responseCountSelector.count || 0);
  const pageLoaded = xray.readyState === 'interactive' || xray.readyState === 'complete';
  const enterSendAvailable = actionableInputCount > 0;
  const sendPathAvailable = actionableSendCount > 0 || enterSendAvailable;
  // Login-wall detection. Two independent strong signals; either one blocks the smoke:
  //   1. A login/sign-in URL path (e.g. deepseek /sign_in).
  //   2. Any login-text/selector hit (loginHintCount > 0). Empirically, genuinely
  //      logged-in providers (qwen/kimi/perplexity/grok) report loginHintCount === 0,
  //      while logged-out ones (deepseek, z.ai) report > 0 even though their login
  //      page still exposes actionable inputs (OAuth buttons). The previous
  //      `actionableInputCount === 0` guard let those pages slip through as READY.
  const observedUrl = sanitizeUrl(xray.url);
  const urlLoginWall = /\/(sign[_-]?in|log[_-]?in|signin|login|auth(?:enticate)?)(\/|$|\?)/i.test(observedUrl);
  const loginWall = urlLoginWall || loginHintCount > 0;
  const appearsUsable = pageLoaded && actionableInputCount > 0 && !loginWall && challengeCount === 0 && limitCount === 0 && paidWallCount === 0;
  let code = 'READY';
  let smokeCanProceed = true;

  if (!pageLoaded) {
    code = 'PAGE_NOT_LOADED';
    smokeCanProceed = false;
  } else if (challengeCount > 0) {
    code = 'PROVIDER_CHALLENGE';
    smokeCanProceed = false;
  } else if (limitCount > 0) {
    code = 'PROVIDER_LIMIT';
    smokeCanProceed = false;
  } else if (paidWallCount > 0) {
    code = 'PROVIDER_PAID_WALL';
    smokeCanProceed = false;
  } else if (loginWall) {
    code = 'PROVIDER_LOGIN_WALL';
    smokeCanProceed = false;
  } else if (actionableInputCount === 0) {
    code = 'COMPOSER_NOT_ACTIONABLE';
    smokeCanProceed = false;
  } else if (!sendPathAvailable) {
    code = 'SEND_PATH_NOT_FOUND';
    smokeCanProceed = false;
  }

  return {
    providerId: provider.id,
    urlObserved: observedUrl,
    pageLoaded,
    urlLoginWall,
    inputCount,
    actionableInputCount,
    sendCount,
    actionableSendCount,
    enterSendAvailable,
    responseSelectorCount,
    responseCount,
    thinkingCount,
    errorCount,
    limitCount,
    challengeCount,
    loginHintCount,
    paidWallCount,
    appearsUsable,
    sendPathAvailable,
    smokeCanProceed,
    code
  };
}

function selectorRows(entries) {
  if (!entries || entries.length === 0) {
    return '| (none) | 0 | 0 |  |\n';
  }
  return entries.map((entry) => {
    const error = entry.error ? redactSensitiveText(entry.error) : '';
    return `| \`${entry.selector}\` | ${entry.count || 0} | ${entry.actionableCount || 0} | ${error} |`;
  }).join('\n');
}

function writeSelectorVerificationReport({
  provider,
  xray,
  summary,
  reportPath = DEFAULT_SELECTOR_REPORT_PATH
}) {
  ensureParentDir(reportPath);
  const selectorCounts = xray.selectorCounts || {};
  const body = [
    '# LIVE_PREP_3 — Selector Verification',
    '',
    `Status: ${summary.smokeCanProceed ? 'READY_FOR_ONE_PROVIDER_SMOKE' : 'BLOCKED'}`,
    `Provider tested: ${provider.id}`,
    `URL observed: ${summary.urlObserved}`,
    `Document ready state: ${xray.readyState || '[unknown]'}`,
    '',
    '## Summary',
    '',
    `- Input selector result: ${summary.inputCount} found, ${summary.actionableInputCount} actionable`,
    `- Send selector result: ${summary.sendCount} found, ${summary.actionableSendCount} actionable (${summary.enterSendAvailable ? 'Enter fallback available' : 'no Enter fallback'})`,
    `- Response selector result: ${summary.responseSelectorCount}`,
    `- Response count selector result: ${summary.responseCount}`,
    `- Thinking/loading selector result: ${summary.thinkingCount}`,
    `- Challenge detection result: ${summary.challengeCount}`,
    `- Limit detection result: ${summary.limitCount}`,
    `- Login wall detection result: ${summary.loginHintCount}`,
    `- Paid wall detection result: ${summary.paidWallCount}`,
    `- Provider appears logged in or usable: ${summary.appearsUsable ? 'yes' : 'no'}`,
    `- Smoke can proceed: ${summary.smokeCanProceed ? 'yes' : 'no'} (${summary.code})`,
    '',
    '## Input Selectors',
    '',
    '| Selector | Count | Actionable | Error |',
    '|---|---:|---:|---|',
    selectorRows(selectorCounts.inputSelectors),
    '',
    '## Send Selectors',
    '',
    '| Selector | Count | Actionable | Error |',
    '|---|---:|---:|---|',
    selectorRows(selectorCounts.sendSelectors),
    '',
    '## Response Selectors',
    '',
    '| Selector | Count | Actionable | Error |',
    '|---|---:|---:|---|',
    selectorRows(selectorCounts.responseSelectors),
    '',
    '## Thinking / Loading Selectors',
    '',
    '| Selector | Count | Actionable | Error |',
    '|---|---:|---:|---|',
    selectorRows(selectorCounts.thinkingSelectors),
    '',
    '## Challenge / Limit Selectors',
    '',
    '| Selector | Count | Actionable | Error |',
    '|---|---:|---:|---|',
    selectorRows([...(selectorCounts.challengeSelectors || []), ...(selectorCounts.limitSelectors || []), ...(selectorCounts.rateLimitSelectors || [])]),
    '',
    '## Login / Paid Wall Selectors',
    '',
    '| Selector | Count | Actionable | Error |',
    '|---|---:|---:|---|',
    selectorRows([...(selectorCounts.loginWallSelectors || []), ...(selectorCounts.paidWallSelectors || [])]),
    '',
    '## Safe Commands',
    '',
    '```powershell',
    SAFE_DOCTOR_COMMAND,
    "$env:AI_TEAM_V3_LIVE='1'",
    "$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'",
    "$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'",
    'npm run smoke:one-provider',
    '```',
    '',
    'No cookies, tokens, headers, account identifiers, emails, query secrets, prompt text, or page body text were written to this report.'
  ].join('\n');
  fs.writeFileSync(reportPath, redactSensitiveText(body), 'utf8');
}

function traceFileName(providerId, code, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${providerId}-${code}.json`;
}

function writeSelectorTraceArtifact({
  provider,
  xray,
  summary,
  traceDir = DEFAULT_TRACE_DIR
}) {
  fs.mkdirSync(traceDir, { recursive: true });
  const artifact = {
    kind: 'selector-doctor',
    providerId: provider.id,
    createdAt: new Date().toISOString(),
    urlObserved: summary.urlObserved,
    readyState: xray.readyState,
    summary,
    selectorCounts: xray.selectorCounts || {},
    responseCountSelector: xray.responseCountSelector || {},
    textSignals: xray.textSignals || {},
    safety: {
      bodyTextStored: false,
      cookiesStored: false,
      headersStored: false,
      tokensStored: false,
      accountDataStored: false,
      promptSent: false
    }
  };
  const filePath = path.join(traceDir, traceFileName(provider.id, summary.code));
  fs.writeFileSync(filePath, redactSensitiveText(JSON.stringify(artifact, null, 2)), 'utf8');
  return filePath;
}

function doctorTimeoutMs(env = process.env) {
  // Allow a longer window so a human can finish a manual login in the visible
  // window before the doctor inspects selectors. Defaults to 30s; set
  // AI_TEAM_V3_DOCTOR_TIMEOUT_MS (e.g. 300000 for 5 minutes) to extend.
  const raw = Number(env.AI_TEAM_V3_DOCTOR_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30000;
}

async function waitForPageReady(webContents, { timeoutMs = doctorTimeoutMs(), pollMs = 250 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await webContents.executeJavaScript('document.readyState');
    if (state === 'interactive' || state === 'complete') {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('Timed out waiting for provider page readiness.');
}

/**
 * Poll until an actionable input appears (i.e. the human has finished logging
 * in and the composer is usable) or the timeout elapses. Returns true if an
 * input became actionable. Does NOT send anything — observation only.
 */
async function waitForActionableInput(webContents, provider, { timeoutMs = doctorTimeoutMs(), pollMs = 1000 } = {}) {
  const startedAt = Date.now();
  const selectors = JSON.stringify(provider.inputSelectors || []);
  while (Date.now() - startedAt < timeoutMs) {
    const actionable = await webContents.executeJavaScript(`(() => {
      const sels = ${selectors};
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          const style = window.getComputedStyle(el);
          const visible = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
          const enabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';
          if (visible && enabled) return true;
        }
      }
      return false;
    })()`).catch(() => false);
    if (actionable) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

async function verifyProviderSelectors({ provider, webContents }) {
  return webContents.executeJavaScript(`
    (() => {
      const provider = ${JSON.stringify(provider)};
      const textSelectorPattern = /^text=\\/(.*)\\/([a-z]*)$/i;
      const isVisible = (node) => {
        if (!node || !node.getClientRects || node.getClientRects().length === 0) return false;
        const style = window.getComputedStyle(node);
        return style && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
      };
      const isEnabled = (node) => {
        if (!node) return false;
        if (node.disabled) return false;
        if (node.getAttribute && node.getAttribute('aria-disabled') === 'true') return false;
        return true;
      };
      const isEditable = (node) => {
        if (!node) return false;
        if (node.isContentEditable) return true;
        const tag = String(node.tagName || '').toLowerCase();
        return tag === 'textarea' || (tag === 'input' && !/button|submit|checkbox|radio|hidden/i.test(node.type || ''));
      };
      const textCount = (selector) => {
        const match = String(selector).match(textSelectorPattern);
        if (!match) return null;
        try {
          const pattern = new RegExp(match[1], match[2] || 'i');
          return pattern.test(document.body && document.body.innerText || '') ? 1 : 0;
        } catch (error) {
          return { count: 0, actionableCount: 0, error: error.message };
        }
      };
      const countSelector = (selector, group) => {
        const textResult = textCount(selector);
        if (textResult && typeof textResult === 'object') return textResult;
        if (typeof textResult === 'number') return { count: textResult, actionableCount: textResult };
        try {
          const nodes = Array.from(document.querySelectorAll(selector));
          const actionableCount = nodes.filter((node) => {
            if (!isVisible(node) || !isEnabled(node)) return false;
            if (group === 'inputSelectors') return isEditable(node);
            return true;
          }).length;
          return { count: nodes.length, actionableCount };
        } catch (error) {
          return { count: 0, actionableCount: 0, error: error.message };
        }
      };
      const countList = (group, selectors) => (selectors || []).map((selector) => ({
        selector,
        ...countSelector(selector, group)
      }));
      const bodyText = document.body && document.body.innerText || '';
      const responseCount = provider.responseCountSelector ? countSelector(provider.responseCountSelector, 'responseCountSelector') : { count: 0, actionableCount: 0 };
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        responseCountSelector: {
          selector: provider.responseCountSelector || '',
          ...responseCount
        },
        selectorCounts: {
          inputSelectors: countList('inputSelectors', provider.inputSelectors),
          sendSelectors: countList('sendSelectors', provider.sendSelectors),
          responseSelectors: countList('responseSelectors', provider.responseSelectors),
          thinkingSelectors: countList('thinkingSelectors', provider.thinkingSelectors),
          errorSelectors: countList('errorSelectors', provider.errorSelectors),
          limitSelectors: countList('limitSelectors', provider.limitSelectors),
          rateLimitSelectors: countList('rateLimitSelectors', provider.rateLimitSelectors),
          challengeSelectors: countList('challengeSelectors', provider.challengeSelectors),
          loginWallSelectors: countList('loginWallSelectors', provider.loginWallSelectors),
          paidWallSelectors: countList('paidWallSelectors', provider.paidWallSelectors)
        },
        textSignals: {
          challengeCount: /captcha|cloudflare|verify you are human|checking your browser|security check/i.test(bodyText) ? 1 : 0,
          limitCount: /message limit|usage limit|quota|too many requests|rate limit/i.test(bodyText) ? 1 : 0,
          loginHintCount: /log in|sign in|continue with google|continue with apple/i.test(bodyText) ? 1 : 0,
          paidWallCount: /upgrade|subscribe|payment required|paid plan/i.test(bodyText) ? 1 : 0
        }
      };
    })();
  `);
}

async function runSelectorDoctorForWebContents({
  provider,
  webContents,
  reportPath = DEFAULT_SELECTOR_REPORT_PATH,
  traceDir = DEFAULT_TRACE_DIR,
  waitForComposer = true
}) {
  // SPA providers (e.g. grok) render their composer asynchronously after page load.
  // Wait for an actionable input here so EVERY caller (doctor AND the smoke driver)
  // sees a settled DOM; otherwise a snapshot races an empty SPA shell and falsely
  // reports COMPOSER_NOT_ACTIONABLE. Skipped when webContents can't execute JS (tests).
  if (waitForComposer && webContents && typeof webContents.executeJavaScript === 'function') {
    try {
      await waitForActionableInput(webContents, provider);
    } catch (_error) {
      // Fall through to the xray; classification will report the real blocked state.
    }
  }
  const xray = await verifyProviderSelectors({ provider, webContents });
  const summary = classifySelectorVerification(provider, xray);
  writeSelectorVerificationReport({ provider, xray, summary, reportPath });
  const tracePath = writeSelectorTraceArtifact({ provider, xray, summary, traceDir });
  return {
    ok: summary.smokeCanProceed,
    status: summary.smokeCanProceed ? 'READY_FOR_ONE_PROVIDER_SMOKE' : 'BLOCKED',
    providerId: provider.id,
    summary,
    tracePath,
    exitCode: summary.smokeCanProceed ? 0 : 1
  };
}

async function runElectronDoctor({
  providerId,
  reportPath = DEFAULT_SELECTOR_REPORT_PATH,
  traceDir = DEFAULT_TRACE_DIR
}) {
  const { app, BrowserWindow } = require('electron');
  const provider = DEFAULT_PROVIDER_DEFINITIONS[providerId];
  const sessionPolicy = loadProviderSessionPolicy();
  assertProviderLiveAllowed(providerId, { policy: sessionPolicy });
  await app.whenReady();
  const hostWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      backgroundThrottling: false
    }
  });
  const providerWindowManager = new ProviderWindowManager({
    hostWindow,
    providerDefinitions: DEFAULT_PROVIDER_DEFINITIONS,
    sessionPolicy
  });

  try {
    await providerWindowManager.openProvider(providerId);
    const webContents = providerWindowManager.getWebContents(providerId);
    await waitForPageReady(webContents);
    // runSelectorDoctorForWebContents waits for an actionable composer internally
    // (giving the human time to complete a manual login in the visible window).
    // Observation only — nothing is typed or sent.
    const result = await runSelectorDoctorForWebContents({
      provider,
      webContents,
      reportPath,
      traceDir
    });
    app.quit();
    return result;
  } catch (error) {
    const summary = {
      providerId,
      urlObserved: '[unavailable]',
      smokeCanProceed: false,
      code: 'DOCTOR_FAILED',
      message: redactSensitiveText(error.message)
    };
    writeSelectorVerificationReport({
      provider,
      xray: { readyState: '[unknown]', selectorCounts: {}, textSignals: {} },
      summary,
      reportPath
    });
    const tracePath = writeSelectorTraceArtifact({
      provider,
      xray: { readyState: '[unknown]', selectorCounts: {}, textSignals: {} },
      summary,
      traceDir
    });
    app.quit();
    return {
      ok: false,
      status: 'BLOCKED',
      providerId,
      summary,
      tracePath,
      exitCode: 1
    };
  }
}

async function runDoctor({
  argv = process.argv.slice(2),
  reportPath = process.env.AI_TEAM_V3_SELECTOR_REPORT || DEFAULT_SELECTOR_REPORT_PATH,
  traceDir = process.env.AI_TEAM_V3_SELECTOR_TRACE_DIR || DEFAULT_TRACE_DIR,
  electronDoctor = runElectronDoctor,
  env = process.env
} = {}) {
  const providerId = providerFromArg(argv);
  const validation = validateProvider(providerId);
  if (!validation.ok) {
    const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
    const summary = {
      providerId,
      urlObserved: '[unavailable]',
      smokeCanProceed: false,
      code: validation.status,
      message: validation.message
    };
    writeSelectorVerificationReport({
      provider,
      xray: { readyState: '[not-run]', selectorCounts: {}, textSignals: {} },
      summary,
      reportPath
    });
    const tracePath = writeSelectorTraceArtifact({
      provider,
      xray: { readyState: '[not-run]', selectorCounts: {}, textSignals: {} },
      summary,
      traceDir
    });
    return {
      ok: false,
      status: validation.status,
      providerId,
      summary,
      tracePath,
      exitCode: 1
    };
  }

  // Human safety gate: the provider is allowed, but opening a real logged-in
  // page still requires explicit human opt-in via both env vars. Without them
  // we refuse to launch — the same gate smoke-one-provider.js enforces.
  if (env[LIVE_ENV] !== '1' || env[CONFIRM_ENV] !== '1') {
    const provider = DEFAULT_PROVIDER_DEFINITIONS[providerId];
    const summary = {
      providerId,
      urlObserved: '[not-run]',
      smokeCanProceed: false,
      code: 'BLOCKED_SAFE_SESSION_REQUIRED',
      message: `Refused to open ${providerId}. A human must opt in by setting ${LIVE_ENV}=1 and ${CONFIRM_ENV}=1 after confirming a safe logged-in session.`
    };
    writeSelectorVerificationReport({
      provider,
      xray: { readyState: '[not-run]', selectorCounts: {}, textSignals: {} },
      summary,
      reportPath
    });
    const tracePath = writeSelectorTraceArtifact({
      provider,
      xray: { readyState: '[not-run]', selectorCounts: {}, textSignals: {} },
      summary,
      traceDir
    });
    return {
      ok: false,
      status: 'BLOCKED_SAFE_SESSION_REQUIRED',
      providerId,
      summary,
      tracePath,
      exitCode: 1
    };
  }

  return electronDoctor({
    providerId,
    reportPath,
    traceDir
  });
}

module.exports = {
  DEFAULT_SELECTOR_REPORT_PATH,
  DEFAULT_TRACE_DIR,
  FORBIDDEN_PROVIDERS,
  SAFE_DOCTOR_COMMAND,
  SAFE_PROVIDERS,
  classifySelectorVerification,
  providerFromArg,
  redactSensitiveText,
  runDoctor,
  runElectronDoctor,
  runSelectorDoctorForWebContents,
  sanitizeUrl,
  validateProvider,
  verifyProviderSelectors,
  waitForPageReady,
  writeSelectorTraceArtifact,
  writeSelectorVerificationReport
};
