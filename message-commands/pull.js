// message-commands/pull.js
const PREFIX = '!';

// Configure allowed user IDs here
const ALLOWED_TARGETERS = new Set([
  '153551890976735232', 
  '234567890123456789'
]);

module.exports = {
  name: 'pull',
  description: 'Run the /pull command via prefix',
  async execute(message, args = []) {
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

      // parse allowEvent similar to slash usage (skip first arg if it was a target and allowed)
      const argStart = targetUser ? 1 : 0;
      const remainingArgs = args.slice(argStart);
      const allowEvent = remainingArgs.includes('event') ||
                         remainingArgs.includes('--event') ||
                         remainingArgs.includes('true');

      let replyMessage = null;

      // fake interaction that matches the methods your slash handler expects
      const fakeInteraction = {
        // use the target user if provided and allowed, otherwise the message author
        user: targetUser || message.author,
        // expose the original caller so the slash handler can audit who initiated the action
        _initiator: message.author,
        options: {
          getBoolean: (name) => (name === 'event' ? allowEvent : null)
        },
        async deferReply() {
          try {
            replyMessage = await message.channel.send({ content: '' });
          } catch (e) {
            replyMessage = null;
          }
        },
        async editReply(payload) {
          try {
            if (!replyMessage) {
              replyMessage = await message.channel.send(payload);
              return replyMessage;
            }
            return await replyMessage.edit(typeof payload === 'string' ? { content: payload } : payload);
          } catch (err) {
            try { replyMessage = await message.channel.send(payload); return replyMessage; } catch { return null; }
          }
        },
        async reply(payload) {
          try { replyMessage = await message.channel.send(payload); return replyMessage; } catch { return null; }
        }
      };

      // call the slash command execute exactly as if an interaction invoked it
      await slashCmd.execute(fakeInteraction);
    } catch (err) {
      console.error('[MSG-CMD] pull wrapper error', err);
      try { await message.reply({ content: 'An error occurred running the pull command.' }); } catch {}
    }
  }
};
