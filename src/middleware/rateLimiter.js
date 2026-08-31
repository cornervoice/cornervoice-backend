const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');

// FIX: these endpoints are public and unauthenticated by design — a
// site visitor has no account. That makes them the ONLY cost-incurring,
// abuse-able surface in this whole system without a login wall in front
// of it, so the limits here are deliberately much tighter than anything
// in the authenticated product backend.

// The interactive demo calls Claude twice per request (analyze + reply).
// 5 per IP per hour is generous enough for a genuine prospect to try it
// a couple of times, tight enough that a scripted abuse attempt can't
// run up a meaningful bill before it's noticed.
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: "You've reached the demo limit for now. Want to see this against your real reviews? Get in touch and we'll show you directly.",
      status: 429,
    },
  },
  handler: (req, res, next, options) => {
    logger.warn('Demo rate limit hit', { ip: req.ip });
    res.status(options.statusCode).json(options.message);
  },
});

// Contact form doesn't call any paid API, but still needs a limit to
// prevent it being used to spam an inbox or hammer whatever email
// service is behind it.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many submissions from this connection. Please try again later, or email us directly.',
      status: 429,
    },
  },
});

// A coarser, whole-server backstop in front of everything — catches
// anything that slips past the per-route limiters (e.g. a burst across
// many different endpoints from the same source).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { demoLimiter, contactLimiter, globalLimiter };
