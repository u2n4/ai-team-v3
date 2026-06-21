'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { containsSecret } = require('../src/core/problem-detector');
const {
  FORBIDDEN_LIVE_PROVIDERS,
  LIVE_PROVIDER_ALLOWLIST
} = require('../src/providers/provider-contract');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPORT_PATH = path.join(PROJECT_ROOT, 'docs', 'LIVE_ENDURANCE_30_REPORT.md');
const DEFAULT_SELECTOR_REPORT_PATH = path.join(PROJECT_ROOT, 'docs', 'LIVE_PREP_3_SELECTOR_VERIFICATION.md');
const DEFAULT_SMOKE_REPORT_PATH = path.join(PROJECT_ROOT, 'docs', 'ONE_PROVIDER_REPORT.md');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readText(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch (_error) {
    return '';
  }
}

function parseProviders(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function writeLiveModeReport(status, details, { reportPath = DEFAULT_REPORT_PATH } = {}) {
  ensureParentDir(reportPath);
  const body = [
    '# Live Endurance 30 Report',
    '',
    `Status: ${status}`,
    '',
    details,
    '',
    'Safety:',
    '- qwen/kimi only until both doctor and smoke gates pass.',
    '- Claude, ChatGPT, and Perplexity live are blocked.',
    '- CAPTCHA, Cloudflare, login wall, rate limit, paid wall, prompt budget overflow, contamination, or secret risk stops the ladder.',
    '- This script does not bypass provider restrictions or log secrets.'
  ].join('\n');
  if (containsSecret(body)) {
    throw new Error('Refusing to write live report because it contains secret-shaped text.');
  }
  fs.writeFileSync(reportPath, body, 'utf8');
}

function readDiscussionEvidence({
  selectorReportPath = DEFAULT_SELECTOR_REPORT_PATH,
  smokeReportPath = DEFAULT_SMOKE_REPORT_PATH
} = {}) {
  const selectorReport = readText(selectorReportPath);
  const smokeReport = readText(smokeReportPath);
  const doctorReady = /Status:\s*READY_FOR_ONE_PROVIDER_SMOKE/i.test(selectorReport);
  const challenge = /PROVIDER_CHALLENGE|PROVIDER_LIMIT|PROVIDER_LOGIN_WALL|PROVIDER_PAID_WALL/i.exec(selectorReport);
  const smokePass = /Status:\s*PASS/i.test(smokeReport);
  if (!doctorReady) {
    return {
      ok: false,
      status: challenge ? 'BLOCKED_CHALLENGE_OR_LIMIT' : 'BLOCKED_DOCTOR_NOT_PASSED',
      details: challenge
        ? `Selector Doctor detected a blocking provider state: ${challenge[0]}.`
        : 'Selector Doctor report does not prove READY_FOR_ONE_PROVIDER_SMOKE.'
    };
  }
  if (!smokePass) {
    return {
      ok: false,
      status: 'BLOCKED_ONE_PROVIDER_SMOKE_NOT_PASSED',
      details: 'One-provider smoke report does not prove PASS.'
    };
  }
  return { ok: true, status: 'STATIC_EVIDENCE_PRESENT', details: 'Selector Doctor READY and one-provider smoke PASS.' };
}

function validateLiveModeGate({
  env = process.env,
  selectorReportPath = DEFAULT_SELECTOR_REPORT_PATH,
  smokeReportPath = DEFAULT_SMOKE_REPORT_PATH
} = {}) {
  const providers = parseProviders(env.AI_TEAM_V3_LIVE_PROVIDERS || env.AI_TEAM_V3_LIVE_PROVIDER);
  if (env.AI_TEAM_V3_LIVE !== '1') {
    return {
      ok: false,
      exitCode: 0,
      status: 'NOT_RUN',
      providers,
      details: 'Live mode validation was not run because AI_TEAM_V3_LIVE=1 is missing.'
    };
  }
  if (env.AI_TEAM_V3_CONFIRM_SAFE_SESSION !== '1') {
    return {
      ok: false,
      exitCode: 1,
      status: 'BLOCKED_SAFE_SESSION_REQUIRED',
      providers,
      details: 'A human must confirm a safe logged-in qwen/kimi session before any live discussion.'
    };
  }
  if (providers.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      status: 'BLOCKED_NO_PROVIDERS',
      providers,
      details: 'AI_TEAM_V3_LIVE_PROVIDERS must be qwen,kimi for this ladder.'
    };
  }
  const forbidden = providers.filter((providerId) => FORBIDDEN_LIVE_PROVIDERS.includes(providerId));
  if (forbidden.length > 0) {
    return {
      ok: false,
      exitCode: 1,
      status: 'BLOCKED_PROVIDER_FORBIDDEN',
      providers,
      details: `Forbidden live provider requested: ${forbidden.join(', ')}. ChatGPT/Claude/Gemini/Perplexity live is disabled by human instruction.`
    };
  }
  const unsupported = providers.filter((providerId) => !LIVE_PROVIDER_ALLOWLIST.includes(providerId));
  if (unsupported.length > 0) {
    return {
      ok: false,
      exitCode: 1,
      status: 'BLOCKED_PROVIDER_NOT_ALLOWED',
      providers,
      details: `Unsupported live provider for this ladder: ${unsupported.join(', ')}.`
    };
  }

  const maxMessages = Number(env.AI_TEAM_V3_LIVE_MAX_MESSAGES || 0);
  if (maxMessages !== 30) {
    return {
      ok: false,
      exitCode: 1,
      status: 'BLOCKED_INVALID_MESSAGE_LIMIT',
      providers,
      details: 'AI_TEAM_V3_LIVE_MAX_MESSAGES must be exactly 30 for the 30-message endurance gate.'
    };
  }

  const selectorReport = readText(selectorReportPath);
  const smokeReport = readText(smokeReportPath);
  if (!/Status:\s*READY_FOR_ONE_PROVIDER_SMOKE/i.test(selectorReport)) {
    const challenge = /PROVIDER_CHALLENGE|PROVIDER_LIMIT|PROVIDER_LOGIN_WALL|PROVIDER_PAID_WALL/i.exec(selectorReport);
    return {
      ok: false,
      exitCode: 1,
      status: challenge ? 'BLOCKED_CHALLENGE_OR_LIMIT' : 'BLOCKED_DOCTOR_NOT_PASSED',
      providers,
      details: challenge
        ? `Selector Doctor detected a blocking provider state: ${challenge[0]}.`
        : 'Selector Doctor report does not prove READY_FOR_ONE_PROVIDER_SMOKE.'
    };
  }
  if (!/Status:\s*PASS/i.test(smokeReport)) {
    return {
      ok: false,
      exitCode: 1,
      status: 'BLOCKED_ONE_PROVIDER_SMOKE_NOT_PASSED',
      providers,
      details: 'One-provider smoke report does not prove PASS.'
    };
  }

  return {
    ok: false,
    exitCode: 1,
    status: 'WAITING_FOR_HUMAN_LIVE_CONFIRMATION',
    providers,
    details: 'All static gates appear present, but Codex will not run live qwen/kimi discussion without an explicit same-turn human instruction.'
  };
}

async function main() {
  const result = validateLiveModeGate();
  writeLiveModeReport(result.status, result.details);
  console.log(`live-mode-validation ${result.status}`);
  console.log(result.details);
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_SELECTOR_REPORT_PATH,
  DEFAULT_SMOKE_REPORT_PATH,
  FORBIDDEN_LIVE_PROVIDERS,
  LIVE_PROVIDER_ALLOWLIST,
  main,
  parseProviders,
  readDiscussionEvidence,
  validateLiveModeGate,
  writeLiveModeReport
};
