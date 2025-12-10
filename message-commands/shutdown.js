// message-commands/shutdown.js
const PREFIX = '!';
const COMMAND_NAME = 'shutdown';
const OWNER_ID = '409717160995192832'; // replace or add more checks as needed
const OWNER_ID2 = '153551890976735232';
const OWNER_ID3 = '272129129841688577';

// parse simple flags: !shutdown --reason="maintenance"
function parseFlags(content) {
  const parts = content.split(/\s+/).slice(1); // drop command token
  const flags = {};
  for (const p of parts) {
    if (!p.startsWith('--')) continue;
    const without = p.slice(2);
    const [k, v] = without.split(/=(.+)/);
    flags[k] = v === undefined ? true : v.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  }
  return flags;
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Owner-only. Gracefully shuts down the bot.',
  /**
   * @param {import('discord.js').Message} message
   * @param {string[]} args
   */
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Owner check
      if (message.author.id !== OWNER_ID && message.author.id !== OWNER_ID2 && message.author.id !== OWNER_ID3) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const flags = parseFlags(message.content);
      const reason = flags.reason || 'No reason provided';

      // Acknowledge the shutdown request
      try {
        await message.reply({ content: `Shutdown initiated by <@${message.author.id}>. Reason: ${reason}` });
      } catch (err) {
        // ignore reply errors, continue shutdown
      }

      // Log to console for server operators
      console.log(`[shutdown] requested by ${message.author.tag} (${message.author.id}) — reason: ${reason}`);

      // Attempt graceful logout
      const client = message.client;
      try {
        // stop any intervals/timeouts your bot uses here if needed
        await client.destroy();
        console.log('[shutdown] client.destroy() completed.');
      } catch (err) {
        console.error('[shutdown] error while destroying client', err);
      }

      // Exit process after a short delay to allow logs/replies to flush
      setTimeout(() => {
        console.log('[shutdown] exiting process.');
        process.exit(0);
      }, 1000);
    } catch (err) {
      console.error('[shutdown] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running shutdown.' }); } catch {}
    }
  }
};
