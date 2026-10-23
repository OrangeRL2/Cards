const config = require('../config.json');
const guessManager = require('../jobs/guessManager');

module.exports = {
  name: 'forceguess',

  async execute(message, args = []) {
    const allowed = new Set((config.allowedGuessSpawners || []).map(String));
    if (!allowed.has(String(message.author.id))) {
      console.warn(`[forceguess] denied user ${message.author.id}`);
      return;
    }

    let mode = null;
    let here = false;

    for (const raw of args) {
      const token = String(raw || '').trim().toLowerCase();

      if (token === '--here') {
        here = true;
        continue;
      }

      if (!mode && ['jacket', 'song', 'holomem'].includes(token)) {
        mode = token;
      }
    }

    // Default: no channelId is supplied, so guessManager chooses a random
    // free channel from config.guessChannelIds and sends the public announcement.
    //
    // --here: explicitly use the command's current channel and suppress the
    // public announcement.
    const result = await guessManager.spawnAutomatic(message.client, {
      mode,
      channelId: here ? String(message.channel.id) : null,
      forced: true,
      announce: !here,
    });

    if (result.success) {
      await message.reply({
        content: here
          ? `Forced **${result.round.mode}** reward challenge here.`
          : `Forced **${result.round.mode}** reward challenge in <#${result.channel.id}>.`,
        allowedMentions: { parse: [] },
      }).catch(() => {});
      return;
    }

    const reasons = {
      ACTIVE_AUTO: 'A rewarded Guess Challenge is already active somewhere. Resolve it before forcing another one.',
      NO_FREE_CHANNEL: here
        ? 'This channel is invalid, unavailable, or already has a guessing round.'
        : 'No configured Guess channel is currently available.',
      BUILD_FAILED: `Could not build the challenge: ${result.error?.message || 'unknown error'}`,
    };

    await message.reply({
      content: reasons[result.reason] || `Could not force a guess (${result.reason}).`,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  },
};
