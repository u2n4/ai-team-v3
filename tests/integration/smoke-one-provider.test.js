'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { assert, makeTempDir } = require('../test-utils');
const { DiagnosticsStore } = require('../../src/core/diagnostics-store');
const { TranscriptStore } = require('../../src/core/transcript-store');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../../src/providers/webview-provider-adapter');
const {
  SAFE_COMMAND,
  SAFE_PROVIDERS,
  FORBIDDEN_PROVIDERS,
  SMOKE_SENTINEL,
  classifySelectorVerification,
  executeLiveValidation,
  runSmoke,
  sanitizeUrl,
  writeSelectorVerificationReport
} = require('../../scripts/smoke-one-provider');

function tempReportPaths() {
  const dir = makeTempDir('ai-team-v3-smoke-');
  return {
    dir,
    reportPath: path.join(dir, 'ONE_PROVIDER_REPORT.md'),
    selectorReportPath: path.join(dir, 'LIVE_PREP_3_SELECTOR_VERIFICATION.md')
  };
}

function readyXray(provider) {
  return {
    url: `${provider.url}?token=must-not-leak#session=must-not-leak`,
    readyState: 'complete',
    responseCountSelector: {
      selector: provider.responseCountSelector,
      count: 0,
      actionableCount: 0
    },
    // The doctor's classifier (now the single source of truth) keys on actionableCount,
    // so a ready xray must expose an actionable composer + send path.
    selectorCounts: {
      inputSelectors: provider.inputSelectors.map((selector, index) => ({ selector, count: index === 0 ? 1 : 0, actionableCount: index === 0 ? 1 : 0 })),
      sendSelectors: provider.sendSelectors.map((selector, index) => ({ selector, count: index === 0 ? 1 : 0, actionableCount: index === 0 ? 1 : 0 })),
      responseSelectors: provider.responseSelectors.map((selector, index) => ({ selector, count: index === 0 ? 1 : 0, actionableCount: 0 })),
      thinkingSelectors: provider.thinkingSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      errorSelectors: provider.errorSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      limitSelectors: provider.limitSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      challengeSelectors: provider.challengeSelectors.map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      rateLimitSelectors: (provider.rateLimitSelectors || []).map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      loginWallSelectors: (provider.loginWallSelectors || []).map((selector) => ({ selector, count: 0, actionableCount: 0 })),
      paidWallSelectors: (provider.paidWallSelectors || []).map((selector) => ({ selector, count: 0, actionableCount: 0 }))
    },
    textSignals: {
      challengeCount: 0,
      limitCount: 0,
      loginHintCount: 0
    }
  };
}

async function assertNoSpawn(resultPromise) {
  return resultPromise({
    spawnDriver: async () => {
      throw new Error('spawnDriver should not be called');
    }
  });
}

