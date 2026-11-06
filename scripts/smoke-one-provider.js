'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { DiagnosticsStore } = require('../src/core/diagnostics-store');
const { TranscriptStore } = require('../src/core/transcript-store');
const { normalizeResponseCandidate } = require('../src/core/response-normalizer');
const { SendController } = require('../src/electron/send-controller');
const { DomCapture } = require('../src/electron/dom-capture');
const { LifecycleMonitor } = require('../src/electron/lifecycle-monitor');
const { ProviderWindowManager } = require('../src/electron/provider-window-manager');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../src/providers/webview-provider-adapter');
const {
  assertProviderContract,
  liveProviderStatus,
  LIVE_PROVIDER_ALLOWLIST,
  FORBIDDEN_LIVE_PROVIDERS
} = require('../src/providers/provider-contract');
const {
  FORBIDDEN_PROVIDER_MESSAGE,
  assertProviderLiveAllowed,
  loadProviderSessionPolicy,
  resolveProviderSessionPolicy
} = require('../src/providers/provider-session-policy');
const selectorDoctor = require('./selector-doctor');

const root = path.resolve(__dirname, '..');
const DEFAULT_REPORT_PATH = path.join(root, 'docs', 'ONE_PROVIDER_REPORT.md');
const DEFAULT_SELECTOR_REPORT_PATH = path.join(root, 'docs', 'LIVE_PREP_3_SELECTOR_VERIFICATION.md');
const DEFAULT_SMOKE_TRACE_DIR = path.join(root, 'traces', 'smoke-one-provider');
// Single source of truth: the live allow/forbid lists live in provider-contract.js.
// Current phase is intentionally restricted to qwen/kimi until the human records a
// new live-provider expansion decision.
const SAFE_PROVIDERS = new Set(LIVE_PROVIDER_ALLOWLIST);
const FORBIDDEN_PROVIDERS = new Set(FORBIDDEN_LIVE_PROVIDERS);
const CONFIRM_ENV = 'AI_TEAM_V3_CONFIRM_SAFE_SESSION';
const SMOKE_SENTINEL = 'AI_TEAM_V3_SMOKE_OK';
// Per-run nonce so a cached/previous answer that already contains the base sentinel
// cannot satisfy this run. The reply must echo the UNIQUE token generated below.
function makeSmokeNonce() {
  const rand = require('node:crypto').randomBytes(4).toString('hex').toUpperCase();
  return `${SMOKE_SENTINEL}_${rand}`;
}
function livePromptFor(sentinel) {
  return `AI Team V3 one-provider smoke test. Reply with exactly: ${sentinel}`;
}
const LIVE_PROMPT = livePromptFor(SMOKE_SENTINEL);
const SAFE_COMMAND = [
  "$env:AI_TEAM_V3_LIVE='1'",
  "$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'",
  "$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'",
  'npm run smoke:one-provider'
].join('\n');

const { redactSensitiveText, redactSensitiveValue } = require('../src/core/redact');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}


function sanitizeUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_error) {
    return '[unavailable]';
  }
}

function safeJson(value) {
  return JSON.stringify(redactSensitiveValue(value), null, 2);
}

function writeOneProviderReport(status, details, {
  providerId = '',
  reportPath = DEFAULT_REPORT_PATH
} = {}) {
  ensureParentDir(reportPath);
  const body = [
    '# One Provider Report',
    '',
    `Status: ${status}`,
    providerId ? `Provider: ${providerId}` : '',
    '',
    redactSensitiveText(details),
    '',
    'Safe PowerShell command:',
    '',
    '```powershell',
    SAFE_COMMAND,
    '```',
    '',
    'Safety constraints:',
    '- Only qwen or kimi may be used for first one-provider live validation.',
    '- Claude, ChatGPT, and Perplexity are not allowed for live testing by human instruction.',
    '- Stop safely on CAPTCHA, Cloudflare, account limit, rate limit, login wall, or paid access wall.',
    '- Do not log cookies, tokens, secrets, Authorization headers, or account data.'
  ].filter(Boolean).join('\n');
  fs.writeFileSync(reportPath, body, 'utf8');
}

