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

// ─── Health Check ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'tiktok-genesys-adapter',
  });
});

// ─── Legal Pages (required for TikTok app submission) ─────────────────────

app.get('/terms', (_req, res) => {
  res.send('<html><body><h1>Terms of Service</h1><p>This is an internal integration between TikTok and Genesys Cloud. For more information, contact the system administrator.</p></body></html>');
});

app.get('/privacy', (_req, res) => {
  res.send('<html><body><h1>Privacy Policy</h1><p>This is an internal integration between TikTok and Genesys Cloud. No personal data is stored. For more information, contact the system administrator.</p></body></html>');
});

// ─── TikTok Site Verification ──────────────────────────────────────────────

app.get('/tiktoksht3qLK0Bmxchx1TPJ7lKcaNE9g2fgim.txt', (_req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=sht3qLK0Bmxchx1TPJ7lKcaNE9g2fgim');
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
