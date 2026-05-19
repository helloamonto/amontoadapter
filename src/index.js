/**
 * TikTok ↔ Genesys Cloud Open Messaging Adapter
 * Entry point — bootstraps Express server, middleware, routes, and pollers.
 */

require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const tiktokRouter = require('./routes/tiktok');
const genesysRouter = require('./routes/genesys');
const commentPoller = require('./services/commentPoller');

// ─── Validate Required Environment Variables ───────────────────────────────

const REQUIRED_ENV = [
  'TIKTOK_CLIENT_KEY',
  'TIKTOK_CLIENT_SECRET',
  'TIKTOK_BUSINESS_ID',
  'GENESYS_CLIENT_ID',
  'GENESYS_CLIENT_SECRET',
  'GENESYS_BASE_URL',
  'GENESYS_INTEGRATION_ID',
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// ─── Express App ───────────────────────────────────────────────────────────

const app = express();

/**
 * Raw body capture middleware.
 * We need the raw body string for HMAC signature verification
 * on both TikTok and Genesys webhooks.
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// ─── Static Files (TikTok verification files, etc.) ───────────────────────
app.use(express.static(require('path').join(__dirname, '../public')));

// ─── Health Check ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'tiktok-genesys-adapter',
  });
});

// ─── Landing Page ──────────────────────────────────────────────────────────

const SHARED_STYLE = `
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f8fafc; color: #0f172a; line-height: 1.7; }
    header { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 0 2rem; display: flex;
             align-items: center; gap: 1rem; height: 64px; }
    header .logo { font-size: 1.25rem; font-weight: 700; color: #0f172a; text-decoration: none; }
    header .logo span { color: #0ea5e9; }
    header nav { margin-left: auto; display: flex; gap: 1.5rem; }
    header nav a { font-size: 0.9rem; color: #64748b; text-decoration: none; }
    header nav a:hover { color: #0ea5e9; }
    main { max-width: 780px; margin: 3rem auto; padding: 0 1.5rem 4rem; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
    h2 { font-size: 1.2rem; font-weight: 600; margin: 2rem 0 0.5rem; color: #0f172a; }
    p, li { color: #334155; margin-bottom: 0.75rem; }
    ul { padding-left: 1.25rem; }
    .pill { display: inline-block; background: #e0f2fe; color: #0369a1; font-size: 0.78rem;
            font-weight: 600; padding: 0.2rem 0.6rem; border-radius: 999px; margin-bottom: 1rem; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
             padding: 2rem; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.5rem; }
    .feature { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.25rem; }
    .feature h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.35rem; }
    .feature p { font-size: 0.875rem; color: #64748b; margin: 0; }
    footer { text-align: center; padding: 2rem; font-size: 0.8rem; color: #94a3b8; }
    a { color: #0ea5e9; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } h1 { font-size: 1.5rem; } }
  </style>
`;

app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en">
<head>${SHARED_STYLE}<title>TikTok Business Messaging for Genesys Cloud</title></head>
<body>
<header>
  <a class="logo" href="/">Amonto<span>.</span></a>
  <nav>
    <a href="/health">Status</a>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
  </nav>
</header>
<main>
  <span class="pill">TikTok Developer App</span>
  <h1>TikTok Business Messaging<br/>for Genesys Cloud</h1>
  <p>A middleware adapter that bridges TikTok Business Messaging — Direct Messages and Post Comments — with Genesys Cloud Open Messaging, enabling contact centre agents to handle TikTok customer conversations natively inside Genesys Cloud.</p>

  <div class="grid">
    <div class="feature">
      <h3>Inbound Messages</h3>
      <p>TikTok DMs and Post Comments are routed in real time to your Genesys Cloud queue.</p>
    </div>
    <div class="feature">
      <h3>Agent Replies</h3>
      <p>Agent responses from Genesys Cloud are delivered back to TikTok users via the Business Messaging API.</p>
    </div>
    <div class="feature">
      <h3>Comment Polling</h3>
      <p>A cron-based fallback polls for new comments every 2 minutes where webhooks are unavailable.</p>
    </div>
    <div class="feature">
      <h3>Secure by Default</h3>
      <p>All webhook payloads are verified with HMAC-SHA256 signatures. OAuth tokens rotate automatically.</p>
    </div>
  </div>

  <div class="card" style="margin-top:2rem;">
    <h2 style="margin-top:0">Contact</h2>
    <p>For support or enquiries, contact us at <a href="mailto:lek@amonto.co.th">nsutthaphol@gmail.com</a>.</p>
  </div>
</main>
<footer>&copy; ${new Date().getFullYear()} Amonto. All rights reserved. &nbsp;&middot;&nbsp; <a href="/terms">Terms of Service</a> &nbsp;&middot;&nbsp; <a href="/privacy">Privacy Policy</a></footer>
</body></html>`);
});

// ─── Legal Pages (required for TikTok app submission) ─────────────────────

app.get('/terms', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en">
<head>${SHARED_STYLE}<title>Terms of Service — Amonto</title></head>
<body>
<header>
  <a class="logo" href="/">Amonto<span>.</span></a>
  <nav><a href="/privacy">Privacy Policy</a></nav>
</header>
<main>
  <h1>Terms of Service</h1>
  <p style="color:#64748b;margin-bottom:2rem;">Effective Date: 19 May 2026</p>

  <h2>1. Acceptance of Terms</h2>
  <p>By installing, accessing, or using TikTok Business Messaging for Genesys Cloud (the &ldquo;Service&rdquo;), you agree to be bound by these Terms. If you do not agree, do not use the Service.</p>

  <h2>2. Description of the Service</h2>
  <p>The Service is a middleware adapter that routes TikTok Business Messages and Post Comments to Genesys Cloud Open Messaging. It is a technical integration layer and does not provide TikTok or Genesys Cloud accounts.</p>

  <h2>3. Eligibility</h2>
  <p>To use the Service you must hold a valid TikTok Developer Account with Business Messaging API access, an active Genesys Cloud organisation with digital messaging enabled, and be authorised to bind your organisation to these Terms.</p>

  <h2>4. Permitted Use</h2>
  <p>You may use the Service solely to route TikTok Direct Messages and Post Comments to Genesys Cloud and to deliver agent replies back to TikTok users. You may not use the Service to spam users, circumvent TikTok policies, or harvest data beyond what is necessary for message routing.</p>

  <h2>5. TikTok Platform Compliance</h2>
  <p>You agree to comply with TikTok&rsquo;s Developer Terms of Service, Community Guidelines, and Platform Policies at all times, and to use the Service only in regions where the TikTok Business Messaging API is available.</p>

  <h2>6. Intellectual Property</h2>
  <p>The Service and all associated software are the property of Amonto. You retain ownership of all message content transmitted through the Service.</p>

  <h2>7. Data Handling</h2>
  <p>The Service acts as a pass-through routing layer. Please refer to our <a href="/privacy">Privacy Policy</a> for full details on data collection, use, and retention.</p>

  <h2>8. Disclaimer of Warranties</h2>
  <p>THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTY OF ANY KIND. AMONTO DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE.</p>

  <h2>9. Limitation of Liability</h2>
  <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, AMONTO SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES ARISING OUT OF YOUR USE OF THE SERVICE.</p>

  <h2>10. Changes to These Terms</h2>
  <p>Amonto may modify these Terms at any time by updating the effective date. Continued use constitutes acceptance of the revised Terms.</p>

  <h2>11. Contact</h2>
  <p>Questions? Email us at <a href="mailto:nsutthaphol@gmail.com">nsutthaphol@gmail.com</a>.</p>
</main>
<footer>&copy; ${new Date().getFullYear()} Amonto. &nbsp;&middot;&nbsp; <a href="/">Home</a> &nbsp;&middot;&nbsp; <a href="/privacy">Privacy Policy</a></footer>
</body></html>`);
});

app.get('/privacy', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en">
<head>${SHARED_STYLE}<title>Privacy Policy — Amonto</title></head>
<body>
<header>
  <a class="logo" href="/">Amonto<span>.</span></a>
  <nav><a href="/terms">Terms of Service</a></nav>
</header>
<main>
  <h1>Privacy Policy</h1>
  <p style="color:#64748b;margin-bottom:2rem;">Effective Date: 19 May 2026</p>

  <h2>1. Overview</h2>
  <p>This Privacy Policy describes how Amonto handles information when you use TikTok Business Messaging for Genesys Cloud (the &ldquo;Service&rdquo;). The Service is a middleware adapter that routes TikTok messages to Genesys Cloud Open Messaging.</p>

  <h2>2. Data We Process</h2>
  <p>The Service processes the following data in transit:</p>
  <ul>
    <li>TikTok user identifiers included in webhook payloads</li>
    <li>Message content: text of Direct Messages and Post Comments</li>
    <li>Conversation metadata: timestamps, message IDs, video IDs, comment IDs</li>
    <li>Agent replies sent from Genesys Cloud back to TikTok users</li>
  </ul>
  <p>We do not collect names, email addresses, phone numbers, or payment information.</p>

  <h2>3. How We Use Data</h2>
  <p>Data is used solely to route inbound TikTok messages to Genesys Cloud, deliver agent replies to TikTok users, and maintain operational logs for service reliability. We do not use message content for advertising or profiling.</p>

  <h2>4. Data Sharing</h2>
  <p>Data is transmitted to TikTok (via the Business Messaging API) and Genesys Cloud (via Open Messaging API) as required to deliver the Service. We do not sell or share personal data with other third parties.</p>

  <h2>5. Data Retention</h2>
  <p>Message content is processed in transit and is not persistently stored beyond operational log files, which are retained for up to 30 days for debugging purposes.</p>

  <h2>6. Security</h2>
  <p>All webhook payloads are verified with HMAC-SHA256 signatures. All API communication requires HTTPS. OAuth 2.0 tokens are rotated automatically.</p>

  <h2>7. Your Rights</h2>
  <p>Depending on your location, you or your end users may have rights to access, correct, or delete personal data. Requests from end users should be directed to you as the data controller. Contact us and we will assist in responding.</p>

  <h2>8. Changes to This Policy</h2>
  <p>We may update this policy from time to time. The effective date at the top of this page will reflect any changes.</p>

  <h2>9. Contact</h2>
  <p>Privacy questions? Email us at <a href="mailto:nsutthaphol@gmail.com">nsutthaphol@gmail.com</a>.</p>
</main>
<footer>&copy; ${new Date().getFullYear()} Amonto. &nbsp;&middot;&nbsp; <a href="/">Home</a> &nbsp;&middot;&nbsp; <a href="/terms">Terms of Service</a></footer>
</body></html>`);
});

// ─── TikTok Site Verification ──────────────────────────────────────────────

app.get('/tiktoksht3qLK0Bmxchx1TPJ7lKcaNE9g2fgim.txt', (_req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=sht3qLK0Bmxchx1TPJ7lKcaNE9g2fgim');
});

app.get('/tiktokcrcfh2ayqPNBjLNmYDIZjMpdKFH3wJEK.txt', (_req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=crcfh2ayqPNBjLNmYDIZjMpdKFH3wJEK');
});

app.get('/tiktokNNxqLC6ZX2ep8SmTcBJLVkAd0AkqZ3qW.txt', (_req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=NNxqLC6ZX2ep8SmTcBJLVkAd0AkqZ3qW');
});

// ─── Webhook Routes ────────────────────────────────────────────────────────

// TikTok webhook: receives inbound events (DMs, comments)
app.use('/webhook/tiktok', tiktokRouter);

// Genesys webhook: receives outbound messages (agent replies)
app.use('/webhook/genesys', genesysRouter);

// ─── 404 Handler ──────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global Error Handler ──────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 3000;

app.listen(PORT, () => {
  logger.info(`TikTok-Genesys adapter listening on port ${PORT}`);
  logger.info('Webhook endpoints:');
  logger.info(`  TikTok  → POST /webhook/tiktok`);
  logger.info(`  Genesys → POST /webhook/genesys`);

  // Start the comment poller (polls TikTok API for new comments as a fallback)
  commentPoller.start();
});

// ─── Graceful Shutdown ─────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  commentPoller.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app; // exported for testing
