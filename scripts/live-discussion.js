'use strict';

/**
 * LIVE multi-provider discussion room — the core "AI Team" experience: two or more real
 * web-AI providers take turns discussing the user's goal in one shared transcript.
 *
 * Human-gated like every live path: requires AI_TEAM_V3_LIVE=1 and
 * AI_TEAM_V3_CONFIRM_SAFE_SESSION=1. Only providers in the live allowlist may join, and
 * chatgpt/claude/gemini/perplexity are blocked before any page opens. Default roster
 * stays on the current approved live pair (qwen, kimi); override with
 * AI_TEAM_V3_DISCUSSION_PROVIDERS="qwen,kimi".
 *
 * Run (PowerShell):
 *   $env:AI_TEAM_V3_LIVE='1'; $env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'
 *   $env:AI_TEAM_V3_DISCUSSION_GOAL='Discuss the tradeoffs of monorepos.'
 *   npm run live:discussion
 */

const path = require('node:path');
const fs = require('node:fs');

const { Orchestrator } = require('../src/core/orchestrator');
const { ApprovalGateManager } = require('../src/core/approval-gate-manager');
const { WebviewProviderAdapter, DEFAULT_PROVIDER_DEFINITIONS } = require('../src/providers/webview-provider-adapter');
const { SendController } = require('../src/electron/send-controller');
const { DomCapture } = require('../src/electron/dom-capture');
const { LifecycleMonitor } = require('../src/electron/lifecycle-monitor');
const { ProviderWindowManager } = require('../src/electron/provider-window-manager');
const { assertProviderLiveAllowed, loadProviderSessionPolicy } = require('../src/providers/provider-session-policy');
const { LIVE_PROVIDER_ALLOWLIST, FORBIDDEN_LIVE_PROVIDERS } = require('../src/providers/provider-contract');
const { readDiscussionEvidence } = require('./live-mode-validation');

const LIVE_ENV = 'AI_TEAM_V3_LIVE';
const CONFIRM_ENV = 'AI_TEAM_V3_CONFIRM_SAFE_SESSION';
const APPROVE_DISCUSSION_ENV = 'AI_TEAM_V3_APPROVE_DISCUSSION';
const STATUS_FILE = path.join(__dirname, '..', '.tmp', 'discussion-status.txt');

function writeStatus(line) {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.appendFileSync(STATUS_FILE, `${line}\n`);
  } catch {}
  console.log(line);
}

function rosterFromEnv(env = process.env) {
  const raw = String(env.AI_TEAM_V3_DISCUSSION_PROVIDERS || 'qwen,kimi').trim();
  const ids = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Keep only live-allowed ids (defence in depth; forbidden ids are dropped).
  return ids.filter((id) => LIVE_PROVIDER_ALLOWLIST.includes(id));
}

/**
 * Pure, side-effect-free gate that must pass BEFORE any Electron window or app is
 * touched. Throws (never spawns a process) unless ALL of the following hold:
 *   (a) env enables live mode (LIVE=1 + CONFIRM_SAFE_SESSION=1),
 *   (b) a REAL explicit approval is set (AI_TEAM_V3_APPROVE_DISCUSSION) — evaluated via
 *       ApprovalGateManager WITHOUT the no-op uiApproved short-circuit,
 *   (c) static evidence proves the staged ladder passed (Selector Doctor READY +
 *       one-provider smoke PASS), reusing live-mode-validation's reader, and
 *   (d) the requested roster contains no forbidden provider (chatgpt/claude).
 * Returns the validated roster on success.
 */
function assertDiscussionGateOrThrow(env = process.env, evidencePaths = {}) {
  if (env[LIVE_ENV] !== '1' || env[CONFIRM_ENV] !== '1') {
    throw new Error(`Refused. Set ${LIVE_ENV}=1 and ${CONFIRM_ENV}=1 to run a live discussion.`);
  }
  // Real approval gate — NO hardcoded uiApproved. Requires AI_TEAM_V3_APPROVE_DISCUSSION truthy.
  new ApprovalGateManager({ env }).assertAllowed('LIVE_DISCUSSION');

  const roster = rosterFromEnv(env);
  const requested = String(env.AI_TEAM_V3_DISCUSSION_PROVIDERS || 'qwen,kimi')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const forbidden = requested.filter((id) => FORBIDDEN_LIVE_PROVIDERS.includes(id));
  if (forbidden.length > 0) {
    throw new Error(`Refused. Forbidden live providers are not allowed in a discussion: ${forbidden.join(', ')}.`);
  }
  if (roster.length < 2) {
    throw new Error(`Need at least 2 live-allowed providers. Got: ${roster.join(', ') || '(none)'}.`);
  }

  const evidence = readDiscussionEvidence(evidencePaths);
  if (!evidence.ok) {
    throw new Error(`Refused. ${evidence.status}: ${evidence.details}`);
  }
  return roster;
}

