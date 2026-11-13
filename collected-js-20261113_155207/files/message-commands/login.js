// message-commands/login.js
const PREFIX = '!';

// Users allowed to run !login on someone else
const ALLOWED_TARGETERS = new Set([
  '153551890976735232', // replace with real IDs
  '409717160995192832',
]);

module.exports = {
  name: 'login',
  description: 'Run the /login command via prefix',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      const callerId = message.author.id;
      const maybeTarget = args[0];

      let targetUser = null;
      const callerAllowed = ALLOWED_TARGETERS.has(callerId);

      // Handle optional target
      if (maybeTarget && callerAllowed) {
        const idCandidate = maybeTarget.replace(/[<@!>]/g, '');
        if (/^\d{17,20}$/.test(idCandidate)) {
          try {
            targetUser = await message.client.users.fetch(idCandidate);
          } catch {
            targetUser = null;
          }
        }
      } else if (maybeTarget && !callerAllowed) {
        await message.reply({
          content: 'You are not permitted to run login for another user.',
        }).catch(() => {});
      }

      // Fetch slash command
      const slashCmd = message.client.commands.get('login');
      if (!slashCmd || typeof slashCmd.execute !== 'function') {
        return message.reply({
          content: 'Slash login command not loaded.',
        }).catch(() => {});
      }

      let replyMessage = null;

      // Fake interaction
      const fakeInteraction = {
        id: `msg-${message.id}`,
        user: targetUser ?? message.author,
        member: message.member,
        guild: message.guild,
        channel: message.channel,
        client: message.client,

        async deferReply() {
          replyMessage = await message.channel.send({ content: '' }).catch(() => null);
        },

        async editReply(payload) {
          try {
            if (!replyMessage) {
              replyMessage = await message.channel.send(payload);
              return replyMessage;
            }
            return await replyMessage.edit(
              typeof payload === 'string' ? { content: payload } : payload
            );
          } catch {
            try {
              replyMessage = await message.channel.send(payload);
              return replyMessage;
            } catch {
              return null;
            }
          }
        },

        async reply(payload) {
          try {
            replyMessage = await message.channel.send(payload);
            return replyMessage;
          } catch {
            return null;
          }
        },
      };

      // Execute slash command
      await slashCmd.execute(fakeInteraction);

    } catch (err) {
      console.error('[MSG-CMD] login wrapper error', err);
      try {
        await message.reply({
          content: 'An error occurred running the login command.',
        });
      } catch {}
    }
  },
};