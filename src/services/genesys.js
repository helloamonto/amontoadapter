/**
 * Genesys Cloud Open Messaging client.
 *
 * Handles:
 *  - OAuth 2.0 token management (Client Credentials grant)
 *  - Sending inbound messages to Genesys Cloud Open Messaging API
 *  - Sending typing indicators / delivery receipts
 *
 * References:
 *  - https://developer.genesys.cloud/api/digital/openmessaging/
 *  - https://developer.genesys.cloud/commdigital/digital/openmessaging/inboundMessages
 */

const axios = require('axios');
const logger = require('../utils/logger');

class GenesysClient {
  constructor() {
    this.clientId = process.env.GENESYS_CLIENT_ID;
    this.clientSecret = process.env.GENESYS_CLIENT_SECRET;
    this.baseUrl = (process.env.GENESYS_BASE_URL || 'https://api.mypurecloud.com').replace(/\/$/, '');
    this.integrationId = process.env.GENESYS_INTEGRATION_ID;

    this._accessToken = null;
    this._tokenExpiresAt = null;

    // Derive auth URL from base URL (login subdomain)
    // e.g. https://api.mypurecloud.com -> https://login.mypurecloud.com
    this._authBase = this.baseUrl.replace('https://api.', 'https://login.');
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async _fetchToken() {
    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await axios.post(
        `${this._authBase}/oauth/token`,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      this._accessToken = res.data.access_token;
      this._tokenExpiresAt = Date.now() + (res.data.expires_in - 60) * 1000;
      logger.info('Genesys Cloud access token refreshed', { expiresIn: res.data.expires_in });
    } catch (err) {
      logger.error('Failed to fetch Genesys access token', {
        error: err.response?.data || err.message,
      });
      throw err;
    }
  }

  async _getToken() {
    if (!this._accessToken || Date.now() >= this._tokenExpiresAt) {
      await this._fetchToken();
    }
    return this._accessToken;
  }

  async _headers() {
    const token = await this._getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // ─── Inbound Message ───────────────────────────────────────────────────────

  /**
   * Send an inbound message (from customer) to Genesys Cloud.
   * Genesys will route it to the correct queue / agent.
   *
   * @param {object} messageBody - Genesys normalized message body (from transform.js)
   */
  async sendInboundMessage(messageBody) {
    const headers = await this._headers();
    const url = `${this.baseUrl}/api/v2/conversations/messages/${this.integrationId}/inbound/open/message`;

    try {
      const res = await axios.post(url, messageBody, { headers });
      logger.info('Inbound message sent to Genesys', {
        channelId: messageBody.channel?.id,
        status: res.status,
      });
      return res.data;
    } catch (err) {
      logger.error('Failed to send inbound message to Genesys', {
        error: err.response?.data || err.message,
        body: messageBody,
      });
      throw err;
    }
  }

  /**
   * Send a typing indicator event.
   *
   * @param {object} eventBody - Genesys normalized event body
   */
  async sendTypingEvent(eventBody) {
    const headers = await this._headers();
    const url = `${this.baseUrl}/api/v2/conversations/messages/${this.integrationId}/inbound/open/event`;

    try {
      const res = await axios.post(url, eventBody, { headers });
      logger.debug('Typing event sent to Genesys', { status: res.status });
      return res.data;
    } catch (err) {
      logger.warn('Failed to send typing event to Genesys', { error: err.message });
      // Non-fatal — don't rethrow
    }
  }

  /**
   * Send a delivery receipt.
   *
   * @param {object} receiptBody - Genesys normalized receipt body
   */
  async sendReceipt(receiptBody) {
    const headers = await this._headers();
    const url = `${this.baseUrl}/api/v2/conversations/messages/${this.integrationId}/inbound/open/receipt`;

    try {
      const res = await axios.post(url, receiptBody, { headers });
      logger.debug('Receipt sent to Genesys', { status: res.status });
      return res.data;
    } catch (err) {
      logger.warn('Failed to send receipt to Genesys', { error: err.message });
      // Non-fatal
    }
  }
}

module.exports = new GenesysClient();
