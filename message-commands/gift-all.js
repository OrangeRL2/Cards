// message-commands/giftAll.js
const User = require('../models/User');
const PREFIX = '!';
const COMMAND_NAME = 'gift-all';

// Configure allowed users and roles here (strings)
const ALLOWED_USER_IDS = new Set([
  '153551890976735232',
]);
const ALLOWED_ROLE_IDS = new Set([
  '844054364033384470',
]);

// parse simple key:value tokens like "user:@Someone" or "count:100"
function parseOptionsFromTokens(tokens) {
  const opts = {};
  for (const token of tokens) {
    const idx = token.indexOf(':');
    if (idx === -1) continue;
    const key = token.slice(0, idx).toLowerCase();
    const val = token.slice(idx + 1);
    opts[key] = val;
  }
  return opts;
}

function chunkSummary(prefix, parts, mention, maxLen = 1900) {
  const chunks = [];
  let current = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const candidate = current ? `${current}, ${part}` : part;
    if ((prefix + candidate + mention).length > maxLen) {
      if (current) {
        chunks.push(current);
        current = part;
      } else {
        const allowed = Math.max(0, maxLen - prefix.length - mention.length - 3);
        chunks.push(part.slice(0, allowed) + '...');
        current = '';
      }
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Prefix command: gift-all — send matching stacks to a user',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Permission check: user allowlist or role allowlist
      const authorId = message.author.id;
      const member = message.member; // may be null in DMs
      const hasUserAllow = ALLOWED_USER_IDS.has(authorId);
      const hasRoleAllow = member && member.roles && member.roles.cache
        ? member.roles.cache.some(r => ALLOWED_ROLE_IDS.has(r.id))
        : false;

      if (!hasUserAllow && !hasRoleAllow) {
        return message.reply({ content: "You don't have permission to use this command." }).catch(() => {});
      }

      // tokens after command name
      const tokens = message.content.trim().split(/\s+/).slice(1);
      const opts = parseOptionsFromTokens(tokens);

      // Resolve recipient (mention or id)
      let toUser = null;
      if (opts.user) {
        const mentionMatch = opts.user.match(/^<@!?(\d+)>$/);
        const id = mentionMatch ? mentionMatch[1] : opts.user;
        try {
          toUser = await message.client.users.fetch(id);
        } catch (e) {
          // ignore
        }
      }
      if (!toUser) {
        return message.reply({ content: '!gift-all user:409717160995192832 rarity:all count:999 multi:true allowlocked:false' }).catch(() => {});
      }

      // Parse options
      const rarityOpt = (opts.rarity || 'any').toLowerCase().trim();
      let sendCount = parseInt(opts.count, 10);
      if (!Number.isInteger(sendCount) || sendCount < 1) {
        return message.reply({ content: 'Invalid or missing count. Use count:<number> (>=1).' }).catch(() => {});
      }
      const multi = String(opts.multi || 'false').toLowerCase() === 'true';
      const allowLocked = String(opts.allowlocked || 'false').toLowerCase() === 'true';

      // Load sender doc
      const fromId = message.author.id;
      const fromDoc = await User.findOne({ id: fromId }).exec();
      if (!fromDoc || !Array.isArray(fromDoc.cards) || fromDoc.cards.length === 0) {
        return message.reply({ content: 'You have no cards.' }).catch(() => {});
      }

      const matchAnyRarity = rarityOpt === 'any' || rarityOpt === 'all' || rarityOpt === '';

      // Collect matches (all names; optional rarity; respect allowLocked)
      const matches = fromDoc.cards
        .map(c => ({ entry: c }))
        .filter(({ entry }) => {
          if (entry.locked && !allowLocked) return false;
          if (!matchAnyRarity && String(entry.rarity || '').toLowerCase() !== rarityOpt) return false;
          const available = Number(entry.count || 0);
          return multi ? available > 1 : available > 0;
        });

      if (!matches.length) {
        return message.reply({ content: `No matching cards found in your inventory${matchAnyRarity ? '' : ` for rarity "${opts.rarity}"`}.` }).catch(() => {});
      }

      // Sum available across matches (respecting multi rule)
      const totalAvailable = matches.reduce((sum, m) => {
        const available = Number(m.entry.count || 0);
        const availableForTake = multi ? Math.max(0, available - 1) : available;
        return sum + availableForTake;
      }, 0);

      if (totalAvailable <= 0) {
        const reason = multi ? 'You have no matching stacks with more than one copy (multi prevents taking the last copy).' : 'You have no available matching cards to send.';
        return message.reply({ content: reason }).catch(() => {});
      }

      // If requested more than available, send all available
      let partialSend = false;
      const requestedCount = sendCount;
      if (sendCount > totalAvailable) {
        partialSend = true;
        sendCount = totalAvailable;
      }

      // Build transfers: iterate matches and take from them until sendCount satisfied
      let remaining = sendCount;
      const transfers = [];
      matches.sort((a, b) => {
        const na = String(a.entry.name || '').localeCompare(String(b.entry.name || ''));
        if (na !== 0) return na;
        return String(a.entry.rarity || '').localeCompare(String(b.entry.rarity || ''));
      });

      for (const { entry } of matches) {
        if (remaining <= 0) break;
        const available = Number(entry.count || 0);
        const availableForTake = multi ? Math.max(0, available - 1) : available;
        if (availableForTake <= 0) continue;
        const take = Math.min(availableForTake, remaining);
        transfers.push({
          name: entry.name,
          rarity: entry.rarity,
          amount: take,
          locked: Boolean(entry.locked)
        });
        remaining -= take;
      }

      // Apply deductions to sender
      for (const t of transfers) {
        const curIdx = fromDoc.cards.findIndex(c => String(c.name) === String(t.name) && String(c.rarity || '') === String(t.rarity || ''));
        if (curIdx === -1) continue;
        const cardEntry = fromDoc.cards[curIdx];
        cardEntry.count = (Number(cardEntry.count) || 0) - t.amount;
        if (cardEntry.count <= 0) {
          fromDoc.cards.splice(curIdx, 1);
        }
      }
      fromDoc.markModified('cards');
      await fromDoc.save();

      // Credit recipient
      let toDoc = await User.findOne({ id: toUser.id }).exec();
      if (!toDoc) toDoc = new User({ id: toUser.id, cards: [] });
      const now = new Date();
      for (const t of transfers) {
        const toIdx = toDoc.cards.findIndex(c => String(c.name) === String(t.name) && String(c.rarity || '') === String(t.rarity || ''));
        if (toIdx !== -1) {
          const card = toDoc.cards[toIdx];
          card.count = (card.count || 0) + t.amount;
          card.firstAcquiredAt ??= now;
          card.lastAcquiredAt = now;
          card.locked = Boolean(card.locked) || Boolean(t.locked);
        } else {
          toDoc.cards.push({
            name: t.name,
            rarity: t.rarity,
            count: t.amount,
            firstAcquiredAt: now,
            lastAcquiredAt: now,
            locked: Boolean(t.locked),
          });
        }
      }
      toDoc.markModified('cards');
      await toDoc.save();

      // Build and send summary (split into chunks)
      const summaryParts = transfers.map(t => `${t.amount} x **[${String(t.rarity || '').toUpperCase()}] ${t.name}**${t.locked ? ' (locked)' : ''}`);
      const prefix = partialSend
        ? `You requested ${requestedCount} but only ${sendCount} ${sendCount === 1 ? 'card' : 'cards'} were available${multi ? ' (multi prevented taking last copies)' : ''}.\n`
        : '';
      const header = `${prefix}You sent `;
      const mention = ` to ${toUser.toString()}.`;

      const chunks = chunkSummary(header, summaryParts, mention);
      // Send first chunk as reply, rest as channel messages
      await message.reply({ content: `${header}${chunks[0] || ''}${mention}` }).catch(() => {});
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i] + (i === chunks.length - 1 ? mention : '')).catch(() => {});
      }
    } catch (err) {
      console.error('[gift-all] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running gift-all.' }); } catch {}
    }
  }
};
