// message-commands/restart.js
// Owner-only prefix command to gracefully restart the bot.
// Usage examples:
//   !restart                -> restart after 1s (default short delay to allow reply to send)
//   !restart --delay=5      -> restart after 5 seconds
//   !restart --reason="deploy" --delay=2
//   !restart --force        -> immediate hard exit (still waits a short moment to send reply)
const PREFIX = '!';
const COMMAND_NAME = 'restart';
const OWNER_ID = '409717160995192832';
const OWNER_ID2 = '153551890976735232';
const OWNER_ID3 = '399012422805094410';

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
  description: 'Owner-only. Gracefully restart the bot process.',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      const authorId = message.author.id;
      if (authorId !== OWNER_ID && authorId !== OWNER_ID2 && authorId !== OWNER_ID3) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const flags = parseFlags(message.content);
      const delaySec = Math.max(0, Number(flags.delay ?? 1)); // default short delay to allow reply to send
      const reason = flags.reason ? String(flags.reason) : 'manual restart';
      const force = Boolean(flags.force);

      // Inform channel and owners
      const replyText = `Restarting bot${delaySec > 0 ? ` in ${delaySec}s` : ''}. Reason: ${reason}${force ? ' (force)' : ''}`;
      try {
        await message.reply({ content: replyText });
      } catch (err) {
        // If reply fails, still attempt to restart but log the failure
        console.warn('[restart] failed to send reply before restart', err);
      }

      // Give a small grace period to let the reply propagate
      const waitMs = Math.max(500, Math.min(delaySec * 1000, 60 * 1000)); // clamp between 0.5s and 60s

      // Attempt graceful shutdown: destroy client, then exit.
      setTimeout(async () => {
        try {
          // If sharded, attempt to notify other shards (best-effort)
          const client = message.client;
          if (client) {
            try {
              // attempt graceful logout/destroy
              if (typeof client.destroy === 'function') {
                await client.destroy();
                console.log('[restart] client.destroy() completed');
              } else if (typeof client.logout === 'function') {
                await client.logout();
                console.log('[restart] client.logout() completed');
              }
            } catch (err) {
              console.warn('[restart] error while destroying client', err);
            }
          }

          // Exit process. Use non-zero code for forced restart to signal supervisor if desired.
          const exitCode = force ? 1 : 0;
          console.log(`[restart] exiting process with code ${exitCode}. Reason: ${reason}`);
          // allow logs to flush
          setTimeout(() => process.exit(exitCode), 100);
        } catch (err) {
          console.error('[restart] unexpected error during restart sequence', err);
          try { process.exit(force ? 1 : 0); } catch (e) { /* ignore */ }
        }
      }, waitMs);
    } catch (err) {
      console.error('[restart] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running restart command.' }); } catch {}
    }
  }
};
