'use strict';

// Single source of truth for secret/account-data redaction used across the run report,
// trace viewer, and diagnostics. Keeps cookies, tokens, bearer headers, session/account
// ids, and emails out of any persisted or report-visible string. Metadata only — never
// store raw prompt/response bodies; redact what little free text must be kept.
const SECRET_PATTERNS = [
  // Header-style secrets: consume the WHOLE value to end-of-line, so a "Bearer <token>"
  // tail after the first space is also redacted (not just up to the space).
  /(authorization|cookie|set-cookie)\s*[:=]\s*[^\n\r]+/gi,
  /\bbearer\s+[a-z0-9._~+/=-]+/gi,
  /((access|refresh|id)?_?token|secret|api[_-]?key|session|account[_-]?id|email)\s*[:=]\s*[^\s\n&]+/gi,
  /([?&#](?:access_token|id_token|refresh_token|token|session|code|state|account_id|email)=)[^&#\s]+/gi,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
];

function redactSensitiveText(value) {
  let text = String(value || '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (_match, prefix) => `${prefix || ''}[REDACTED]`);
  }
  return text;
}

module.exports = {
  SECRET_PATTERNS,
  redactSensitiveText
};
