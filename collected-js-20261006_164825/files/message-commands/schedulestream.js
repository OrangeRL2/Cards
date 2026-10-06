// message-commands/schedulestream.js
const { nanoid } = require('nanoid');
const StreamEvent = require('../models/StreamEvent');
const streamManager = require('../jobs/streamManager');
const { allowedBossSpawners } = require('../config/permissions');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const QUEUE_GAP_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function nextMidnightJst(now = new Date()) {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const shifted = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate() + 1,
    0, 0, 0, 0
  );
  return new Date(shifted - JST_OFFSET_MS);
}

module.exports = {
  name: 'schedulestream',
  description: 'Schedule a stream for next midnight JST; later ones queue 5 minutes apart.',

  async execute(message, args = []) {
    try {
      const authorId = String(message?.author?.id || '');

      if (!authorId || !allowedBossSpawners.includes(authorId)) {
        return message.reply('You do not have permission to use this command.');
      }

      const requestedTarget = Array.isArray(args)
        ? args.map(a => String(a).trim()).filter(Boolean).join(' ')
        : '';

      if (!requestedTarget) {
        return message.reply('Usage: `!schedulestream <oshi/subunit>`');
      }

      const target = streamManager.resolveStreamTarget(requestedTarget);
      if (!target) {
        return message.reply(`Unknown oshi/subunit/stream: \`${requestedTarget}\`.`);
      }

      const midnight = nextMidnightJst();
      const queueWindowEnd = new Date(midnight.getTime() + DAY_MS);

      const latestScheduled = await StreamEvent.findOne({
        status: 'scheduled',
        spawnAt: { $gte: midnight, $lt: queueWindowEnd },
      })
        .sort({ spawnAt: -1 })
        .lean()
        .exec();

      let spawnAt = midnight;
      if (latestScheduled?.spawnAt) {
        const latestTime = new Date(latestScheduled.spawnAt).getTime();
        if (Number.isFinite(latestTime) && latestTime >= midnight.getTime()) {
          spawnAt = new Date(latestTime + QUEUE_GAP_MS);
        }
      }

      const endsAt = new Date(spawnAt.getTime() + streamManager.eventDurationMs());

      const event = await StreamEvent.create({
        eventId: nanoid(),
        oshiId: target.eventOshiId,
        imageUrl: null,
        spawnAt,
        endsAt,
        status: 'scheduled',
        happiness: 0,
        users: [],
        announceMessageId: null,
        rewardOverrides: {
          scheduledBy: 'schedulestream',
          scheduledByUserId: authorId,
        },
        createdAt: new Date(),
      });

      const unix = Math.floor(spawnAt.getTime() / 1000);
      const offsetMinutes = Math.round((spawnAt.getTime() - midnight.getTime()) / 60000);
      const queueText = offsetMinutes === 0
        ? 'midnight JST'
        : `${offsetMinutes} minutes after midnight JST`;

      return message.reply(
        `Scheduled **${target.label}** for <t:${unix}:F> (<t:${unix}:R>) — ${queueText}. Event: \`${event.eventId}\``
      );
    } catch (err) {
      console.error('[schedulestream] error', err);
      try {
        return message.reply('Failed to schedule stream. Check logs.');
      } catch (_) {}
    }
  },
};
