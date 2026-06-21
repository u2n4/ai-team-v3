'use strict';

const { assert } = require('../test-utils');
const { STANDARD_MODES, validateModeSpecificAcceptance } = require('../../src/core/mode-definitions');

async function run() {
  assert.equal(STANDARD_MODES.length, 12);
  for (const mode of STANDARD_MODES) {
    assert.equal(typeof mode.id, 'string');
    assert.equal(typeof mode.name, 'string');
    assert.equal(typeof mode.purpose, 'string');
    assert.equal(Array.isArray(mode.flow), true);
    assert.equal(typeof mode.expectedTranscriptShape, 'string');
    assert.equal(typeof mode.expectedDiagnostics, 'string');
    assert.equal(Array.isArray(mode.acceptanceTests), true);
    assert.equal(Array.isArray(mode.failureRisks), true);
    assert.equal(Array.isArray(mode.bugsRevealed), true);
    assert.equal(typeof mode.acceptanceCriterion, 'function');
  }

  assert.equal(validateModeSpecificAcceptance('consensus', {
    transcript: [{ role: 'ai', text: 'consensus: aligned. disagreements: live remains human-gated.' }]
  }).ok, true);
  assert.equal(validateModeSpecificAcceptance('debate', {
    transcript: [{ role: 'ai', text: 'position: pro speed. position: con safety.' }]
  }).ok, true);
  assert.equal(validateModeSpecificAcceptance('routerMode', {
    transcript: [{ role: 'ai', text: 'route: selected provider qwen for this task.' }]
  }).ok, true);

  console.log('PASS mode definitions: 12 modes expose metadata and mode-specific acceptance criteria');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = run;
