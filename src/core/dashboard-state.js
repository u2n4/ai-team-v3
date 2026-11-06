'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_PROVIDER_DEFINITIONS } = require('../providers/webview-provider-adapter');
const { resolveProviderSessionPolicy } = require('../providers/provider-session-policy');
const { createProviderHealth } = require('./provider-health');
const { loadProviderSessionPolicy, DEFAULT_POLICY } = require('../providers/provider-session-policy');
const { enforceSafeDefaults } = require('./settings-store');
const { loadSettings } = require('./settings-store');
const { ApprovalGateManager, listApprovalGates } = require('./approval-gate-manager');

function readTextIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch (_error) {
    return '';
  }
}

function extractStatus(markdown, fallback = 'UNKNOWN') {
  const text = String(markdown || '');
  const statusMatch = text.match(/\*\*Status:\*\*\s*([A-Z0-9_/-]+)/i);
  if (statusMatch) {
    return statusMatch[1];
  }
  const verdictMatch = text.match(/VERDICT:\s*\*\*([A-Z0-9_/-]+)\*\*/i);
  if (verdictMatch) {
    return verdictMatch[1];
  }
  return fallback;
}

function readTraceSummaries(projectRoot) {
  const traceRoot = path.join(projectRoot, 'traces');
  if (!fs.existsSync(traceRoot)) {
    return [];
  }
  const summaries = [];
  const stack = [traceRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { summaries.push({ file: path.relative(projectRoot, current), kind: 'trace', providerId: 'unknown', status: 'UNREADABLE', createdAt: null }); continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          summaries.push({
            file: path.relative(projectRoot, fullPath),
            kind: parsed.kind || 'trace',
            providerId: parsed.providerId || 'unknown',
            status: parsed.status || (parsed.summary && parsed.summary.code) || 'UNKNOWN',
            createdAt: parsed.createdAt || parsed.timestamp || null
          });
        } catch (_error) {
          summaries.push({
            file: path.relative(projectRoot, fullPath),
            kind: 'trace',
            providerId: 'unknown',
            status: 'UNREADABLE',
            createdAt: null
          });
        }
      }
    }
  }
  return summaries
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 12);
}

function buildDashboardState({
  projectRoot = path.resolve(__dirname, '..', '..'),
  now = new Date(),
  settings = loadSettings({ projectRoot }),
  health = null,
  transcript = [],
  diagnostics = [],
  reasoning = [],
  policy = loadProviderSessionPolicy(),
  statusTexts = null,
  traceSummaries = null
} = {}) {
  const currentStatusText = statusTexts ? statusTexts[0] : readTextIfExists(path.join(projectRoot, 'coordination', 'CURRENT_STATUS.md')).trim();
  const finalStatusText = statusTexts ? statusTexts[1] : readTextIfExists(path.join(projectRoot, 'FINAL_STATUS.md')).trim();
  const oneProviderReport = statusTexts ? statusTexts[2] : readTextIfExists(path.join(projectRoot, 'docs', 'ONE_PROVIDER_REPORT.md')).trim();
  const selectorReport = statusTexts ? statusTexts[3] : readTextIfExists(path.join(projectRoot, 'docs', 'LIVE_PREP_3_SELECTOR_VERIFICATION.md')).trim();
  const currentStatus = currentStatusText
    ? extractStatus(currentStatusText, 'OFFLINE_READY')
    : 'OFFLINE_READY';
  const finalStatus = finalStatusText
    ? extractStatus(finalStatusText, 'HUMAN_GATED')
    : 'HUMAN_GATED';
  const reports = [];
  if (currentStatusText) {
    reports.push({ label: 'CURRENT_STATUS', path: 'coordination/CURRENT_STATUS.md', status: currentStatus });
  }
  if (finalStatusText) {
    reports.push({ label: 'FINAL_STATUS', path: 'FINAL_STATUS.md', status: finalStatus });
  }
  reports.push({
    label: 'ONE_PROVIDER_REPORT',
    path: 'docs/ONE_PROVIDER_REPORT.md',
    status: oneProviderReport
      ? extractStatus(oneProviderReport, oneProviderReport.includes('Status: NOT_RUN') ? 'NOT_RUN' : 'READY')
      : 'NOT_RUN'
  });
  reports.push({
    label: 'LIVE_PREP_3_SELECTOR_VERIFICATION',
    path: 'docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md',
    status: selectorReport ? extractStatus(selectorReport, 'HUMAN_GATED') : 'HUMAN_GATED'
  });
  const approvalManager = new ApprovalGateManager();
  const healthByProvider = new Map((health || []).map((entry) => [entry.providerId, entry]));

  const providers = Object.values(DEFAULT_PROVIDER_DEFINITIONS).map((provider) => {
    const providerSettings = settings.providers[provider.id] || {};
    const providerHealth = healthByProvider.get(provider.id) || createProviderHealth(provider.id);
    const sessionPolicy = resolveProviderSessionPolicy(provider.id, { policy });
    return {
      id: provider.id,
      name: provider.name,
      liveEnabled: !sessionPolicy.forbidden && providerSettings.liveEnabled === true,
      enabled: !sessionPolicy.forbidden && providerSettings.enabled === true,
      urlHost: new URL(provider.url).host,
      partition: sessionPolicy.partition || provider.partition,
      partitionSource: sessionPolicy.v2SessionReuseAllowed ? 'v2-reused-electron-partition' : 'v3-provider-partition',
      v2SessionReuseAllowed: sessionPolicy.v2SessionReuseAllowed,
      forbiddenLiveProvider: sessionPolicy.forbidden,
      maxPromptChars: providerSettings.maxPromptChars || provider.maxPromptChars || 8000,
      stabilityMs: providerSettings.stabilityMs ?? provider.stabilityMs ?? 1800,
      priority: providerSettings.priority ?? 999,
      status: providerSettings.liveEnabled === true ? 'HUMAN_GATED' : 'OFFLINE_ONLY',
      health: providerHealth
    };
  }).sort((a, b) => a.priority - b.priority);

  const approvalGates = listApprovalGates().map((gate) => ({
    ...gate,
    evaluation: approvalManager.evaluate(gate.id, { offline: gate.live === false })
  }));

  // Build the conversation view: each AI answer paired with that turn's reasoning (if any),
  // so the dashboard can show the ANSWER and the AI's THINKING separately. The transcript
  // holds only answers; reasoning comes from the separate reasoning channel.
  const reasoningByTurn = new Map();
  for (const r of (reasoning || [])) {
    if (r && r.turnId != null) reasoningByTurn.set(`${r.providerId}:${r.turnId}`, r.reasoning);
  }
  const conversation = (transcript || [])
    .filter((entry) => entry && (entry.role === 'ai' || entry.role === 'user'))
    .map((entry) => {
      if (entry.role === 'user') {
        return { role: 'user', text: String(entry.text || '') };
      }
      const key = `${entry.senderId}:${entry.turnId}`;
      const reasoningText = reasoningByTurn.get(key) || '';
      return {
        role: 'ai',
        providerId: entry.senderId,
        providerName: entry.senderName || entry.senderId,
        answer: String(entry.text || ''),
        reasoning: String(reasoningText || '')
      };
    });

  return {
    generatedAt: now.toISOString(),
    liveAutoStart: false,
    currentStatus,
    finalStatus,
    runStatus: 'OFFLINE_DASHBOARD_READY',
    settings: {
      mode: settings.mode,
      live: settings.live,
      approvals: settings.approvals
    },
    providers,
    transcript,
    diagnostics,
    reasoning,
    conversation,
    budgets: providers.map((provider) => ({
      providerId: provider.id,
      maxPromptChars: provider.maxPromptChars
    })),
    approvalGates,
    reports,
    traces: traceSummaries || readTraceSummaries(projectRoot),
    statusFiles: {
      currentStatusPreview: currentStatusText.slice(0, 4000),
      finalStatusPreview: finalStatusText.slice(0, 4000)
    },
    safety: {
      contactsLiveProvidersOnStartup: false,
      autoSendOnStartup: false,
      claudeLiveAllowed: false,
      chatgptLiveAllowed: false,
      perplexityLiveAllowed: false,
      fullSevenProviderLiveAllowed: false
    }
  };
}

