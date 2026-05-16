/**
 * Genesys Cloud Outbound Webhook Route Handler
 *
 * Receives outbound messages (agent replies) from Genesys Cloud,
 * validates HMAC signatures, and delivers replies back to TikTok
 * via DM or comment reply depending on the channel source.
 *
 * Registered endpoint:
 *  POST /webhook/genesys
 */

const express = require('express');
const router = express.Router();

const { verifyGenesysSignature } = require('../utils/crypto');
const { genesysOutboundToTikTok } = require('../utils/transform');
const tiktok = require('../services/tiktok');
const logger = require('../utils/logger');

router.post('/', async (req, res) => {
  // --- Signature Verification ---
  const rawBody = req.rawBody;
  const signature = req.headers['x-hub-signature-256'];
  const secret = process.env.GENESYS_WEBHOOK_SECRET;

  if (secret) {
    if (!verifyGenesysSignature(rawBody, signature, secret)) {
      logger.warn('Genesys outbound webhook signature mismatch — rejecting');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } else {
    logger.warn('GENESYS_WEBHOOK_SECRET not set — skipping signature check');
  }

  // Acknowledge immediately
  res.status(200).json({ received: true });

  const payload = req.body;
  logger.info('Genesys outbound webhook received', {
    type: payload.type,
    channelId: payload.channel?.id,
  });

  // Only process Text messages from agents
  if (payload.type !== 'Text' || !payload.text) {
    logger.debug('Ignoring non-text or empty Genesys outbound message', { type: payload.type });
    return;
  }

  // Ignore messages originating from the customer (would create a loop)
  if (payload.originatingEntity === 'Human') {
    logger.debug('Ignoring customer-originated message reflected by Genesys');
    return;
  }

  try {
    const { source, recipientUserId, conversationId, videoId, commentId, text } =
      genesysOutboundToTikTok(payload);

    if (source === 'tiktok_comment' && videoId && commentId) {
      logger.info('Sending TikTok comment reply', { videoId, commentId });
      await tiktok.replyToComment({ videoId, commentId, text });
    } else {
      // Default: send as a DM
      if (!recipientUserId) {
        logger.error('Cannot send TikTok DM — missing recipientUserId', { payload });
        return;
      }
      logger.info('Sending TikTok DM reply', { recipientUserId });
      await tiktok.sendDM({ recipientUserId, text, conversationId });
    }
  } catch (err) {
    logger.error('Failed to deliver Genesys reply to TikTok', { error: err.message });
  }
});

module.exports = router;
