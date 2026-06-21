'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Orchestrator } = require('../src/core/orchestrator');
const { FakeProvider } = require('../src/providers/fake-provider');

const DEFAULT_PROVIDER_IDS = ['qwen', 'kimi', 'chatgpt', 'deepseek', 'gemini', 'claude', 'perplexity'];

// Project-local temp root. Using a dir on the project's own drive (instead of
// os.tmpdir()) avoids the intermittent EPERM on Windows when mkdtemp races
// against the shared system temp dir. Gitignored via the project .gitignore.
const TEMP_ROOT = path.join(__dirname, '..', '.tmp');

/**
 * Create a unique temp directory for a test, retrying on the rare name
 * collision / transient EPERM. Returns the absolute path.
 */
function makeTempDir(prefix = 'ai-team-v3-') {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return fs.mkdtempSync(path.join(TEMP_ROOT, prefix));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function providerName(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function makeFakeProviders(ids = DEFAULT_PROVIDER_IDS, mode = 'clean') {
  return ids.map((id) => new FakeProvider({
    id,
    name: providerName(id),
    mode
  }));
}

function makeOrchestrator(providers, options = {}) {
  return new Orchestrator({ providers, ...options });
}

function countOccurrences(text, needle) {
  return (String(text).match(new RegExp(escapeRegExp(needle), 'g')) || []).length;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertNoDiagnosticsInTranscript(report) {
  for (const entry of report.transcript) {
    assert.equal(entry.role === 'ai' && /\[SYSTEM DIAGNOSTIC\]|PROMPT_OVER_BUDGET|FAILED_DIAGNOSTIC/i.test(entry.text), false);
  }
}

function assertNoDiagnosticsInPrompts(providers) {
  for (const provider of providers) {
    for (const prompt of provider.sentPrompts) {
      assert.equal(/\[SYSTEM DIAGNOSTIC\]|PROMPT_OVER_BUDGET|FAILED_DIAGNOSTIC/i.test(prompt.text), false);
    }
  }
}

module.exports = {
  assert,
  DEFAULT_PROVIDER_IDS,
  FakeProvider,
  makeFakeProviders,
  makeOrchestrator,
  makeTempDir,
  countOccurrences,
  assertNoDiagnosticsInTranscript,
  assertNoDiagnosticsInPrompts
};
