const router = require('express').Router();
const { ok, errorResponse, AppError } = require('../lib/response');
const logger = require('../lib/logger');

const MAX_FIELD_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 3000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateField(value, fieldName, maxLength) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new AppError('VALIDATION_ERROR', `${fieldName} is required.`, 400);
  }
  if (value.length > maxLength) {
    throw new AppError('VALIDATION_ERROR', `${fieldName} is too long.`, 400);
  }
  return value.trim();
}

// Very basic HTML-escaping for anything interpolated into the email body
// — this data is about to be embedded in an HTML email, and it's
// public-form input, so treat it the same as any other untrusted string
// rather than assuming a contact form is a low-risk input source.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// POST /v1/contact
router.post('/', async (req, res, next) => {
  try {
    const { name, email, business, industry, locations, message } = req.body || {};

    const cleanName = validateField(name, 'Name', MAX_FIELD_LENGTH);
    const cleanBusiness = validateField(business, 'Business name', MAX_FIELD_LENGTH);
    const cleanMessage = validateField(message, 'Message', MAX_MESSAGE_LENGTH);

    if (!email || typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
      throw new AppError('VALIDATION_ERROR', 'A valid email address is required.', 400);
    }
    const cleanEmail = email.trim();

    // Optional fields — validate length if present, but don't require them
    const cleanIndustry = industry && typeof industry === 'string' ? industry.trim().slice(0, MAX_FIELD_LENGTH) : null;
    const cleanLocations = locations && typeof locations === 'string' ? locations.trim().slice(0, MAX_FIELD_LENGTH) : null;

    const submission = {
      name: cleanName,
      email: cleanEmail,
      business: cleanBusiness,
      industry: cleanIndustry,
      locations: cleanLocations,
      message: cleanMessage,
      submittedAt: new Date().toISOString(),
      ip: req.ip,
    };

    const delivered = await sendContactEmail(submission);

    logger.info('Contact form submission processed', {
      email: cleanEmail, business: cleanBusiness, delivered,
    });

    ok(res, { received: true });

  } catch (err) {
    if (err instanceof AppError) return errorResponse(res, err);
    logger.error('Contact form processing failed', { error: err.message });
    next(err);
  }
});

// ── Email delivery ────────────────────────────────────────────
async function sendContactEmail(submission) {
  const apiKey = process.env.RESEND_API_KEY;
  const toAddress = process.env.CONTACT_NOTIFICATION_EMAIL;

  // FIX: catch the specific failure mode found during testing — an
  // unedited placeholder value from .env.example is a non-empty string,
  // so a plain truthy check alone would think credentials are configured
  // and attempt a real API call that fails loudly and confusingly.
  // Recognize common placeholder patterns as "not actually configured."
  const looksLikePlaceholder = (val) => !val || /your[_-]?(real[_-]?)?key|your[_-]?key[_-]?here|example\.com/i.test(val);

  if (looksLikePlaceholder(apiKey) || looksLikePlaceholder(toAddress)) {
    // FIX-BEFORE-LAUNCH: this fallback exists so the endpoint is testable
    // without requiring an email service to be configured first — but a
    // submission that only gets logged is NOT actually delivered to
    // anyone. If the server restarts or logs aren't retained, it's gone.
    // Do not treat this branch as acceptable for a live launch — see
    // README for the two-minute Resend setup.
    logger.warn('RESEND_API_KEY or CONTACT_NOTIFICATION_EMAIL not configured — contact submission was only logged, NOT emailed', {
      submission,
    });
    return false;
  }

  const emailBody = `
    <h2>New Corner Voice contact form submission</h2>
    <p><strong>Name:</strong> ${escapeHtml(submission.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(submission.email)}</p>
    <p><strong>Business:</strong> ${escapeHtml(submission.business)}</p>
    ${submission.industry ? `<p><strong>Industry:</strong> ${escapeHtml(submission.industry)}</p>` : ''}
    ${submission.locations ? `<p><strong>Locations:</strong> ${escapeHtml(submission.locations)}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(submission.message).replace(/\n/g, '<br>')}</p>
    <hr>
    <p style="color:#888; font-size:12px;">Submitted ${submission.submittedAt} from ${submission.ip}</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL || 'Corner Voice <onboarding@resend.dev>',
      to: toAddress,
      reply_to: submission.email,
      subject: `New inquiry from ${submission.business}`,
      html: emailBody,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error('Resend API call failed', { status: res.status, body });
    // Fail loudly rather than silently — a failed send should not be
    // reported to the visitor as a success.
    throw new AppError('EMAIL_DELIVERY_FAILED', 'Something went wrong sending your message. Please try again or email us directly.', 502);
  }

  return true;
}

module.exports = router;