async function main() {
  // Single evidence+approval gate. Throws BEFORE any Electron require/window if env,
  // explicit approval, static evidence, or roster safety is missing.
  let roster;
  try {
    roster = assertDiscussionGateOrThrow(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const goal = String(process.env.AI_TEAM_V3_DISCUSSION_GOAL || 'Briefly introduce yourself in one sentence.').slice(0, 2000);
  const cycles = Math.max(1, Math.min(20, Number(process.env.AI_TEAM_V3_DISCUSSION_CYCLES) || 1));

  const { app, BrowserWindow } = require('electron');
  try { app.disableHardwareAcceleration(); } catch {}
  await app.whenReady();
  writeStatus(`Live discussion starting. roster=${roster.join(', ')} cycles=${cycles}`);

  const sessionPolicy = loadProviderSessionPolicy();
  // Open every provider's window in PARALLEL — each loads its page concurrently instead
  // of serially, so N providers cost ~one page-load instead of N. Each provider still runs
  // in its own visible host window so trusted input lands correctly.
  const windows = [];
  const t0 = Date.now();
  const built = await Promise.all(roster.map(async (providerId) => {
    assertProviderLiveAllowed(providerId, { policy: sessionPolicy });
    const definition = DEFAULT_PROVIDER_DEFINITIONS[providerId];
    const hostWindow = new BrowserWindow({
      width: 1200, height: 820, show: true,
      title: `AI Team — ${definition.name}`,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false }
    });
    windows.push(hostWindow);
    const pwm = new ProviderWindowManager({ hostWindow, providerDefinitions: DEFAULT_PROVIDER_DEFINITIONS, sessionPolicy });
    await pwm.openProvider(providerId);
    const webContents = pwm.getWebContents(providerId);
    const domCapture = new DomCapture({ webContents });
    const sendController = new SendController({ webContents, hostWindow });
    const lifecycleMonitor = new LifecycleMonitor({ webContents });
    writeStatus(`  joined: ${definition.name}`);
    return new WebviewProviderAdapter({ definition, sendController, lifecycleMonitor, domCapture });
  }));
  // Preserve the roster order for deterministic turn-taking.
  const providers = built;
  writeStatus(`All ${providers.length} providers ready in ${Math.round((Date.now() - t0) / 1000)}s (parallel open).`);

  // Share a transcript store so we can print each AI turn LIVE as it lands, instead of
  // dumping everything only at the end.
  const { TranscriptStore } = require('../src/core/transcript-store');
  const transcriptStore = new TranscriptStore();
  const orchestrator = new Orchestrator({ providers, transcriptStore });
  writeStatus(`Discussing: "${goal}"`);

  let printedTurns = 0;
  const poll = setInterval(() => {
    try {
      const turns = transcriptStore.list().filter((e) => e.role === 'ai');
      for (let i = printedTurns; i < turns.length; i++) {
        const t = turns[i];
        writeStatus(`  [${t.senderName || t.senderId}] ${String(t.text || '').replace(/\s+/g, ' ').slice(0, 240)}`);
      }
      printedTurns = turns.length;
    } catch {}
  }, 1500);

  // Pause between turns so a long fast discussion doesn't trip per-account rate limits /
  // bot challenges (the cause of the duplicate/empty turns seen in 10-round runs).
  const turnDelayMs = Math.max(0, Number(process.env.AI_TEAM_V3_TURN_DELAY_MS) || 4000);
  let report;
  try {
    report = await orchestrator.run({ userMessage: goal, cycles, userGoal: goal, turnDelayMs });
  } finally {
    clearInterval(poll);
  }

  const aiTurns = report.transcript.filter((e) => e.role === 'ai');
  // Flush any turns the poller missed, then the summary.
  for (let i = printedTurns; i < aiTurns.length; i++) {
    const t = aiTurns[i];
    writeStatus(`  [${t.senderName || t.senderId}] ${String(t.text || '').replace(/\s+/g, ' ').slice(0, 240)}`);
  }
  writeStatus(`Discussion complete: ${aiTurns.length} AI turns, ${report.diagnostics.length} diagnostics.`);

  for (const win of windows) { try { win.destroy(); } catch {} }
  process.exitCode = aiTurns.length > 0 ? 0 : 1;
  app.quit();
}

if (process.versions && process.versions.electron) {
  main().catch((error) => {
    writeStatus(`Live discussion failed: ${error.message}`);
    process.exit(1);
  });
} else if (require.main === module) {
  console.error('Run under Electron: npm run live:discussion');
  process.exit(1);
}

module.exports = { rosterFromEnv, assertDiscussionGateOrThrow, APPROVE_DISCUSSION_ENV };
