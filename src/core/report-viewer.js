'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SECRET_PATTERNS, redactSensitiveText } = require('./redact');

function escapeHtml(value) {
  return redactSensitiveText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectTraceFiles(traceRoot) {
  if (!fs.existsSync(traceRoot)) {
    return [];
  }
  const files = [];
  const stack = [traceRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function summarizeTrace(filePath, projectRoot = process.cwd()) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return { file: path.relative(projectRoot, filePath), providerId: 'unknown', status: 'UNREADABLE' }; }
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = { status: 'UNREADABLE' };
  } catch (_error) {
    parsed = { status: 'UNREADABLE' };
  }
  return {
    file: path.relative(projectRoot, filePath),
    kind: parsed.kind || 'trace',
    runId: parsed.runId || '',
    providerId: parsed.providerId || 'unknown',
    status: parsed.status || (parsed.selectorSummary && parsed.selectorSummary.code) || 'UNKNOWN',
    promptSize: parsed.prompt ? parsed.prompt.promptChars : parsed.promptChars,
    sendVerified: parsed.send ? parsed.send.verified : null,
    responseCountBefore: parsed.send ? parsed.send.baselineResponseCount : parsed.capture && parsed.capture.baselineCount,
    responseCountAfter: parsed.send ? parsed.send.finalResponseCount : parsed.capture && parsed.capture.finalCount,
    captureDuration: parsed.capture ? parsed.capture.stableMs : null,
    normalizerResult: parsed.normalizer ? parsed.normalizer.code : null,
    firewallDecision: parsed.normalizer ? (parsed.normalizer.ok === true ? 'ACCEPTED' : parsed.normalizer.ok === false ? 'REJECTED' : 'UNKNOWN') : null,
    diagnostics: Array.isArray(parsed.diagnosticsSummary) ? parsed.diagnosticsSummary : [],
    urlObserved: parsed.selectorSummary ? parsed.selectorSummary.urlObserved : null
  };
}

function generateReportViewerHtml({ traces = [], generatedAt = new Date().toISOString() } = {}) {
  const rows = traces.map((trace) => `
    <tr>
      <td>${escapeHtml(trace.file)}</td>
      <td>${escapeHtml(trace.providerId)}</td>
      <td>${escapeHtml(trace.status)}</td>
      <td>${escapeHtml(trace.promptSize == null ? 'n/a' : trace.promptSize)}</td>
      <td>${escapeHtml(trace.sendVerified == null ? 'n/a' : trace.sendVerified)}</td>
      <td>${escapeHtml(trace.responseCountBefore == null ? 'n/a' : trace.responseCountBefore)} -> ${escapeHtml(trace.responseCountAfter == null ? 'n/a' : trace.responseCountAfter)}</td>
      <td>${escapeHtml(trace.captureDuration == null ? 'n/a' : `${trace.captureDuration}ms`)}</td>
      <td>${escapeHtml(trace.normalizerResult || 'n/a')}</td>
      <td>${escapeHtml(trace.firewallDecision || 'n/a')}</td>
      <td>${escapeHtml(trace.urlObserved || 'n/a')}</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>AI Team V3 Trace Viewer</title>
  <style>
    :root { color-scheme: dark; --bg: #101214; --panel: #181c20; --text: #edf1f4; --muted: #9ca8b4; --line: #2c343c; --accent: #81d4b4; --warn: #e2c16b; }
    body { margin: 0; padding: 28px; background: var(--bg); color: var(--text); font-family: "Aptos", "Segoe UI", sans-serif; }
    header { display: flex; justify-content: space-between; gap: 20px; align-items: end; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
    p { color: var(--muted); max-width: 900px; }
    table { width: 100%; border-collapse: collapse; margin-top: 22px; background: var(--panel); border: 1px solid var(--line); }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; font-size: 13px; vertical-align: top; }
    th { color: var(--accent); font-weight: 700; }
    .warning { color: var(--warn); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>AI Team V3 Trace Viewer</h1>
      <p>Redacted local trace index. It shows counts, statuses, durations, normalizer decisions, and sanitized URLs only.</p>
    </div>
    <span>${escapeHtml(generatedAt)}</span>
  </header>
  <p class="warning">Never include cookies, tokens, Authorization headers, emails, account ids, session ids, raw headers, prompt text, or raw response text in this viewer.</p>
  <table>
    <thead>
      <tr><th>Trace</th><th>Provider</th><th>Status</th><th>Prompt size</th><th>Send verified</th><th>Response count</th><th>Capture</th><th>Normalizer</th><th>Firewall</th><th>URL</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="10">No trace files found.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

function writeReportViewer({ projectRoot = process.cwd(), outputPath = path.join(projectRoot, 'docs', 'V3_TRACE_REPORT_VIEWER.html') } = {}) {
  const traceFiles = collectTraceFiles(path.join(projectRoot, 'traces'));
  const traces = traceFiles.map((filePath) => summarizeTrace(filePath, projectRoot));
  const html = generateReportViewerHtml({ traces });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
  return { outputPath, traces };
}

module.exports = {
  collectTraceFiles,
  escapeHtml,
  generateReportViewerHtml,
  redactSensitiveText,
  summarizeTrace,
  writeReportViewer
};
