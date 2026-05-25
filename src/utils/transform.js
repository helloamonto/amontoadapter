/**
 * Message format transformers between TikTok and Genesys Cloud Open Messaging.
 *
 * TikTok inbound DM webhook payload shape:
 * {
 *   "client_key": "...",
 *   "event": "direct_message_received",
 *   "create_time": 1700000000,
 *   "content": {
 *     "message_id": "...",
 *     "conversation_id": "...",
 *     "from_user_id": "...",
 *     "to_user_id": "...",
 *     "message": { "type": "text", "content": "Hello" }
 *   }
 * }
 *
 * TikTok inbound Comment webhook payload shape:
 * {
 *   "client_key": "...",
 *   "event": "comment_received",
 *   "create_time": 1700000000,
 *   "content": {
 *     "comment_id": "...",
 *     "video_id": "...",
 *     "user_id": "...",
 *     "comment": "Nice video!",
 *     "create_time": 1700000000
 *   }
 * }
 *
 * Genesys Open Messaging inbound message body shape:
 * {
 *   "channel": {
 *     "id": "<conversation_id or comment_id>",
 *     "platform": "Open",
 *     "type": "Private" | "Public",
 *     "messageId": "<tiktok_message_id>",
 *     "to": { "id": "<genesys_integration_id>" },
 *     "from": { "id": "<tiktok_user_id>", "displayName": "<display_name>" }
 *   },
 *   "type": "Text",
 *   "text": "<message text>",
 *   "originatingEntity": "Human",
 *   "metadata": {
 *     "customAttributes": { "source": "tiktok_dm" | "tiktok_comment", "videoId": "..." }
 *   }
 * }
 */

const INTEGRATION_ID = () => process.env.GENESYS_INTEGRATION_ID;

/**
 * Transform a TikTok DM webhook event into a Genesys Open Messaging body.
 */
function tiktokDMToGenesys(payload) {
  const { content } = payload;
  const msg = content.message || {};
  const text = msg.content || msg.text || '[unsupported message type]';

  return {
    channel: {
      id: content.conversation_id,
      platform: 'Open',
      type: 'Private',
      messageId: content.message_id,
      to: { id: INTEGRATION_ID() },
      from: {
        id: content.from_user_id,
        idType: 'Opaque',
        firstName: content.from_username || content.from_user_id,
      },
    },
    type: 'Text',
    text,
    originatingEntity: 'Human',
  };
}

/**
 * Transform a TikTok comment webhook event into a Genesys Open Messaging body.
 * Comments are treated as "Public" channel messages with videoId in metadata.
 */
function tiktokCommentToGenesys(payload) {
  const { content } = payload;

  return {
    channel: {
      // Use videoId + userId as a stable conversation thread ID for comments
      id: `comment_${content.video_id}_${content.user_id}`,
      platform: 'Open',
      type: 'Public',
      messageId: content.comment_id,
      to: { id: INTEGRATION_ID() },
      from: {
        id: content.user_id,
        idType: 'Opaque',
        nickname: content.username || content.user_id,
      },
    },
    type: 'Text',
    text: content.comment || content.text || '',
    originatingEntity: 'Human',
    metadata: {
      customAttributes: {
        source: 'tiktok_comment',
        tiktokVideoId: content.video_id,
        tiktokCommentId: content.comment_id,
      },
    },
  };
}

/**
 * Parse a Genesys outbound webhook notification and extract what we need
 * to reply back to TikTok.
 *
 * Genesys outbound payload shape (simplified):
 * {
 *   "id": "<notification_id>",
 *   "channel": {
 *     "id": "<same conversation id we sent>",
 *     "type": "Private" | "Public",
 *     "from": { "id": "<genesys_agent_id>", "displayName": "Agent Name" },
 *     "to": { "id": "<customer_tiktok_user_id>" }
 *   },
 *   "type": "Text",
 *   "text": "Agent reply text",
 *   "metadata": { "customAttributes": { "source": "tiktok_dm", ... } }
 * }
 */
function genesysOutboundToTikTok(payload) {
  const channel = payload.channel || {};
  const customAttrs = (payload.metadata && payload.metadata.customAttributes) || {};

  return {
    source: customAttrs.source || 'tiktok_dm',
    recipientUserId: channel.to && channel.to.id,
    conversationId: customAttrs.tiktokConversationId || channel.id,
    videoId: customAttrs.tiktokVideoId,
    commentId: customAttrs.tiktokCommentId,
    text: payload.text || '',
  };
}

module.exports = {
  tiktokDMToGenesys,
  tiktokCommentToGenesys,
  genesysOutboundToTikTok,
};
