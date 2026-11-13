// message-commands/pull.js
const PREFIX = '!';

// Configure allowed user IDs here
const ALLOWED_TARGETERS = new Set([
  '153551890976735232', // replace with real user IDs
  '409717160995192832'
]);

module.exports = {
  name: 'pull',
  description: 'Run the /pull command via prefix',
  async execute(message, args = []) {
    let replyMessage = null;
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // First arg may be a target mention or ID. Only allow if caller's ID is in ALLOWED_TARGETERS.
      const maybeTarget = args[0];
      let targetUser = null;
      const callerId = message.author.id;
      const callerAllowed = ALLOWED_TARGETERS.has(callerId);

      if (maybeTarget && callerAllowed) {
        // strip mention formatting if present
        const idCandidate = maybeTarget.replace(/[<@!>]/g, '');
        if (/^\d{17,20}$/.test(idCandidate)) {
          try {
            targetUser = await message.client.users.fetch(idCandidate);
          } catch (err) {
            // invalid ID or fetch failure — leave targetUser null
            targetUser = null;
          }
        }
      } else if (maybeTarget && !callerAllowed) {
        // optional: inform unauthorized callers that targeting others is restricted
        try {
          await message.reply({ content: 'You are not permitted to target another user. This action is restricted.' });
        } catch {}
      }

      // find the slash command by name using the bot's client from the message
      const slashCmd = message.client.commands.get('pull');
      if (!slashCmd || typeof slashCmd.execute !== 'function') {
        return message.reply({ content: 'Slash pull command not loaded.' }).catch(() => {});
      }

      // parse allowspecial similar to slash usage (skip first arg if it was a target and allowed)
      const argStart = targetUser ? 1 : 0;
      const remainingArgs = args.slice(argStart);
      const allowspecial = remainingArgs.includes('special') ||
                         remainingArgs.includes('--special') ||
                         remainingArgs.includes('true');


      // fake interaction that matches the methods your slash handler expects
      // inside message-commands/pull.js, where fakeInteraction is defined
const fakeInteraction = {
  id: `msg-${message.id}`, // ensure a unique id per message invocation
  client: message.client,
  guild: message.guild,
  guildId: message.guildId,
  channel: message.channel,
  channelId: message.channelId,
  member: message.member,
  user: targetUser || message.author,
  _initiator: message.author,
  options: {
    getBoolean: (name) => (name === 'special' ? allowspecial : null)
  },
  // Keep the same Discord message for the entire loading -> result lifecycle.
  // A blank content send is invalid and can make the fallback spawn duplicates.
  async deferReply() {
    replyMessage = await message.channel.send({ content: '🎴 Preparing pull...' });
  },
  async editReply(payload) {
    if (!replyMessage) throw new Error('Prefix pull reply was not created');
    return replyMessage.edit(typeof payload === 'string' ? { content: payload } : payload);
  },
  async reply(payload) {
    if (replyMessage) return replyMessage.edit(payload);
    replyMessage = await message.channel.send(payload);
    return replyMessage;
  },
  async deleteReply() {
    if (replyMessage) {
      await replyMessage.delete();
      replyMessage = null;
    }
  }
};


      // call the slash command execute exactly as if an interaction invoked it
      await slashCmd.execute(fakeInteraction);
    } catch (err) {
      console.error('[MSG-CMD] pull wrapper error', err);
      // The original reply is a loading GIF: don't abandon it on an edit failure.
      try {
        if (replyMessage) {
          await replyMessage.edit({ content: '⚠️ Pull display failed. Check your inventory before retrying.', embeds: [], attachments: [], components: [] });
          return;
        }
      } catch (cleanupError) {
        console.error('[MSG-CMD] could not clean up loading message:', cleanupError);
        try { await replyMessage?.delete(); } catch {}
      }
      try { await message.reply({ content: 'Pull display failed. Check your inventory before retrying.' }); } catch {}
    }
  }
};
