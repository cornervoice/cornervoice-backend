# Corner Voice — Marketing Backend

Backend for the Corner Voice marketing site's two live features:

1. **`POST /v1/demo/analyze`** — the "Try It Live" page. A prospective client
   pastes in a real review, this calls the actual `analyzeReview()` /
   `generateReply()` pipeline (the same code, same defenses — prompt
   injection resistance, safety-concern escalation, LLM output moderation
   — as the real product), and returns genuine results. No auth, no
   database, nothing persisted.
2. **`POST /v1/contact`** — the contact form. Validates input and sends a
   real email via [Resend](https://resend.com).

This is **not** the full authenticated Corner Voice product backend
(businesses, reviews, billing, etc.) — that's a separate, larger
deployment. This is a small, purpose-built service just for these two
public-facing features.

## Local Development

```bash
npm install
cp .env.example .env
# edit .env — at minimum, add a real ANTHROPIC_API_KEY
npm run dev          # runs on http://localhost:3002
```

The frontend (`cv_website/`) auto-detects `localhost` and points at
`http://localhost:3002` automatically — see `assets/config.js` in the
frontend project. No configuration needed for local testing.

## Deploying

### Step 1 — Deploy this backend

**Render (recommended, has a free tier):**
1. Push this folder to a GitHub repo
2. On [render.com](https://render.com), New → Web Service → connect the repo
3. Render will detect `render.yaml` automatically. If not: Build command
   `npm ci --omit=dev`, Start command `node src/index.js`
4. In the Render dashboard, set these environment variables:
   - `ANTHROPIC_API_KEY` — your real key
   - `ALLOWED_ORIGINS` — your deployed frontend's real URL (see Step 2)
   - `RESEND_API_KEY`, `CONTACT_NOTIFICATION_EMAIL`, `CONTACT_FROM_EMAIL` — see "Email Setup" below
5. Deploy. Note the URL Render gives you (e.g. `https://cornervoice-marketing-backend.onrender.com`)

Railway, Fly.io, or any Node-friendly host work the same way — the only
Render-specific piece is `render.yaml`, which is optional.

### Step 2 — Deploy the frontend

See `cv_website/README.md` for frontend deployment (Netlify/Vercel/GitHub
Pages all work with zero config, since it's static files).

### Step 3 — Connect them

This is the step that's easy to forget, and the site will look broken
(forms silently failing) if skipped:

1. In `cv_website/assets/config.js`, replace
   `https://REPLACE-WITH-YOUR-BACKEND-URL.onrender.com` with your real
   backend URL from Step 1
2. Redeploy the frontend with that change
3. Back in the backend's environment variables (Step 1), set
   `ALLOWED_ORIGINS` to your real frontend URL — **exact match required**,
   including `https://` and no trailing slash (e.g.
   `https://cornervoice.ai`, not `https://cornervoice.ai/`)
4. Redeploy the backend so the new CORS setting takes effect

If you skip step 3, every request from your live frontend will be
blocked by CORS with a 403 — this is intentional (see `src/index.js`),
not a bug, but it means both sides need to actually be told about each
other before this works end to end.

## Email Setup (Contact Form)

**Without this configured, contact form submissions are only logged
server-side — not actually emailed to anyone.** Do this before launch:

1. Sign up free at [resend.com](https://resend.com)
2. Create an API key at resend.com/api-keys
3. For real use, verify your own sending domain (Resend's docs walk
   through the DNS records). For quick testing, their shared
   `onboarding@resend.dev` sender works without domain verification.
4. Set `RESEND_API_KEY`, `CONTACT_NOTIFICATION_EMAIL` (where you want
   submissions sent), and `CONTACT_FROM_EMAIL` in your deployment's
   environment variables.

The code specifically detects unedited placeholder values (like
`re_your_real_key_here`) and treats them as "not configured" rather than
attempting a real API call that would fail confusingly — found and fixed
during testing, see `src/routes/contact.js` for details.

## Bot Mitigation (Try It Live Demo)

The demo endpoint's rate limiting (5/hour/IP) is a first line of defense,
but IP-based limits alone can be bypassed by a determined abuser rotating
through many IPs. [Cloudflare Turnstile](https://dash.cloudflare.com) adds
a second, different kind of check — is this even a real browser being
used by a person — that a distributed low-volume-per-IP abuse attempt
can't solve at scale.

**Without this configured, the demo has no bot protection beyond rate
limiting.** Setup:

1. Sign up free at [dash.cloudflare.com](https://dash.cloudflare.com) — no domain required to start
2. **Turnstile → Add Site** → get a **Site Key** and a **Secret Key**
3. Put the **Site Key** (public, safe to commit) directly in
   `cv_website/try-it.html`, replacing `YOUR_SITE_KEY_HERE`
4. Put the **Secret Key** (private) in this backend's `TURNSTILE_SECRET_KEY`
   environment variable

**Fails open when unconfigured, fails closed when it's actually
triggered** — same philosophy as the Resend email fallback above.
Before you set this up, the demo keeps working (with a loud warning in
the logs) rather than breaking for every visitor. Once configured, a
missing or invalid token is rejected, and if Cloudflare's own
verification service is unreachable, the request is rejected too rather
than assumed safe — an unverifiable request isn't a verified one.

## Security Notes

- **CORS is a strict allowlist**, not `*` — only the origins you
  explicitly configure can call this API.
- **Rate limiting is deliberately tight** on both endpoints (5/hour per
  IP) — these are the only unauthenticated, unauthenticated-cost-incurring
  surfaces in the whole system, unlike the real product's authenticated
  routes.
- **The demo endpoint inherits every defense already built and tested**
  in the real product: prompt injection resistance, the safety-concern
  escalation (a review alleging food safety/injury/hygiene issues never
  gets an automated reply, even in the demo), and the LLM-based output
  moderation pass. Nothing was weakened or bypassed to make the demo work.
- **No data is persisted.** The demo endpoint doesn't write to any
  database — it processes one request and returns.

## Tested

Verified via a full end-to-end test (real backend + real frontend served
separately + real cross-origin browser requests through Playwright, not
just unit tests in isolation):
- Try It page: ordinary review → draft reply rendered correctly
- Try It page: safety-concern review → authentic escalation message shown
  (not a generic error, not a fake draft)
- Try It page: empty-form validation
- Contact form: real cross-origin POST → success state
- All 7 site pages: consistent navigation

**Turnstile bot-check, tested separately (4 paths):**
- Unconfigured → demo still works, warning logged (fail-open confirmed)
- Configured, no token provided → blocked before any network call
- Configured, Cloudflare rejects the token (`success: false`) → blocked,
  tested via direct unit test with a mocked response, since this
  development sandbox's network couldn't reach
  `challenges.cloudflare.com` to test it live end-to-end
- Configured, Cloudflare approves the token (`success: true`) → passes
  through cleanly

Not yet tested: real Anthropic API calls (all testing used a mocked
client — see the main project history for the earlier live-key test of
the underlying `ai.js` logic itself), real Resend email delivery, real
Turnstile verification against Cloudflare's actual API end-to-end
through a browser, or a real production deployment.
