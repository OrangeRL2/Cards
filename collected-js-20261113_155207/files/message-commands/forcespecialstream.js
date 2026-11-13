const streamManager = require('../jobs/streamManager');
const permissions = require('../config/permissions');
const { parseSpecialStreamArgs, resolveSpecialRewardImage } = require('../utils/specialStreamReward');

module.exports = {
  name: 'forcespecialstream',
  description: 'Force-start a stream with a custom reward (FES: 750 Happiness milestone).',
  async execute(message) {
    try {
      const authorId = String(message?.author?.id || '');
      if (!authorId || !(permissions.allowedStreamSpawners || permissions.allowedBossSpawners || []).includes(authorId)) {
        return message.reply('You do not have permission to use this command.');
      }
      const { rarity, card, targetInput, seconds } = parseSpecialStreamArgs(message.content);
      const target = streamManager.resolveStreamTarget(targetInput);
      if (!target) throw new Error(`Unknown stream target: ${targetInput}. Add --target="oshi/subunit" if needed.`);
      const reward = resolveSpecialRewardImage(rarity, card);
      const { event } = await streamManager.createAndAnnounceEvent(
        message.client,
        target.eventOshiId,
        seconds === null ? null : seconds * 1000,
        {
          imageUrl: reward.imageUrl,
          rewardOverrides: { firstPlaceRewardRarity: reward.rarity, firstPlaceRewardCardName: reward.card },
        }
      );
      return message.reply(`Special stream for **${target.label}** started. ${reward.rarity === 'FES' ? 'Everyone with **750+ Happiness** receives' : '1st place receives'} **[${reward.rarity}] ${reward.card}**. Event: \`${event.eventId}\``);
    } catch (err) {
      console.error('[forcespecialstream]', err);
      return message.reply(`Cannot start special stream: ${err.message}\nUsage: \`!forcespecialstream Suisei --rarity="ORI" --card="Suisei 002"\``).catch(() => null);
    }
  },
};
