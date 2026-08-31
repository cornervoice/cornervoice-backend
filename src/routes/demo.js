const router = require('express').Router();
const { analyzeReview, generateReply } = require('../services/ai');
const { ok, errorResponse, AppError } = require('../lib/response');
const logger = require('../lib/logger');

const MAX_REVIEW_LENGTH = 1500; // generous for a real review, cheap to cap for cost control
const MAX_BUSINESS_NAME_LENGTH = 100;

const VALID_TONES = ['professional', 'friendly', 'empathetic', 'apologetic'];

// POST /v1/demo/analyze
// Public, unauthenticated, no persistence. Takes a review a prospective
// client pastes in and runs it through the real analysis + reply pipeline,
// so what they see is genuinely representative of the product — not a
// simplified or fake version of it.
router.post('/analyze', async (req, res, next) => {
  try {
    const { reviewText, rating, businessName, businessCategory, tone } = req.body || {};

    if (!reviewText || typeof reviewText !== 'string' || !reviewText.trim()) {
      throw new AppError('MISSING_REVIEW', 'Please paste in a review to analyze.', 400);
    }
    if (reviewText.length > MAX_REVIEW_LENGTH) {
      throw new AppError('REVIEW_TOO_LONG', `Reviews are limited to ${MAX_REVIEW_LENGTH} characters for the demo.`, 400);
    }
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new AppError('INVALID_RATING', 'Please provide a star rating from 1 to 5.', 400);
    }
    if (businessName && (typeof businessName !== 'string' || businessName.length > MAX_BUSINESS_NAME_LENGTH)) {
      throw new AppError('INVALID_BUSINESS_NAME', 'Business name is too long.', 400);
    }
    const selectedTone = VALID_TONES.includes(tone) ? tone : 'professional';

    const demoBusiness = {
      name: (businessName || 'Your Business').trim(),
      category: (businessCategory || 'local business').trim(),
      city: 'your area',
    };

    // Synthetic review object matching the shape analyzeReview()/generateReply()
    // expect — no database row exists for this, it's purely in-memory for
    // the duration of this one request.
    const demoReview = {
      id: `demo-${Date.now()}`,
      platform: 'demo',
      rating: ratingNum,
      review_text: reviewText.trim(),
      author_name: 'Demo Reviewer',
    };

    logger.info('Demo analyze request', { ip: req.ip, rating: ratingNum, length: reviewText.length });

    const analysis = await analyzeReview(demoReview);

    // isAutomated: true is deliberate here, not an oversight — the demo
    // should authentically show the safety-escalation refusal when it
    // triggers, the same way the real automated pipeline would, rather
    // than quietly bypassing it to always show a reply. That refusal IS
    // the product working correctly, and it's worth a prospective client
    // seeing it happen.
    let replyResult = null;
    let escalatedForSafety = false;

    try {
      replyResult = await generateReply({
        review: { ...demoReview, ...analysis },
        business: demoBusiness,
        tone: selectedTone,
        isAutomated: true,
      });
    } catch (err) {
      if (err.code === 'SAFETY_ESCALATION_REQUIRED') {
        escalatedForSafety = true;
      } else {
        throw err;
      }
    }

    ok(res, {
      analysis: {
        sentiment: analysis.sentiment,
        urgency: analysis.urgency,
        topics: analysis.topics,
        ai_summary: analysis.ai_summary,
        safety_concern: analysis.safety_concern,
        safety_reason: analysis.safety_reason,
      },
      reply: escalatedForSafety ? null : {
        draft: replyResult.draft,
        flaggedForHumanReview: replyResult.flaggedForHumanReview,
        moderationExplanation: replyResult.moderationExplanation,
      },
      escalatedForSafety,
    });

  } catch (err) {
    if (err instanceof AppError) return errorResponse(res, err);
    logger.error('Demo analyze failed', { error: err.message });
    next(err);
  }
});

module.exports = router;
