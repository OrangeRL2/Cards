// message-commands/pity1999.js
// Allowlist-only prefix command to set pullsSinceLastSEC to 1999 (for testing forced SEC).
// Usage:
//   !pity1999            -> set your own pullsSinceLastSEC to 1999
//   !pity1999 @user      -> set mentioned user's pullsSinceLastSEC to 1999 (optional)
// Optional flags:
//   !pity1999 --value=1999     -> set to a custom value (clamped 0..1999)
//   !pity1999 --silent         -> don't reply with details (still confirms minimal)
const PREFIX = '!';
const COMMAND_NAME = 'pity1999';

// Allowlist (only these users can use the command)
const OWNER_ID = '409717160995192832';
const OWNER_ID2 = '153551890976735232';
const OWNER_ID3 = '399012422805094410';
const ALLOWED_IDS = new Set([OWNER_ID, OWNER_ID2, OWNER_ID3]);

const User = require('../models/User'); // adjust if needed

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

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Allowlist-only. Set pullsSinceLastSEC to 1999 (or custom value) for testing.',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      const authorId = message.author.id;
      if (!ALLOWED_IDS.has(authorId)) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      // Only run on exact command token, e.g. "!pity1999"
      const token = message.content.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase();
      if (token !== COMMAND_NAME) return;

      const flags = parseFlags(message.content);

      const desired = ('value' in flags) ? flags.value : 1999;
      const value = clamp(desired, 0, 1999);

      // Mention OR self
      const targetUser = message.mentions.users.first() || message.author;

      // IMPORTANT: do NOT set pullsSinceLastSEC in BOTH $set and $setOnInsert (Mongo conflict).
      await User.updateOne(
        { id: targetUser.id },
        {
          $set: { pullsSinceLastSEC: value },
          $setOnInsert: {
            id: targetUser.id,
            pulls: 0,
            points: 0,
            cards: [],
          },
        },
        { upsert: true }
      );

      const silent = Boolean(flags.silent);
      if (silent) {
        return message.reply({ content: '✅ Done.' }).catch(() => {});
      }

      return message.reply({
        content: `✅ Set **pullsSinceLastSEC** to **${value}** for **${targetUser.username}**.`,
      }).catch(() => {});
    } catch (err) {
      console.error('[pity1999] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running pity1999 command.' }); } catch {}
    }
  },
};