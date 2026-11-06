'use strict';

const { redactSensitiveText } = require('./redact');

// Pure classifier that turns observed page/send/capture signals into a clear provider
// HEALTH VERDICT, so the room and the Selector Doctor can tell whether a provider is
// working or broken — and WHY — instead of just timing out. No DOM/Electron here: callers
// gather the signals (in-page, redacted) and pass them in. Metadata only.

const HEALTH = Object.freeze({
  READY: 'READY',                 // composer found, send verified, response began
  READY_SLOW: 'READY_SLOW',       // works but send/response was slow (still usable)
  LOGIN_WALL: 'LOGIN_WALL',       // not logged in — login text present, no composer
  CHALLENGE: 'CHALLENGE',         // captcha / cloudflare / anti-bot interstitial
  RATE_LIMITED: 'RATE_LIMITED',   // provider limit / too many requests
  SELECTOR_DRIFT: 'SELECTOR_DRIFT', // no composer AND no login/challenge — selectors changed
  SEND_FAILED: 'SEND_FAILED',     // composer found + typed, but send could not be verified
  CAPTURE_TIMEOUT: 'CAPTURE_TIMEOUT', // sent, but no response rendered in time (capture drift / slow)
  UNKNOWN: 'UNKNOWN'
});

// A verdict is "broken" (needs attention / should be disabled for the run) unless it's a
// healthy READY/READY_SLOW.
const HEALTHY_VERDICTS = new Set([HEALTH.READY, HEALTH.READY_SLOW]);

function isBrokenVerdict(verdict) {
  return !HEALTHY_VERDICTS.has(verdict);
}

/**
 * Classify a provider's live health from observed signals.
 *
 * signals:
 *  - composerFound (bool)        an actionable input/composer is present
 *  - challengeText (bool)        captcha/cloudflare/anti-bot text seen
 *  - loginText (bool)            login/sign-in text seen
 *  - limitText (bool)            rate-limit/quota text seen
 *  - sendVerified (bool|null)    send was verified (composer cleared OR response count rose); null if send not attempted
 *  - responseStarted (bool|null) a response began rendering; null if not waited
 *  - sendMs (number|null)        send latency in ms
 *  - slowSendThresholdMs (num)   above this, a working provider is flagged READY_SLOW (default 8000)
 */
function classifyProviderHealth(signals = {}) {
  if (signals.error) return { verdict: HEALTH.UNKNOWN, broken: true, reason: `Provider probe failed: ${redactSensitiveText(signals.error)}` };
  const {
    composerFound = false,
    challengeText = false,
    loginText = false,
    limitText = false,
    sendVerified = null,
    responseStarted = null,
    sendMs = null,
    slowSendThresholdMs = 8000
  } = signals;

  // Hard blockers first — these explain a missing composer and must not be misread as drift.
  if (challengeText) return { verdict: HEALTH.CHALLENGE, broken: true, reason: 'Anti-bot / captcha / Cloudflare interstitial detected.' };
  if (limitText) return { verdict: HEALTH.RATE_LIMITED, broken: true, reason: 'Provider rate-limit / quota message detected.' };

  if (!composerFound) {
    if (loginText) return { verdict: HEALTH.LOGIN_WALL, broken: true, reason: 'No composer and login text present — provider session is not logged in.' };
    return { verdict: HEALTH.SELECTOR_DRIFT, broken: true, reason: 'No composer found and no login/challenge text — input selectors likely drifted.' };
  }

  // Composer is present. If we attempted a send and it did not verify, it's a send failure.
  if (sendVerified === false) {
    return { verdict: HEALTH.SEND_FAILED, broken: true, reason: 'Composer present and typed, but send could not be verified (composer never cleared and no new response).' };
  }

  // Send verified (or not attempted). If we waited for a response and none started, capture drift / slow.
  if (sendVerified === true && responseStarted === false) {
    return { verdict: HEALTH.CAPTURE_TIMEOUT, broken: true, reason: 'Send verified but no response rendered in time — response selector may have drifted or the provider is slow.' };
  }

  if (sendVerified === true) {
    if (responseStarted !== true) return { verdict: HEALTH.UNKNOWN, broken: true, reason: 'Send verified but response start was not observed.' };
    if (Number.isFinite(Number(sendMs)) && Number(sendMs) > slowSendThresholdMs) {
      return { verdict: HEALTH.READY_SLOW, broken: false, reason: `Working but slow (send ${Math.round(Number(sendMs))}ms > ${slowSendThresholdMs}ms).` };
    }
    return { verdict: HEALTH.READY, broken: false, reason: 'Composer found, send verified, response began rendering.' };
  }

  // Composer present, no send attempted/observed — best we can say is the page is reachable.
  return { verdict: HEALTH.UNKNOWN, broken: true, reason: 'Composer present but send/response not observed.' };
}

module.exports = {
  HEALTH,
  classifyProviderHealth,
  isBrokenVerdict
};
