'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { loadDashboardState } = require('../src/core/dashboard-state');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, '.tmp', 'final-round');

function loadBaseline(snapshot, original) {
  const mod = new Module(original, module);
  mod.filename = original;
  mod.paths = Module._nodeModulePaths(path.dirname(original));
  mod._compile(fs.readFileSync(snapshot, 'utf8'), original);
  return mod.exports;
}

async function measure(operation) {
  let syncReads = 0;
  const originals = {};
  for (const name of ['readFileSync', 'readdirSync', 'existsSync']) {
    originals[name] = fs[name];
    fs[name] = (...args) => { syncReads++; return originals[name](...args); };
  }
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 1);
  const start = performance.now();
  try {
    const state = await operation();
    const elapsedMs = performance.now() - start;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { elapsedMs: +elapsedMs.toFixed(2), maxHeartbeatGapMs: +maxGap.toFixed(2), synchronousFsCalls: syncReads, summaries: state.traces.length };
  } finally {
    clearInterval(timer);
    for (const name of Object.keys(originals)) fs[name] = originals[name];
  }
}

async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  const projectRoot = path.join(evidence, 'dashboard-fixture');
  const traces = path.join(projectRoot, 'traces');
  fs.mkdirSync(traces, { recursive: true });
  for (let i = 0; i < 1200; i++) {
    fs.writeFileSync(path.join(traces, `${i}.json`), JSON.stringify({ providerId: 'fake', status: 'PASS', createdAt: new Date(1700000000000 + i).toISOString() }));
  }
  const beforePath = path.join(root, '.tmp', 'dashboard-state-before.cjs');
  const before = fs.existsSync(beforePath) ? loadBaseline(beforePath, path.join(root, 'src', 'core', 'dashboard-state.js')) : null;
  // Warm both production paths, then alternate measured trials to expose variance.
  if (before) before.buildDashboardState({ projectRoot });
  await loadDashboardState({ projectRoot });
  const rows = [];
  for (let trial = 1; trial <= 5; trial++) {
    rows.push({ trial, before: before ? await measure(() => before.buildDashboardState({ projectRoot })) : null,
      after: await measure(() => loadDashboardState({ projectRoot })) });
  }
  const result = { fixtureFiles: 1200, trials: rows };
  fs.writeFileSync(path.join(evidence, 'performance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { measure };
