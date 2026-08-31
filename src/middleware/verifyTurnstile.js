const logger = require('../lib/logger');
const { AppError } = require('../lib/response');

// FIX: bot mitigation for the public demo endpoint — explicitly flagged
// as deferred when the rate limiter was built, added here as its own
// layer rather than folded into the rate limiter, since it answers a
// different question. Rate limiting asks "how many requests from this
// IP" — Turnstile asks "is this even a browser being used by a person."
// A distributed abuse attempt (many IPs, low volume each) slips past
// per-IP rate limits but still can't solve a Turnstile challenge at scale.

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Same placeholder-detection philosophy as routes/contact.js's Resend
// check — recognizes an unedited example value as "not really configured"
// rather than trusting any non-empty string.
function looksLikePlaceholder(val) {
  return !val || /your[_-]?(real[_-]?)?secret|your[_-]?key[_-]?here|example/i.test(val);
}

async function verifyTurnstile(req, res, next) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  // FIX (fail-open on missing config, NOT on failed verification):
  // mirrors the contact form's Resend fallback — during initial setup,
  // before Turnstile is configured, the demo should keep working (with
  // a loud warning) rather than break entirely for every visitor. Once
  // a secret key IS configured, a missing/invalid token is treated as
  // suspicious and rejected — that's the real protection turning on.
  if (looksLikePlaceholder(secretKey)) {
    logger.warn('TURNSTILE_SECRET_KEY not configured — demo endpoint has NO bot protection right now. See README.');
    return next();
  }

  const token = req.body?.turnstileToken;

  if (!token || typeof token !== 'string') {
    logger.warn('Demo request blocked: missing Turnstile token', { ip: req.ip });
    return next(new AppError('BOT_CHECK_FAILED', 'Please complete the verification challenge and try again.', 403));
  }

  try {
    const verifyRes = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token, remoteip: req.ip }),
    });

    const result = await verifyRes.json();

    if (!result.success) {
      logger.warn('Demo request blocked: Turnstile verification failed', { ip: req.ip, errorCodes: result['error-codes'] });
      return next(new AppError('BOT_CHECK_FAILED', 'Verification failed. Please try again.', 403));
    }

    next();

  } catch (err) {
    // FIX: if Cloudflare's own verification service is unreachable, fail
    // CLOSED here too — same principle as the LLM output-moderation pass
    // in ai.js. An unverifiable request isn't a safe one to wave through
    // just because the checker broke.
    logger.error('Turnstile verification request itself failed', { error: err.message });
    next(new AppError('BOT_CHECK_UNAVAILABLE', 'Verification service is temporarily unavailable. Please try again shortly.', 503));
  }
}

module.exports = { verifyTurnstile };
