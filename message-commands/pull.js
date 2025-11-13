// message-commands/pull.js
const PREFIX = '!';
module.exports = {
  name: 'pull',
  description: 'Run the /pull command via prefix',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // find the slash command by name using the bot's client from the message
      const slashCmd = message.client.commands.get('pull');
      if (!slashCmd || typeof slashCmd.execute !== 'function') {
        return message.reply({ content: 'Slash pull command not loaded.' }).catch(() => {});
      }

      // parse allowEvent similar to slash usage
      const allowEvent = args.includes('event') || args.includes('--event') || args.includes('true');

      let replyMessage = null;

      // fake interaction that matches the methods your slash handler expects
      const fakeInteraction = {
        user: message.author,
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
        // must return the Message object so collectors work
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
