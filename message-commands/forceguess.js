const config = require('../config.json');
const guessManager = require('../jobs/guessManager');

function parseChannelId(value) {
  const text = String(value || '').trim();
  const mention = text.match(/^<#(\d+)>$/);
  if (mention) return mention[1];
  return /^\d+$/.test(text) ? text : null;
}

module.exports = {
  name: 'forceguess',

  async execute(message, args = []) {
    const allowed = new Set((config.allowedGuessSpawners || []).map(String));
    if (!allowed.has(String(message.author.id))) {
      console.warn(`[forceguess] denied user ${message.author.id}`);
      return;
    }

    let mode = null;
    let channelId = null;
    for (const raw of args) {
      const token = String(raw || '').toLowerCase();
      if (!mode && ['jacket', 'song', 'holomem'].includes(token)) {
        mode = token;
        continue;
      }
      const parsedChannel = parseChannelId(raw);
      if (!channelId && parsedChannel) channelId = parsedChannel;
    }
    channelId ||= String(message.channel.id);

    const result = await guessManager.spawnAutomatic(message.client, {
      mode,
      channelId,
      forced: true,
    });

    if (result.success) {
      await message.reply({
        content: `Forced **${result.round.mode}** reward challenge in <#${result.channel.id}>.`,
        allowedMentions: { parse: [] },
      }).catch(() => {});
      return;
    }

    const reasons = {
      ACTIVE_AUTO: 'A rewarded Guess Challenge is already active somewhere. Resolve it before forcing another one.',
      NO_FREE_CHANNEL: 'That channel is invalid, unavailable, or already has a guessing round.',
      BUILD_FAILED: `Could not build the challenge: ${result.error?.message || 'unknown error'}`,
    };
    await message.reply({ content: reasons[result.reason] || `Could not force a guess (${result.reason}).`, allowedMentions: { parse: [] } }).catch(() => {});
  },
};
