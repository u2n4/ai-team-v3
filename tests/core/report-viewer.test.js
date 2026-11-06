'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assert, makeTempDir } = require('../test-utils');
const { generateReportViewerHtml, redactSensitiveText, summarizeTrace, writeReportViewer } = require('../../src/core/report-viewer');

async function run() {
  const dir = makeTempDir('ai-team-v3-report-viewer-');
  const traceDir = path.join(dir, 'traces', 'selector-doctor');
  fs.mkdirSync(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, 'trace.json');
  fs.writeFileSync(tracePath, JSON.stringify({
    kind: 'selector-doctor',
    providerId: 'qwen',
    status: 'READY',
    selectorSummary: {
      code: 'READY',
      urlObserved: 'https://chat.qwen.ai/?access_token=secret-token&email=ali@example.com'
    },
    diagnosticsSummary: [{ providerId: 'qwen', code: 'OK', message: 'Authorization: Bearer nope' }]
  }), 'utf8');

  const summary = summarizeTrace(tracePath, dir);
  const html = generateReportViewerHtml({ traces: [summary] });
  assert.equal(html.includes('secret-token'), false);
  assert.equal(html.includes('ali@example.com'), false);
  assert.equal(html.includes('Bearer nope'), false);
  assert.equal(redactSensitiveText('Cookie: abc Authorization: Bearer xyz').includes('abc'), false);
  // The token tail after "Bearer " must also be redacted, not just the word "Bearer".
  assert.equal(redactSensitiveText('Authorization: Bearer tok-12345').includes('tok-12345'), false);
  // Non-secret text is preserved (no over-redaction).
  assert.equal(redactSensitiveText('the discussion reached consensus'), 'the discussion reached consensus');

  const result = writeReportViewer({ projectRoot: dir });
  assert.equal(fs.existsSync(result.outputPath), true);
  assert.equal(fs.readFileSync(result.outputPath, 'utf8').includes('secret-token'), false);

  console.log('PASS report viewer: trace summaries are generated without secrets');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = run;
