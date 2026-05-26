/**
 * Cryptographic helpers for webhook signature verification.
 */
const crypto = require('crypto');
const logger = require('./logger');

/**
 * Verify Genesys Cloud outbound webhook signature.
 * Genesys sends: X-Hub-Signature-256: sha256=<hmac>
 *
 * @param {string} rawBody   - Raw request body string
 * @param {string} signature - Value of X-Hub-Signature-256 header
 * @param {string} secret    - GENESYS_WEBHOOK_SECRET from env
 * @returns {boolean}
 */
function verifyGenesysSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    logger.error('Genesys signature verification error', { err: err.message });
    return false;
  }
}

/**
 * Verify TikTok webhook signature.
 * TikTok sends the HMAC-SHA256 of the raw body using the client secret.
 * Header: X-Tiktok-Signature: sha256=<hmac>
 *
 * @param {string} rawBody   - Raw request body string
 * @param {string} signature - Value of X-Tiktok-Signature header
 * @param {string} secret    - TIKTOK_CLIENT_SECRET from env
 * @returns {boolean}
 */
function verifyTikTokSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    logger.error('TikTok signature verification error', { err: err.message });
    return false;
  }
}

module.exports = { verifyGenesysSignature, verifyTikTokSignature };
