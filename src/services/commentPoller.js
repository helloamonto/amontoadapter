/**
 * Comment Poller — Fallback for TikTok Comment Webhooks
 *
 * TikTok comment webhooks may not be immediately available or reliable,
 * so this poller periodically fetches new comments from recent videos
 * and forwards any unseen ones to Genesys Cloud.
 *
 * Runs on a cron schedule defined by COMMENT_POLL_CRON (default: every 2 minutes).
 */

const cron = require('node-cron');
const tiktok = require('./tiktok');
const genesys = require('./genesys');
const { tiktokCommentToGenesys } = require('../utils/transform');
const logger = require('../utils/logger');

// In-memory store of already-processed comment IDs.
// In production, replace with Redis or a database for persistence across restarts.
const seenCommentIds = new Set();

// Track the timestamp of the last poll to only fetch newer comments
let lastPollTime = Math.floor(Date.now() / 1000) - 120; // last 2 minutes on first run

class CommentPoller {
  constructor() {
    this.task = null;
    this.isRunning = false;
  }

  start() {
    const cronExpr = process.env.COMMENT_POLL_CRON || '*/2 * * * *';

    if (!cron.validate(cronExpr)) {
      logger.error('Invalid COMMENT_POLL_CRON expression', { cronExpr });
      return;
    }

    this.task = cron.schedule(cronExpr, async () => {
      if (this.isRunning) {
        logger.debug('Comment poll already running — skipping this tick');
        return;
      }
      this.isRunning = true;
      try {
        await this._poll();
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('Comment poller started', { cron: cronExpr });
  }

  stop() {
    if (this.task) {
      this.task.destroy();
      logger.info('Comment poller stopped');
    }
  }

  async _poll() {
    const pollStartTime = Math.floor(Date.now() / 1000);

    try {
      const videos = await tiktok.listVideos({ count: 10 });
      if (!videos || videos.length === 0) {
        logger.debug('No videos found for comment polling');
        return;
      }

      for (const video of videos) {
        await this._pollCommentsForVideo(video.id, lastPollTime);
      }

      lastPollTime = pollStartTime;
    } catch (err) {
      logger.error('Comment poll failed', { error: err.message });
    }
  }

  async _pollCommentsForVideo(videoId, since) {
    try {
      const result = await tiktok.listComments({ videoId, count: 50 });
      const comments = result?.data?.comments || [];

      for (const comment of comments) {
        const commentCreateTime = comment.create_time || 0;

        // Only process new comments
        if (commentCreateTime < since) continue;
        if (seenCommentIds.has(comment.id)) continue;

        seenCommentIds.add(comment.id);
        // Keep set from growing unboundedly
        if (seenCommentIds.size > 10000) {
          const oldest = seenCommentIds.values().next().value;
          seenCommentIds.delete(oldest);
        }

        logger.info('New TikTok comment found via polling', {
          videoId,
          commentId: comment.id,
          userId: comment.user_id,
        });

        // Build a synthetic payload matching the webhook shape
        const syntheticPayload = {
          event: 'comment_received',
          create_time: commentCreateTime,
          content: {
            comment_id: comment.id,
            video_id: videoId,
            user_id: comment.user_id,
            username: comment.username,
            comment: comment.text,
            text: comment.text,
            create_time: commentCreateTime,
          },
        };

        const genesysBody = tiktokCommentToGenesys(syntheticPayload);
        await genesys.sendInboundMessage(genesysBody);
      }
    } catch (err) {
      logger.error('Failed to poll comments for video', { videoId, error: err.message });
    }
  }
}

module.exports = new CommentPoller();
