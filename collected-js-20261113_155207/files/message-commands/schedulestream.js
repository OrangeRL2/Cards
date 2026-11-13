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


// --delay=N is an explicit minute offset from the next midnight JST.
// Without the flag, keep the existing five-minute automatic queue.
function parseTargetAndDelay(args) {
  const tokens = Array.isArray(args) ? args.map(x => String(x).trim()).filter(Boolean) : [];
  const targetTokens = [];
  let delayMinutes = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^--delay(?:=|$)/i.test(token)) {
      if (delayMinutes !== null) throw new Error('Specify --delay only once.');
      let raw = /^--delay$/i.test(token) ? tokens[++i] : token.slice(token.indexOf('=') + 1);
      raw = String(raw ?? '').replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
      if (!/^\d+$/.test(raw) || Number(raw) > 1439) {
        throw new Error('--delay must be an integer from 0 to 1439 minutes after midnight JST.');
      }
      delayMinutes = Number(raw);
    } else {
      targetTokens.push(token);
    }
  }

  return { requestedTarget: targetTokens.join(' '), delayMinutes };
}

module.exports = {
  name: 'schedulestream',
  description: 'Schedule at next midnight JST; --delay=N overrides automatic five-minute queue.',

  async execute(message, args = []) {
    try {
      const authorId = String(message?.author?.id || '');

      if (!authorId || !allowedBossSpawners.includes(authorId)) {
        return message.reply('You do not have permission to use this command.');
      }

      const { requestedTarget, delayMinutes } = parseTargetAndDelay(args);

      if (!requestedTarget) {
        return message.reply('Usage: `!schedulestream <oshi/subunit> [--delay=minutes]`');
      }

      const target = streamManager.resolveStreamTarget(requestedTarget);
      if (!target) {
        return message.reply(`Unknown oshi/subunit/stream: \`${requestedTarget}\`.`);
      }

      const midnight = nextMidnightJst();
      const queueWindowEnd = new Date(midnight.getTime() + DAY_MS);

      let spawnAt;
      if (delayMinutes !== null) {
        // Manual delay chooses an exact JST-midnight offset, even if other streams share it.
        spawnAt = new Date(midnight.getTime() + delayMinutes * 60 * 1000);
      } else {
        const latestScheduled = await StreamEvent.findOne({
          status: 'scheduled',
          spawnAt: { $gte: midnight, $lt: queueWindowEnd },
        })
          .sort({ spawnAt: -1 })
          .lean()
          .exec();

        spawnAt = midnight;
        if (latestScheduled?.spawnAt) {
          const latestTime = new Date(latestScheduled.spawnAt).getTime();
          if (Number.isFinite(latestTime) && latestTime >= midnight.getTime()) {
            spawnAt = new Date(latestTime + QUEUE_GAP_MS);
          }
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
          ...(delayMinutes !== null ? { manualDelayMinutes: delayMinutes } : {}),
        },
        createdAt: new Date(),
      });

      const unix = Math.floor(spawnAt.getTime() / 1000);
      const offsetMinutes = Math.round((spawnAt.getTime() - midnight.getTime()) / 60000);
      const queueText = delayMinutes !== null
        ? `manual delay: ${delayMinutes} minutes after midnight JST`
        : (offsetMinutes === 0 ? 'midnight JST' : `${offsetMinutes} minutes after midnight JST`);

      return message.reply(
        `Scheduled **${target.label}** for <t:${unix}:F> (<t:${unix}:R>) — ${queueText}. Event: \`${event.eventId}\``
      );
    } catch (err) {
      console.error('[schedulestream] error', err);
      try {
        return message.reply(`Cannot schedule stream: ${err.message}`);
      } catch (_) {}
    }
  },
};