function providerFromEnv(env) {
  return String(env.AI_TEAM_V3_LIVE_PROVIDER || '').trim().toLowerCase();
}

// Streamed responses can take well over the 60s lifecycle default. Configurable via
// AI_TEAM_V3_RESPONSE_TIMEOUT_MS (mirrors the doctor timeout knob); default 120s.
function smokeResponseTimeoutMs(env = process.env) {
  const raw = Number(env.AI_TEAM_V3_RESPONSE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120000;
}

function validateSmokeEnv(env = process.env) {
  const liveEnabled = env.AI_TEAM_V3_LIVE === '1';
  const providerId = providerFromEnv(env);
  if (!liveEnabled) {
    return {
      ok: false,
      status: 'NOT_RUN',
      exitCode: 0,
      providerId,
      details: 'Live provider validation was intentionally not run. Set the required environment variables after a human confirms a safe logged-in qwen session.'
    };
  }

  if (!SAFE_PROVIDERS.has(providerId)) {
    const sessionPolicy = resolveProviderSessionPolicy(providerId);
    if (sessionPolicy.forbidden) {
      return {
        ok: false,
        status: 'BLOCKED_PROVIDER_FORBIDDEN',
        exitCode: 1,
        providerId,
        details: FORBIDDEN_PROVIDER_MESSAGE
      };
    }
    const liveStatus = liveProviderStatus(providerId);
    return {
      ok: false,
      status: liveStatus,
      exitCode: 1,
      providerId,
      details: `Refused live provider "${providerId || '(missing)'}". Allowed: ${[...SAFE_PROVIDERS].join(', ')}. Forbidden: ${[...FORBIDDEN_PROVIDERS].join(', ')}.`
    };
  }

  try {
    assertProviderContract(DEFAULT_PROVIDER_DEFINITIONS[providerId]);
  } catch (error) {
    return {
      ok: false,
      status: 'BLOCKED_CONTRACT_INVALID',
      exitCode: 1,
      providerId,
      details: error.message
    };
  }

  if (env[CONFIRM_ENV] !== '1') {
    return {
      ok: false,
      status: 'BLOCKED_SAFE_SESSION_REQUIRED',
      exitCode: 1,
      providerId,
      details: `Refused to drive ${providerId}. A human must confirm a safe logged-in provider session by setting ${CONFIRM_ENV}=1.`
    };
  }

  return {
    ok: true,
    providerId,
    exitCode: 0
  };
}

// Single source of truth: delegate to the selector doctor's classifier so the smoke
// path uses the SAME login-wall / actionable logic (URL-path or any loginHint blocks a
// login wall even when an OAuth button is actionable). A stale local copy here once
// used the weaker `loginHintCount>0 && inputCount===0` rule and could proceed on a
// real login wall.
const classifySelectorVerification = selectorDoctor.classifySelectorVerification;

function selectorRows(entries) {
  if (!entries || entries.length === 0) {
    return '| (none) | 0 |  |\n';
  }
  return entries.map((entry) => {
    const error = entry.error ? redactSensitiveText(entry.error) : '';
    return `| \`${entry.selector}\` | ${entry.count || 0} | ${error} |`;
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
    `URL observed: ${sanitizeUrl(summary.urlObserved)}`,
    `Document ready state: ${xray.readyState || '[unknown]'}`,
    '',
    '## Summary',
    '',
    `- Input selector result: ${summary.inputCount}`,
    `- Send selector result: ${summary.sendCount} (${summary.enterSendAvailable ? 'Enter fallback available' : 'no Enter fallback'})`,
    `- Response selector result: ${summary.responseSelectorCount}`,
    `- Response count selector result: ${summary.responseCount}`,
    `- Thinking selector result: ${summary.thinkingCount}`,
    `- Challenge detection result: ${summary.challengeCount}`,
    `- Limit detection result: ${summary.limitCount}`,
    `- Provider appears logged in or usable: ${summary.appearsUsable ? 'yes' : 'no'}`,
    `- Smoke can proceed: ${summary.smokeCanProceed ? 'yes' : 'no'} (${summary.code})`,
    '',
    '## Input Selectors',
    '',
    '| Selector | Count | Error |',
    '|---|---:|---|',
    selectorRows(selectorCounts.inputSelectors),
    '',
    '## Send Selectors',
    '',
    '| Selector | Count | Error |',
    '|---|---:|---|',
    selectorRows(selectorCounts.sendSelectors),
    '',
    '## Response Selectors',
    '',
    '| Selector | Count | Error |',
    '|---|---:|---|',
    selectorRows(selectorCounts.responseSelectors),
    '',
    '## Thinking Selectors',
    '',
    '| Selector | Count | Error |',
    '|---|---:|---|',
    selectorRows(selectorCounts.thinkingSelectors),
    '',
    '## Challenge And Limit Selectors',
    '',
    '| Selector | Count | Error |',
    '|---|---:|---|',
    selectorRows([...(selectorCounts.challengeSelectors || []), ...(selectorCounts.limitSelectors || []), ...(selectorCounts.rateLimitSelectors || [])]),
    '',
    '## Login And Paid Wall Selectors',
    '',
    '| Selector | Count | Error |',
    '|---|---:|---|',
    selectorRows([...(selectorCounts.loginWallSelectors || []), ...(selectorCounts.paidWallSelectors || [])]),
    '',
    '## Safe PowerShell Command',
    '',
    '```powershell',
    SAFE_COMMAND,
    '```',
    '',
    'No cookies, tokens, headers, account identifiers, or body text were written to this report.'
  ].join('\n');
  fs.writeFileSync(reportPath, redactSensitiveText(body), 'utf8');
}

async function verifyProviderSelectors({ provider, webContents }) {
  return webContents.executeJavaScript(`
    (() => {
      const provider = ${JSON.stringify(provider)};
      const textSelectorPattern = /^text=\\/(.*)\\/([a-z]*)$/i;
      const textCount = (selector) => {
        const match = String(selector).match(textSelectorPattern);
        if (!match) return null;
        try {
          const pattern = new RegExp(match[1], match[2] || 'i');
          return pattern.test(document.body && document.body.innerText || '') ? 1 : 0;
        } catch (error) {
          return { count: 0, error: error.message };
        }
      };
      const countSelector = (selector) => {
        const textResult = textCount(selector);
        if (textResult && typeof textResult === 'object') return textResult;
        if (typeof textResult === 'number') return { count: textResult };
        try {
          return { count: document.querySelectorAll(selector).length };
        } catch (error) {
          return { count: 0, error: error.message };
        }
      };
      const countList = (selectors) => (selectors || []).map((selector) => ({
        selector,
        ...countSelector(selector)
      }));
      const bodyText = document.body && document.body.innerText || '';
      const responseCount = provider.responseCountSelector ? countSelector(provider.responseCountSelector) : { count: 0 };
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        responseCountSelector: {
          selector: provider.responseCountSelector || '',
          ...responseCount
        },
        selectorCounts: {
          inputSelectors: countList(provider.inputSelectors),
          sendSelectors: countList(provider.sendSelectors),
          responseSelectors: countList(provider.responseSelectors),
          thinkingSelectors: countList(provider.thinkingSelectors),
          errorSelectors: countList(provider.errorSelectors),
          limitSelectors: countList(provider.limitSelectors),
          rateLimitSelectors: countList(provider.rateLimitSelectors),
          challengeSelectors: countList(provider.challengeSelectors),
          loginWallSelectors: countList(provider.loginWallSelectors),
          paidWallSelectors: countList(provider.paidWallSelectors)
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

async function waitForPageReady(webContents, { timeoutMs = 30000, pollMs = 250 } = {}) {
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

// Report the SPECIFIC blocking reason, not a vague catch-all. A login wall, a rate
// limit, a CAPTCHA, and a paywall are very different problems for the user to act on.
function reportStatusForSelectorCode(code) {
  const map = {
    PROVIDER_LOGIN_WALL: 'BLOCKED_LOGIN_WALL',
    PROVIDER_CHALLENGE: 'BLOCKED_CHALLENGE',
    PROVIDER_LIMIT: 'BLOCKED_RATE_LIMIT',
    PROVIDER_PAID_WALL: 'BLOCKED_PAID_WALL'
  };
  return map[code] || `BLOCKED_${code}`;
}

function smokeTraceFileName(providerId, status, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${providerId}-${status}.json`;
}

function writeSmokeTraceArtifact({
  provider,
  status,
  summary,
  traceDir = DEFAULT_SMOKE_TRACE_DIR,
  sendResult,
  capture,
  normalized,
  diagnostics = [],
  transcript = []
}) {
  fs.mkdirSync(traceDir, { recursive: true });
  const artifact = {
    kind: 'one-provider-smoke',
    runId: `${provider.id}-${Date.now()}`,
    providerId: provider.id,
    createdAt: new Date().toISOString(),
    status,
    selectorSummary: summary ? {
      code: summary.code,
      smokeCanProceed: summary.smokeCanProceed,
      pageLoaded: summary.pageLoaded,
      appearsUsable: summary.appearsUsable,
      inputCount: summary.inputCount,
      sendCount: summary.sendCount,
      responseCount: summary.responseCount,
      challengeCount: summary.challengeCount,
      limitCount: summary.limitCount,
      loginHintCount: summary.loginHintCount,
      paidWallCount: summary.paidWallCount,
      urlObserved: sanitizeUrl(summary.urlObserved)
    } : null,
    send: sendResult ? {
      verified: Boolean(sendResult.verified),
      verifyReason: sendResult.verifyReason,
      baselineResponseCount: sendResult.baselineResponseCount,
      finalResponseCount: sendResult.finalResponseCount
    } : null,
    capture: capture ? {
      selector: capture.selector,
      baselineCount: capture.baselineCount,
      finalCount: capture.finalCount,
      stableMs: capture.stableMs,
      textLength: String(capture.text || '').length
    } : null,
    normalizer: normalized ? {
      ok: Boolean(normalized.ok),
      code: normalized.code,
      textLength: String(normalized.text || '').length
    } : null,
    diagnosticsSummary: diagnostics.map((entry) => ({
      providerId: entry.providerId,
      code: entry.code,
      message: entry.message
    })),
    transcriptCount: transcript.length,
    safety: {
      promptTextStored: false,
      responseTextStored: false,
      cookiesStored: false,
      headersStored: false,
      tokensStored: false,
      accountDataStored: false
    }
  };
  const filePath = path.join(traceDir, smokeTraceFileName(provider.id, status));
  fs.writeFileSync(filePath, safeJson(artifact), 'utf8');
  return filePath;
}

async function executeLiveValidation({
  provider,
  webContents,
  hostWindow = null,
  reportPath = DEFAULT_REPORT_PATH,
  selectorReportPath = DEFAULT_SELECTOR_REPORT_PATH,
  promptText,
  sentinel = makeSmokeNonce(),
  selectorVerification,
  sendController,
  lifecycleMonitor,
  domCapture,
  traceDir = selectorDoctor.DEFAULT_TRACE_DIR,
  smokeTraceDir = DEFAULT_SMOKE_TRACE_DIR,
  diagnosticsStore = new DiagnosticsStore(),
  transcriptStore = new TranscriptStore()
}) {
  // The reply must echo `sentinel`. Real runs pass a per-run nonce; the prompt is
  // derived from it unless the caller supplied an explicit promptText (tests).
  const effectiveSentinel = sentinel || makeSmokeNonce();
  const effectivePromptText = promptText || livePromptFor(effectiveSentinel) || provider.safeFirstPrompt;
  let summary;
  let tracePath;
  if (selectorVerification) {
    const xray = selectorVerification;
    summary = classifySelectorVerification(provider, xray);
    writeSelectorVerificationReport({ provider, xray, summary, reportPath: selectorReportPath });
    tracePath = selectorDoctor.writeSelectorTraceArtifact({ provider, xray, summary, traceDir });
  } else {
    const doctorResult = await selectorDoctor.runSelectorDoctorForWebContents({
      provider,
      webContents,
      reportPath: selectorReportPath,
      traceDir
    });
    summary = doctorResult.summary;
    tracePath = doctorResult.tracePath;
  }

  if (!summary.smokeCanProceed) {
    const status = reportStatusForSelectorCode(summary.code);
    diagnosticsStore.add({
      providerId: provider.id,
      code: summary.code,
      message: `Selector verification blocked ${provider.id} live smoke.`,
      details: summary
    });
    writeOneProviderReport(status, `Selector verification blocked live smoke:\n\n${safeJson(summary)}`, {
      providerId: provider.id,
      reportPath
    });
    const smokeTracePath = writeSmokeTraceArtifact({
      provider,
      status,
      summary,
      traceDir: smokeTraceDir,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    });
    return {
      ok: false,
      status,
      summary,
      tracePath,
      smokeTracePath,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    };
  }

  const effectiveDomCapture = domCapture || new DomCapture({ webContents });
  // Real providers (qwen) can take well over the 6s SendController default to show the first
  // response token, so send-verification (composer-clear OR response-count increment) needs a
  // generous window. Default 30s; override with AI_TEAM_V3_SEND_VERIFY_TIMEOUT_MS.
  const sendVerifyTimeoutMs = (() => {
    const raw = Number(process.env.AI_TEAM_V3_SEND_VERIFY_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 30000;
  })();
  const effectiveSendController = sendController || new SendController({ webContents, diagnosticsStore, hostWindow, verificationTimeoutMs: sendVerifyTimeoutMs });
  const effectiveLifecycleMonitor = lifecycleMonitor || new LifecycleMonitor({ webContents });

  // Snapshot the response area BEFORE sending so any pre-existing answer can't be
  // mistaken for the smoke reply (see lifecycle-monitor baseline handling). Defensive:
  // a substituted dom-capture (tests) may not implement these; fall back to no baseline.
  let baselineCount = null;
  let baselineText = '';
  if (typeof effectiveDomCapture.count === 'function') {
    baselineCount = await effectiveDomCapture.count(provider.responseCountSelector);
  }
  if (typeof effectiveDomCapture.captureLatest === 'function') {
    const baselineCapture = await effectiveDomCapture.captureLatest(provider);
    baselineText = String((baselineCapture && baselineCapture.text) || '');
  }

  const sendResult = await effectiveSendController.sendPrompt({ provider, promptText: effectivePromptText });

  if (!sendResult.verified) {
    const status = 'BLOCKED_SEND_NOT_VERIFIED';
    diagnosticsStore.add({
      providerId: provider.id,
      code: sendResult.code || 'SEND_NOT_VERIFIED',
      message: 'Live smoke send was not verified by composer clear or response count increment.',
      details: sendResult
    });
    writeOneProviderReport(status, `Send verification failed:\n\n${safeJson(sendResult)}`, {
      providerId: provider.id,
      reportPath
    });
    const smokeTracePath = writeSmokeTraceArtifact({
      provider,
      status,
      summary,
      traceDir: smokeTraceDir,
      sendResult,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    });
    return {
      ok: false,
      status,
      summary,
      tracePath,
      smokeTracePath,
      sendResult,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    };
  }

  const capture = await effectiveLifecycleMonitor.waitForStableResponse({
    provider,
    domCapture: effectiveDomCapture,
    baselineCount,
    baselineText,
    timeoutMs: smokeResponseTimeoutMs(),
    context: { smoke: true, prompt: 'redacted' }
  });
  const normalized = normalizeResponseCandidate({
    providerId: provider.id,
    text: capture.text,
    promptText: effectivePromptText,
    transcriptStore
  });

  if (!normalized.ok) {
    const status = normalized.limitDetected || normalized.code === 'PROVIDER_CHALLENGE'
      ? 'BLOCKED_RESPONSE_FIREWALL'
      : 'FAILED_RESPONSE_FIREWALL';
    diagnosticsStore.add({
      providerId: provider.id,
      code: normalized.code,
      message: 'Captured response was rejected by the transcript firewall.',
      details: {
        code: normalized.code,
        textLength: String(capture.text || '').length
      }
    });
    writeOneProviderReport(status, `Response was rejected by transcript firewall: ${normalized.code}`, {
      providerId: provider.id,
      reportPath
    });
    const smokeTracePath = writeSmokeTraceArtifact({
      provider,
      status,
      summary,
      traceDir: smokeTraceDir,
      sendResult,
      capture,
      normalized,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    });
    return {
      ok: false,
      status,
      summary,
      tracePath,
      smokeTracePath,
      sendResult,
      normalized,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    };
  }

  // End-to-end proof: the prompt asks the provider to echo the per-run sentinel, so a
  // real round-trip must contain THIS run's token and must differ from the pre-send
  // baseline text. This rejects clean-but-wrong replies and stale/cached output.
  const normalizedUpper = String(normalized.text || '').toUpperCase();
  const sentinelSeen = normalizedUpper.includes(effectiveSentinel.toUpperCase());
  const differsFromBaseline = String(normalized.text || '').trim() !== String(baselineText || '').trim();
  if (!sentinelSeen || !differsFromBaseline) {
    const status = 'FAILED_SMOKE_SENTINEL_MISMATCH';
    diagnosticsStore.add({
      providerId: provider.id,
      code: 'SMOKE_SENTINEL_MISMATCH',
      message: `Captured response did not contain the smoke sentinel ${SMOKE_SENTINEL}.`,
      details: { responseChars: String(normalized.text || '').length }
    });
    writeOneProviderReport(
      status,
      `Provider replied but the response did not contain the required sentinel "${SMOKE_SENTINEL}". The send/capture round-trip is unproven.`,
      { providerId: provider.id, reportPath }
    );
    const smokeTracePath = writeSmokeTraceArtifact({
      provider,
      status,
      summary,
      traceDir: smokeTraceDir,
      sendResult,
      capture,
      normalized,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    });
    return {
      ok: false,
      status,
      summary,
      tracePath,
      smokeTracePath,
      sendResult,
      normalized,
      diagnostics: diagnosticsStore.list(),
      transcript: transcriptStore.list()
    };
  }

  const transcriptEntry = transcriptStore.appendAIResponse({
    providerId: provider.id,
    providerName: provider.name,
    text: normalized.text,
    meta: {
      smoke: true,
      selector: capture.selector,
      responseChars: normalized.text.length
    }
  });

  writeOneProviderReport(
    'PASS',
    [
      `Provider page loaded: ${summary.pageLoaded}`,
      `Provider appears logged in or usable: ${summary.appearsUsable}`,
      `Input/composer exists: ${summary.inputCount > 0}`,
      `Send verified by: ${sendResult.verifyReason}`,
      `Response captured after stability window: ${capture.stableMs}ms`,
      `Normalizer result: ${normalized.code}`,
      `Transcript turnId: ${transcriptEntry.turnId}`,
      `Diagnostics count: ${diagnosticsStore.list().length}`
    ].join('\n'),
    {
      providerId: provider.id,
      reportPath
    }
  );

  const smokeTracePath = writeSmokeTraceArtifact({
    provider,
    status: 'PASS',
    summary,
    traceDir: smokeTraceDir,
    sendResult,
    capture,
    normalized,
    diagnostics: diagnosticsStore.list(),
    transcript: transcriptStore.list()
  });

  return {
    ok: true,
    status: 'PASS',
    summary,
    tracePath,
    smokeTracePath,
    sendResult,
    capture: {
      selector: capture.selector,
      finalCount: capture.finalCount,
      stableMs: capture.stableMs,
      textLength: String(capture.text || '').length
    },
    normalized: {
      code: normalized.code,
      textLength: normalized.text.length
    },
    diagnostics: diagnosticsStore.list(),
    transcript: transcriptStore.list()
  };
}

async function runElectronDriver({
  providerId,
  reportPath = DEFAULT_REPORT_PATH,
  selectorReportPath = DEFAULT_SELECTOR_REPORT_PATH
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
      // Don't throttle when hidden/occluded — the smoke must capture qwen's streamed
      // response reliably even if the user isn't on screen.
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
    // Raise/focus the host window so a trusted Enter (sendInputEvent) is delivered to
    // the focused provider view — required for Enter-only composers (electron#8273).
    try { hostWindow.show(); hostWindow.focus(); hostWindow.moveTop(); } catch {}
    await waitForPageReady(webContents);
    const result = await executeLiveValidation({
      provider,
      webContents,
      hostWindow,
      reportPath,
      selectorReportPath,
      sentinel: makeSmokeNonce()
    });
    app.quit();
    return {
      status: result.status,
      exitCode: result.ok ? 0 : 1
    };
  } catch (error) {
    writeOneProviderReport('BLOCKED', `Unexpected live smoke failure: ${error.message}`, {
      providerId,
      reportPath
    });
    app.quit();
    return {
      status: 'BLOCKED',
      exitCode: 1,
      error
    };
  }
}

function spawnElectronDriver({
  providerId,
  env = process.env,
  reportPath = DEFAULT_REPORT_PATH,
  selectorReportPath = DEFAULT_SELECTOR_REPORT_PATH
}) {
  const electronPath = require('electron');
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [__filename], {
      env: {
        ...env,
        AI_TEAM_V3_ELECTRON_DRIVER: '1',
        AI_TEAM_V3_ONE_PROVIDER_REPORT: reportPath,
        AI_TEAM_V3_SELECTOR_REPORT: selectorReportPath
      },
      stdio: 'inherit',
      windowsHide: false
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({
      status: code === 0 ? 'PASS' : 'BLOCKED',
      providerId,
      exitCode: code == null ? 1 : code
    }));
  });
}

async function runSmoke({
  env = process.env,
  reportPath = env.AI_TEAM_V3_ONE_PROVIDER_REPORT || DEFAULT_REPORT_PATH,
  selectorReportPath = env.AI_TEAM_V3_SELECTOR_REPORT || DEFAULT_SELECTOR_REPORT_PATH,
  spawnDriver = spawnElectronDriver,
  electronDriver = runElectronDriver
} = {}) {
  const validation = validateSmokeEnv(env);
  if (!validation.ok) {
    writeOneProviderReport(validation.status, validation.details, {
      providerId: validation.providerId,
      reportPath
    });
    return validation;
  }

  if (env.AI_TEAM_V3_ELECTRON_DRIVER === '1' || process.versions.electron) {
    return electronDriver({
      providerId: validation.providerId,
      reportPath,
      selectorReportPath
    });
  }

  return spawnDriver({
    providerId: validation.providerId,
    env,
    reportPath,
    selectorReportPath
  });
}

async function main() {
  const result = await runSmoke();
  console.log('\nSafe PowerShell command:');
  console.log(SAFE_COMMAND);
  process.exitCode = result.exitCode;
}

// Electron entry point: under Electron `require.main === module` is false, so the
// spawned Electron driver child would never call main() and the smoke would exit 0
// (false PASS) without ever touching the provider. Guard on the Electron runtime too.
if ((process.versions && process.versions.electron) || require.main === module) {
  main().catch((error) => {
    writeOneProviderReport('BLOCKED', `Unexpected live smoke failure: ${error.message}`, {
      providerId: providerFromEnv(process.env),
      reportPath: process.env.AI_TEAM_V3_ONE_PROVIDER_REPORT || DEFAULT_REPORT_PATH
    });
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  CONFIRM_ENV,
  SAFE_COMMAND,
  SAFE_PROVIDERS,
  FORBIDDEN_PROVIDERS,
  SMOKE_SENTINEL,
  DEFAULT_SMOKE_TRACE_DIR,
  classifySelectorVerification,
  executeLiveValidation,
  providerFromEnv,
  redactSensitiveText,
  runSmoke,
  sanitizeUrl,
  validateSmokeEnv,
  verifyProviderSelectors,
  writeOneProviderReport,
  writeSmokeTraceArtifact,
  writeSelectorVerificationReport
};
