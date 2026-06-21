'use strict';

const { Orchestrator } = require('../src/core/orchestrator');
const { FakeProvider } = require('../src/providers/fake-provider');
const { ApprovalGateManager } = require('../src/core/approval-gate-manager');

const LADDER_STEPS = Object.freeze({
  one: ['qwen'],
  two: ['qwen', 'kimi'],
  three: ['qwen', 'kimi', 'deepseek'],
  five: ['qwen', 'kimi', 'deepseek', 'gemini', 'chatgpt'],
  seven: ['qwen', 'kimi', 'deepseek', 'gemini', 'chatgpt', 'claude', 'perplexity']
});

function providerName(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function createFakeLadderProviders(providerIds, modes = {}) {
  return providerIds.map((id) => new FakeProvider({
    id,
    name: providerName(id),
    mode: modes[id] || 'clean'
  }));
}

function selectedSteps(stepName) {
  if (!stepName || stepName === 'all' || stepName === 'multi') {
    return ['one', 'two', 'three', 'five', 'seven'];
  }
  if (!LADDER_STEPS[stepName]) {
    throw new Error(`Unknown fake ladder step: ${stepName}`);
  }
  return [stepName];
}

async function runFakeLadderStep({ stepName, cycles = 2, modes = {} }) {
  const providerIds = LADDER_STEPS[stepName];
  const providers = createFakeLadderProviders(providerIds, modes);
  const orchestrator = new Orchestrator({ providers });
  const report = await orchestrator.run({
    userMessage: `Run AI Team V3 offline fake ${stepName}-provider ladder.`,
    cycles,
    userGoal: 'Exercise orchestration only. Do not contact live providers.'
  });

  return {
    stepName,
    providerIds,
    cycles,
    report,
    providers
  };
}

async function runFakeLadder({ stepName = 'all', cycles = 2, modes = {} } = {}) {
  const approval = new ApprovalGateManager().assertAllowed('OFFLINE_FAKE_LADDER', { offline: true });
  const results = [];
  for (const step of selectedSteps(stepName)) {
    results.push(await runFakeLadderStep({ stepName: step, cycles, modes }));
  }
  return {
    ok: true,
    approval,
    results
  };
}

async function main() {
  const stepName = process.argv[2] || 'all';
  const result = await runFakeLadder({ stepName });
  for (const step of result.results) {
    const aiTurns = step.report.transcript.filter((entry) => entry.role === 'ai').length;
    const diagnostics = step.report.diagnostics.length;
    console.log(`PASS fake ladder ${step.stepName}: providers=${step.providerIds.join(',')} aiTurns=${aiTurns} diagnostics=${diagnostics}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  LADDER_STEPS,
  createFakeLadderProviders,
  runFakeLadder,
  runFakeLadderStep,
  selectedSteps
};