async function run() {
  {
    const { reportPath, selectorReportPath, dir } = tempReportPaths();
    const result = await assertNoSpawn((options) => runSmoke({
      ...options,
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_LIVE_PROVIDER: 'qwen'
      },
      reportPath,
      selectorReportPath
    }));
    assert.equal(result.status, 'BLOCKED_SAFE_SESSION_REQUIRED');
    assert.match(fs.readFileSync(reportPath, 'utf8'), /AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'/);
  }

  // ChatGPT/Claude are forbidden before page open and must report BLOCKED_PROVIDER_FORBIDDEN.
  for (const forbiddenProvider of ['chatgpt', 'claude', 'gemini']) {
    const { reportPath, selectorReportPath } = tempReportPaths();
    const result = await assertNoSpawn((options) => runSmoke({
      ...options,
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_LIVE_PROVIDER: forbiddenProvider,
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1'
      },
      reportPath,
      selectorReportPath
    }));
    assert.equal(result.status, 'BLOCKED_PROVIDER_FORBIDDEN');
    assert.match(fs.readFileSync(reportPath, 'utf8'), /ChatGPT\/Claude\/Gemini live is disabled/);
  }

  // gemini/perplexity are now live-allowed at the room level, but the one-provider SMOKE
  // gate stays limited to qwen/kimi — they must still be refused here (not forbidden, but
  // outside the smoke allowlist), and must never spawn a live process.
  for (const wideProvider of ['perplexity']) {
    const { reportPath, selectorReportPath } = tempReportPaths();
    const result = await assertNoSpawn((options) => runSmoke({
      ...options,
      env: {
        AI_TEAM_V3_LIVE: '1',
        AI_TEAM_V3_LIVE_PROVIDER: wideProvider,
        AI_TEAM_V3_CONFIRM_SAFE_SESSION: '1'
      },
      reportPath,
      selectorReportPath
    }));
    assert.equal(result.status === 'BLOCKED_PROVIDER_FORBIDDEN', false);
    assert.match(String(result.status), /BLOCKED/);
  }

  {
    assert.equal(sanitizeUrl('https://chat.qwen.ai/?token=abc123#access_token=def456'), 'https://chat.qwen.ai/');
    const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
    const { selectorReportPath } = tempReportPaths();
    const xray = readyXray(provider);
    const summary = classifySelectorVerification(provider, xray);
    writeSelectorVerificationReport({ provider, xray, summary, reportPath: selectorReportPath });
    const report = fs.readFileSync(selectorReportPath, 'utf8');
    assert.equal(report.includes('abc123'), false);
    assert.equal(report.includes('def456'), false);
    assert.equal(/Cookie:\s*\S/i.test(report), false);
    assert.match(report, /No cookies, tokens, headers/);
  }

  {
    const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
    const xray = readyXray(provider);
    xray.selectorCounts.challengeSelectors[0].count = 1;
    const summary = classifySelectorVerification(provider, xray);
    assert.equal(summary.smokeCanProceed, false);
    assert.equal(summary.code, 'PROVIDER_CHALLENGE');
  }

  {
    const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
    const xray = readyXray(provider);
    xray.textSignals.limitCount = 1;
    const summary = classifySelectorVerification(provider, xray);
    assert.equal(summary.smokeCanProceed, false);
    assert.equal(summary.code, 'PROVIDER_LIMIT');
  }

  {
    const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
    const { reportPath, selectorReportPath, dir } = tempReportPaths();
    let observedStableMs = null;
    const diagnosticsStore = new DiagnosticsStore();
    const transcriptStore = new TranscriptStore();
    const result = await executeLiveValidation({
      sentinel: SMOKE_SENTINEL,
      provider,
      webContents: {},
      reportPath,
      selectorReportPath,
      traceDir: path.join(dir, 'traces'),
      smokeTraceDir: path.join(dir, 'smoke-traces'),
      selectorVerification: readyXray(provider),
      diagnosticsStore,
      transcriptStore,
      sendController: {
        async sendPrompt() {
          return {
            ok: true,
            verified: true,
            verifyReason: 'composer_clear',
            baselineResponseCount: 0,
            finalResponseCount: 0
          };
        }
      },
      lifecycleMonitor: {
        async waitForStableResponse(payload) {
          observedStableMs = payload.provider.stabilityMs;
          return {
            text: 'AI_TEAM_V3_SMOKE_OK',
            selector: '.markdown',
            baselineCount: 0,
            finalCount: 1,
            stableMs: payload.provider.stabilityMs
          };
        }
      },
      domCapture: { marker: 'fake-dom-capture' }
    });
    assert.equal(result.ok, true);
    assert.equal(observedStableMs, provider.stabilityMs);
    assert.equal(transcriptStore.list().length, 1);
    assert.equal(diagnosticsStore.list().length, 0);
    assert.match(fs.readFileSync(reportPath, 'utf8'), /Normalizer result: CLEAN_RESPONSE/);
    assert.equal(fs.existsSync(result.smokeTracePath), true);
    const smokeTrace = fs.readFileSync(result.smokeTracePath, 'utf8');
    assert.equal(smokeTrace.includes('AI_TEAM_V3_SMOKE_OK'), false);
    assert.equal(smokeTrace.includes('must-not-leak'), false);
    const safety = JSON.parse(smokeTrace).safety;
    assert.equal(safety.promptTextStoredInArtifact, false);
    assert.equal(safety.responseTextStoredInArtifact, false);
    assert.equal(safety.responseTextStoredInMemoryTranscript, true);
  }

  {
    const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
    const { reportPath, selectorReportPath, dir } = tempReportPaths();
    const diagnosticsStore = new DiagnosticsStore();
    const transcriptStore = new TranscriptStore();
    const result = await executeLiveValidation({
      sentinel: SMOKE_SENTINEL,
      provider,
      webContents: {},
      reportPath,
      selectorReportPath,
      traceDir: path.join(dir, 'traces'),
      smokeTraceDir: path.join(dir, 'smoke-traces'),
      selectorVerification: readyXray(provider),
      diagnosticsStore,
      transcriptStore,
      sendController: {
        async sendPrompt() {
          return {
            ok: true,
            verified: true,
            verifyReason: 'response_count_increment',
            baselineResponseCount: 0,
            finalResponseCount: 1
          };
        }
      },
      lifecycleMonitor: {
        async waitForStableResponse(payload) {
          return {
            text: 'Cloudflare says verify you are human',
            selector: '.markdown',
            baselineCount: 0,
            finalCount: 1,
            stableMs: payload.provider.stabilityMs
          };
        }
      },
      domCapture: {}
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED_RESPONSE_FIREWALL');
    assert.equal(transcriptStore.list().length, 0);
    assert.equal(diagnosticsStore.hasCode('PROVIDER_CHALLENGE', 'qwen'), true);
    assert.match(fs.readFileSync(reportPath, 'utf8'), /Response was rejected by transcript firewall/);
    assert.equal(fs.existsSync(result.smokeTracePath), true);
    const smokeTrace = fs.readFileSync(result.smokeTracePath, 'utf8');
    assert.equal(smokeTrace.includes('Cloudflare says verify you are human'), false);
    assert.equal(smokeTrace.includes('must-not-leak'), false);
  }

  // Sentinel verification: a clean but wrong reply must NOT pass the smoke.
  {
    const provider = DEFAULT_PROVIDER_DEFINITIONS.qwen;
    const { reportPath, selectorReportPath, dir } = tempReportPaths();
    const diagnosticsStore = new DiagnosticsStore();
    const transcriptStore = new TranscriptStore();
    const result = await executeLiveValidation({
      sentinel: SMOKE_SENTINEL,
      provider,
      webContents: {},
      reportPath,
      selectorReportPath,
      traceDir: path.join(dir, 'traces'),
      smokeTraceDir: path.join(dir, 'smoke-traces'),
      selectorVerification: readyXray(provider),
      diagnosticsStore,
      transcriptStore,
      sendController: {
        async sendPrompt() {
          return { ok: true, verified: true, verifyReason: 'composer_clear', baselineResponseCount: 0, finalResponseCount: 1 };
        }
      },
      lifecycleMonitor: {
        async waitForStableResponse(payload) {
          return { text: 'Hello! How can I help you today?', selector: '.markdown', baselineCount: 0, finalCount: 1, stableMs: payload.provider.stabilityMs };
        }
      },
      domCapture: {}
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'FAILED_SMOKE_SENTINEL_MISMATCH');
    assert.equal(transcriptStore.list().length, 0);
    assert.equal(diagnosticsStore.hasCode('SMOKE_SENTINEL_MISMATCH', 'qwen'), true);
  }

  // Allowlist source of truth: current live phase is qwen/kimi only.
  for (const id of ['qwen', 'kimi']) {
    assert.equal(SAFE_PROVIDERS.has(id), true);
  }
  for (const id of ['deepseek', 'grok', 'zai', 'meta', 'manus']) {
    assert.equal(SAFE_PROVIDERS.has(id), false);
  }
  for (const id of ['chatgpt', 'claude', 'gemini']) {
    assert.equal(FORBIDDEN_PROVIDERS.has(id), true);
  }
  // gemini/perplexity are no longer forbidden (room-level live-allowed), but still outside
  // the one-provider smoke SAFE_PROVIDERS allowlist.
  for (const id of ['perplexity']) {
    assert.equal(FORBIDDEN_PROVIDERS.has(id), false);
    assert.equal(SAFE_PROVIDERS.has(id), false);
  }
  assert.equal(SMOKE_SENTINEL, 'AI_TEAM_V3_SMOKE_OK');

  assert.match(SAFE_COMMAND, /AI_TEAM_V3_LIVE_PROVIDER='qwen'/);
  console.log('PASS smoke-one-provider: safe live driver gates, sentinel, allowlist, and firewall path are covered offline');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
