'use strict';

// Single source of truth for secret/account-data redaction used across the run report,
// trace viewer, and diagnostics. Keeps cookies, tokens, bearer headers, session/account
// ids, and emails out of any persisted or report-visible string. Metadata only — never
// store raw prompt/response bodies; redact what little free text must be kept.
const SECRET_KEY = /cookie|authorization|token|secret|api[_-]?key|session(?:[_-]?id)?|account[_-]?id|email/i;
const SECRET_PATTERNS = [
  /(["']?(?:authorization|set-cookie|cookie)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}\]]+)/gi,
  /(["']?(?:(?:access|refresh|id)[_-]?)?token["']?\s*[:=]\s*|["']?(?:secret|client[_-]?secret|api[_-]?key|session(?:[_-]?id)?|account[_-]?id|email)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}\]\r\n]+)/gi
];

function redactSensitiveText(value) {
  let text = String(value ?? '');
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      url.username = ''; url.password = ''; url.search = url.search ? '?redacted=1' : ''; url.hash = '';
      return url.toString();
    } catch { return '[REDACTED-URL]'; }
  });
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (_match, prefix, secret) => {
      const quote = /^["']/.test(secret) ? secret[0] : '';
      return `${prefix}${quote}[REDACTED]${quote}`;
    });
  }
  return text.replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]{12,}/gi, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]');
}

function redactSensitiveValue(value) {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, SECRET_KEY.test(key) ? '[REDACTED]' : redactSensitiveValue(item)]));
}

module.exports = {
  SECRET_PATTERNS,
  redactSensitiveText,
  redactSensitiveValue
};
