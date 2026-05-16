/**
 * TikTok Webhook Route Handler
 *
 * Receives inbound events from TikTok (DMs and comments),
 * validates signatures, transforms payloads, and forwards to Genesys.
 *
 * Registered endpoints:
 *  GET  /webhook/tiktok  — TikTok webhook verification challenge
 *  POST /webhook/tiktok  — TikTok event delivery
 */

const express = require('express');
const router = express.Router();

const { verifyTikTokSignature } = require('../utils/crypto');
const { tiktokDMToGenesys, tiktokCommentToGenesys } = require('../utils/transform');
const genesys = require('../services/genesys');
const logger = require('../utils/logger');

// ─── Webhook Verification (GET) ────────────────────────────────────────────

/**
 * TikTok calls this endpoint to verify your webhook URL.
 * It sends ?challenge=<random_string> and expects you to echo it back
 * along with a signed response.
 */
router.get('/', (req, res) => {
  const challenge = req.query.challenge;
  const verifyToken = req.query.token || req.query.verify_token;

  if (!challenge) {
    return res.status(400).json({ error: 'Missing challenge parameter' });
  }

  // Optionally validate the verify token
  if (
    process.env.TIKTOK_WEBHOOK_VERIFY_TOKEN &&
    verifyToken !== process.env.TIKTOK_WEBHOOK_VERIFY_TOKEN
  ) {
    logger.warn('TikTok webhook verification failed: wrong verify token');
    return res.status(403).json({ error: 'Invalid verify token' });
  }

  logger.info('TikTok webhook verified successfully');
  // TikTok expects the challenge echoed back as plain text or JSON
  return res.status(200).send(challenge);
});

// ─── Event Delivery (POST) ─────────────────────────────────────────────────

router.post('/', async (req, res) => {
  // Respond 200 immediately — TikTok requires this within a short timeout
  res.status(200).json({ received: true });

  // --- Signature Verification ---
  const rawBody = req.rawBody; // populated by middleware in index.js
  const signature = req.headers['x-tiktok-signature'];

  if (process.env.TIKTOK_CLIENT_SECRET && signature) {
    if (!verifyTikTokSignature(rawBody, signature, process.env.TIKTOK_CLIENT_SECRET)) {
      logger.warn('TikTok webhook signature mismatch — ignoring event');
      return;
    }
  } else {
    logger.warn('TikTok webhook received without signature — proceeding (configure secret in prod)');
  }

  const payload = req.body;
  const event = payload.event;

  logger.info('TikTok webhook event received', { event, createTime: payload.create_time });

  try {
    switch (event) {
      case 'direct_message_received':
      case 'message_received':
        await handleDMReceived(payload);
        break;

      case 'comment_received':
      case 'video_comment':
        await handleCommentReceived(payload);
        break;

      default:
        logger.debug('Unhandled TikTok event type', { event });
    }
  } catch (err) {
    logger.error('Error processing TikTok webhook event', {
      event,
      error: err.message,
    });
  }
});

// ─── Handlers ──────────────────────────────────────────────────────────────

async function handleDMReceived(payload) {
  const genesysBody = tiktokDMToGenesys(payload);
  logger.debug('Forwarding TikTok DM to Genesys', { channelId: genesysBody.channel.id });
  await genesys.sendInboundMessage(genesysBody);
}

async function handleCommentReceived(payload) {
  const content = payload.content || {};

  // TikTok comments may go through a review process before appearing in API.
  // Log and forward to Genesys regardless — agent can moderate from there.
  const genesysBody = tiktokCommentToGenesys(payload);
  logger.debug('Forwarding TikTok comment to Genesys', {
    channelId: genesysBody.channel.id,
    commentId: content.comment_id,
  });
  await genesys.sendInboundMessage(genesysBody);
}

module.exports = router;