module.exports = {
  buildDashboardState,
  extractStatus,
  readTraceSummaries,
  loadDashboardState,
  createDashboardLoader
};

async function loadDashboardState({ projectRoot = path.resolve(__dirname, '..', '..'), ...options } = {}) {
  const ioErrors = [];
  async function read(relativePath) {
    try { return (await fs.promises.readFile(path.join(projectRoot, relativePath), 'utf8')).trim(); }
    catch (error) { if (error.code !== 'ENOENT') ioErrors.push({ file: relativePath, code: error.code }); return ''; }
  }
  const [settingsRaw, policyRaw, ...statusTexts] = await Promise.all([
    read('config/v3-settings.json'), read('config/provider-session-policy.json'),
    read('coordination/CURRENT_STATUS.md'), read('FINAL_STATUS.md'),
    read('docs/ONE_PROVIDER_REPORT.md'), read('docs/LIVE_PREP_3_SELECTOR_VERIFICATION.md')
  ]);
  function parse(raw, fallback, file) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch { ioErrors.push({ file, code: 'INVALID_JSON' }); return fallback; }
  }
  const policy = parse(policyRaw, DEFAULT_POLICY, 'provider-session-policy.json');
  const settings = enforceSafeDefaults(parse(settingsRaw, {}, 'v3-settings.json'));
  const traceSummaries = [];
  const stack = [path.join(projectRoot, 'traces')];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') ioErrors.push({ file: path.relative(projectRoot, directory), code: error.code }); continue; }
    // Bound concurrent disk requests and retained summaries, even with large archives.
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(directory, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(directory, entry.name));
    }
    for (let i = 0; i < files.length; i += 16) {
      const batch = await Promise.all(files.slice(i, i + 16).map(async filePath => {
        const file = path.relative(projectRoot, filePath);
        try {
          const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
          return { file, kind: parsed.kind || 'trace', providerId: parsed.providerId || 'unknown', status: parsed.status || (parsed.summary && parsed.summary.code) || 'UNKNOWN', createdAt: parsed.createdAt || parsed.timestamp || null };
        } catch { return { file, kind: 'trace', providerId: 'unknown', status: 'UNREADABLE', createdAt: null }; }
      }));
      traceSummaries.push(...batch);
      traceSummaries.sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      traceSummaries.length = Math.min(traceSummaries.length, 12);
    }
  }
  return { ...buildDashboardState({ ...options, projectRoot, settings, policy, statusTexts, traceSummaries }), ioErrors };
}

function createDashboardLoader(options) {
  let pending;
  return () => {
    if (!pending) pending = loadDashboardState(options).finally(() => { pending = null; });
    return pending;
  };
}
