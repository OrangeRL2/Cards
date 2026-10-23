const { nanoid } = require('nanoid');
const StreamEvent = require('../models/StreamEvent');
const streamManager = require('../jobs/streamManager');
const permissions = require('../config/permissions');
const { parseSpecialStreamArgs, resolveSpecialRewardImage } = require('../utils/specialStreamReward');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const QUEUE_GAP_MS = 5 * 60 * 1000;

function nextMidnightJst(now = new Date()) {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + 1) - JST_OFFSET_MS);
}

module.exports = {
  name: 'schedulespecialstream',
  description: 'Schedule a stream with a custom reward (FES: 750 Happiness milestone).',
  async execute(message) {
    try {
      const authorId = String(message?.author?.id || '');
      if (!authorId || !(permissions.allowedStreamSpawners || permissions.allowedBossSpawners || []).includes(authorId)) {
        return message.reply('You do not have permission to use this command.');
      }
      const { rarity, card, targetInput } = parseSpecialStreamArgs(message.content);
      const target = streamManager.resolveStreamTarget(targetInput);
      if (!target) throw new Error(`Unknown stream target: ${targetInput}. Add --target="oshi/subunit" if needed.`);
      const reward = resolveSpecialRewardImage(rarity, card);
      const midnight = nextMidnightJst();
      const latest = await StreamEvent.findOne({
        status: 'scheduled', spawnAt: { $gte: midnight, $lt: new Date(midnight.getTime() + DAY_MS) },
      }).sort({ spawnAt: -1 }).lean().exec();
      const latestTime = latest?.spawnAt ? new Date(latest.spawnAt).getTime() : NaN;
      const spawnAt = Number.isFinite(latestTime) && latestTime >= midnight.getTime()
        ? new Date(latestTime + QUEUE_GAP_MS) : midnight;
      const endsAt = new Date(spawnAt.getTime() + streamManager.eventDurationMs());
      const event = await StreamEvent.create({
        eventId: nanoid(), oshiId: target.eventOshiId, imageUrl: reward.imageUrl,
        spawnAt, endsAt, status: 'scheduled', happiness: 0, users: [], announceMessageId: null,
        rewardOverrides: {
          firstPlaceRewardRarity: reward.rarity, firstPlaceRewardCardName: reward.card,
          scheduledBy: 'schedulespecialstream', scheduledByUserId: authorId,
        },
        createdAt: new Date(),
      });
      const ts = Math.floor(spawnAt.getTime() / 1000);
      return message.reply(`Scheduled special stream **${target.label}** for <t:${ts}:F> (<t:${ts}:R>). ${reward.rarity === 'FES' ? 'Everyone with **750+ Happiness** receives' : '1st place receives'} **[${reward.rarity}] ${reward.card}**. Event: \`${event.eventId}\``);
    } catch (err) {
      console.error('[schedulespecialstream]', err);
      return message.reply(`Cannot schedule special stream: ${err.message}\nUsage: \`!schedulespecialstream Suisei --rarity="ORI" --card="Suisei 002"\``).catch(() => null);
    }
  },
};
