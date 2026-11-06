'use strict';

/**
 * Performance benchmark for the AI Team V3 orchestration core (offline — uses fake
 * providers, contacts nothing live). Measures the throughput and latency of the
 * orchestrator + prompt builder + transcript/firewall path so regressions are visible
 * with real numbers. Run: npm run benchmark
 */

const { Orchestrator } = require('../src/core/orchestrator');
const { FakeProvider } = require('../src/providers/fake-provider');

function hrMs(start) {
  const [s, ns] = process.hrtime(start);
  return s * 1000 + ns / 1e6;
}

function makeProviders(n) {
  const ids = ['qwen', 'kimi', 'deepseek', 'grok', 'perplexity', 'zai', 'meta', 'manus'];
  return Array.from({ length: n }, (_, i) => new FakeProvider({
    id: ids[i % ids.length] + (i >= ids.length ? `_${i}` : ''),
    name: `Provider${i + 1}`,
    mode: 'clean'
  }));
}

async function benchOne({ providerCount, cycles }) {
  const providers = makeProviders(providerCount);
  const orchestrator = new Orchestrator({ providers });
  const start = process.hrtime();
  const report = await orchestrator.run({
    userMessage: 'Benchmark: discuss tradeoffs of caching strategies.',
    cycles,
    userGoal: 'Benchmark run.'
  });
  const ms = hrMs(start);
  const aiTurns = report.transcript.filter((e) => e.role === 'ai').length;
  if (aiTurns !== providerCount * cycles) throw new Error(`Benchmark captured ${aiTurns}/${providerCount * cycles} expected turns`);
  return { providerCount, cycles, ms, aiTurns, msPerTurn: ms / aiTurns };
}

async function main() {
  console.log('AI Team V3 — orchestration benchmark (offline, fake providers)\n');
  const scenarios = [
    { providerCount: 2, cycles: 1 },
    { providerCount: 3, cycles: 2 },
    { providerCount: 5, cycles: 2 },
    { providerCount: 7, cycles: 3 },
    { providerCount: 7, cycles: 5 }
  ];
  const rows = [];
  for (const s of scenarios) {
    // warm + measured
    await benchOne(s);
    const r = await benchOne(s);
    rows.push(r);
    console.log(
      `providers=${String(r.providerCount).padEnd(2)} cycles=${r.cycles}  ` +
      `total=${r.ms.toFixed(1)}ms  turns=${String(r.aiTurns).padEnd(3)}  ` +
      `per-turn=${r.msPerTurn.toFixed(2)}ms`
    );
  }
  const worst = rows.reduce((a, b) => (b.msPerTurn > a.msPerTurn ? b : a), rows[0]);
  console.log(`\nBenchmark: ${rows.length} scenarios, max ${worst.msPerTurn.toFixed(2)}ms/turn (${worst.providerCount}p×${worst.cycles}c).`);
  // Guardrail: orchestration overhead per turn should stay well under 50ms offline.
  if (worst.msPerTurn > 50) {
    console.error(`WARN: per-turn overhead ${worst.msPerTurn.toFixed(2)}ms exceeds 50ms budget.`);
    process.exitCode = 1;
  } else { console.log('PASS benchmark'); }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { benchOne, makeProviders };
