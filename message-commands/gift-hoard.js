// message-commands/gift-hoard.js
const User = require('../models/User');

const PREFIX = '!';
const COMMAND_NAME = 'gift-hoard';

// Copy your allowlists from gift-all.js (or refactor to share them)
const ALLOWED_USER_IDS = new Set([
  '153551890976735232',
]);

const ALLOWED_ROLE_IDS = new Set([
  '844054364033384470',
]);

/**
 * Hard-coded hoards.
 * Keys are typically Discord user IDs (string).
 * Values are "base names" that cards start with.
 *
 * Example: 'Lamy' matches 'Lamy 001', 'Lamy 501', 'Lamy_001', etc.
 */
const hoardMap = {
  '409717160995192832': ['Lamy', 'Nepolabo'],
  '153551890976735232': ['Pekora', 'Marine', 'Noel'],
  // Add more...
};

/**
 * Optional alias expansion: group keywords -> list of base names
 * If your cards are NOT literally called "Nepolabo 001", you probably want this.
 */
const aliasMap = {

};

// --- Option parsing (same style as gift-all) ---
function parseOptionsFromTokens(tokens) {
  const opts = {};
  for (const raw of tokens) {
    if (!raw) continue;
    let token = String(raw).trim();
    if (!token) continue;

    // allow --key=value or --key:value or bare --flag
    if (token.startsWith('--')) token = token.slice(2);

    let key = '';
    let val = '';
    const colonIdx = token.indexOf(':');
    const eqIdx = token.indexOf('=');

    if (colonIdx !== -1) {
      key = token.slice(0, colonIdx);
      val = token.slice(colonIdx + 1);
    } else if (eqIdx !== -1) {
      key = token.slice(0, eqIdx);
      val = token.slice(eqIdx + 1);
    } else {
      key = token;
      val = 'true';
    }

    key = String(key).trim().toLowerCase();
    if (!key) continue;
    opts[key] = String(val).trim();
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

// Normalize names to make matching more forgiving
function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

// Extract a Discord snowflake ID from anything (mention, raw, etc.)
function extractDiscordId(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/(\d{17,20})/);
  return m ? m[1] : null;
}

// Build union of all hoard base names
function unionAllHoards(map) {
  const out = new Set();
  for (const key of Object.keys(map)) {
    const arr = map[key];
    if (!Array.isArray(arr)) continue;
    for (const n of arr) out.add(normName(n));
  }
  return [...out];
}

// Expand aliases like "nepolabo" -> ["lamy","nene","botan","polka"]
function expandAliases(rawList) {
  const expanded = [];
  for (const x of rawList) {
    const k = normName(x);
    if (aliasMap[k] && Array.isArray(aliasMap[k])) expanded.push(...aliasMap[k]);
    else expanded.push(x);
  }
  return expanded;
}

// Match card name against hoard base names.
// Example: "lamy 001" matches hoard base "lamy".
function matchesHoard(normCardName, hoardSet) {
  for (const h of hoardSet) {
    if (!h) continue;
    if (normCardName === h) return true;
    if (normCardName.startsWith(h + ' ')) return true;

    // Optional: handle "lamy001" (no space) if it exists
    if (normCardName.startsWith(h)) {
      const rest = normCardName.slice(h.length);
      if (/^\d+$/.test(rest)) return true;
    }
  }
  return false;
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Prefix command: gift-hoard — send all cards belonging to a configured hoard',

  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // If your dispatcher calls execute for every prefix-command,
      // uncomment the next 2 lines to ensure this only runs on gift-hoard:
      // const cmd = message.content.trim().split(/\s+/)[0].slice(PREFIX.length).toLowerCase();
      // if (cmd !== COMMAND_NAME) return;

      // Permission check: user allowlist or role allowlist
      const authorId = message.author.id;
      const member = message.member;
      const hasUserAllow = ALLOWED_USER_IDS.has(authorId);
      const hasRoleAllow = member && member.roles && member.roles.cache
        ? member.roles.cache.some(r => ALLOWED_ROLE_IDS.has(r.id))
        : false;

      if (!hasUserAllow && !hasRoleAllow) {
        return message.reply({ content: "You don't have permission to use this command." }).catch(() => {});
      }

      // Tokens after command name
      const tokens = message.content.trim().split(/\s+/).slice(1);
      const opts = parseOptionsFromTokens(tokens);

      // Resolve recipient
      let toUser = null;
      if (opts.user) {
        const id = extractDiscordId(opts.user);
        if (id) {
          try { toUser = await message.client.users.fetch(id); } catch {}
        }
      }

      if (!toUser) {
        return message.reply({
          content:
            '!gift-hoard --user=<@id> --multi=true --allowlocked=true --count=999 --rarity=all [--hoard=all|<id>]',
        }).catch(() => {});
      }

      // Options
      const rarityOpt = String(opts.rarity ?? 'all').toLowerCase().trim();
      const matchAnyRarity = rarityOpt === 'any' || rarityOpt === 'all' || rarityOpt === '';
      const multi = String(opts.multi ?? 'false').toLowerCase() === 'true';
      const allowLocked = String(opts.allowlocked ?? 'false').toLowerCase() === 'true';

      let sendCount = parseInt(opts.count, 10);
      if (!Number.isInteger(sendCount) || sendCount < 1) {
        // If omitted/invalid => send everything available
        sendCount = Number.MAX_SAFE_INTEGER;
      }

      // Determine which hoard to use:
      // - default: recipient's id
      // - --hoard=all: union of all hoards
      // - --hoard=<id>: use that id as hoard key
      const hoardOpt = String(opts.hoard ?? '').trim();
      const hoardKey = hoardOpt || toUser.id;

      let hoardNamesNorm = [];
      let hoardLabel = '';

      if (hoardOpt && hoardOpt.toLowerCase() === 'all') {
        hoardNamesNorm = unionAllHoards(hoardMap);
        hoardLabel = 'ALL HOARDS';
      } else {
        const list = hoardMap[String(hoardKey)];
        if (!Array.isArray(list) || list.length === 0) {
          return message.reply({
            content: `No hoard is configured for key "${hoardKey}". Use --hoard=all to send everything listed.`,
          }).catch(() => {});
        }

        const expanded = expandAliases(list);
        hoardNamesNorm = expanded.map(normName);
        hoardLabel = `Hoard(${hoardKey})`;
      }

      const hoardSet = new Set(hoardNamesNorm);

      // Load sender
      const fromId = message.author.id;
      const fromDoc = await User.findOne({ id: fromId }).exec();
      if (!fromDoc || !Array.isArray(fromDoc.cards) || fromDoc.cards.length === 0) {
        return message.reply({ content: 'You have no cards.' }).catch(() => {});
      }

      // Collect matches: only cards whose name matches the hoard base list
      const matches = fromDoc.cards
        .map(c => ({ entry: c }))
        .filter(({ entry }) => {
          if (entry.locked && !allowLocked) return false;
          if (!matchAnyRarity && String(entry.rarity ?? '').toLowerCase() !== rarityOpt) return false;

          const n = normName(entry.name);
          if (!matchesHoard(n, hoardSet)) return false;

          const available = Number(entry.count ?? 0);
          return multi ? available > 1 : available > 0;
        });

      if (!matches.length) {
        return message.reply({
          content: `No matching hoard cards found in your inventory for ${hoardLabel}${matchAnyRarity ? '' : ` and rarity "${rarityOpt}"`}.`,
        }).catch(() => {});
      }

      // Total available respecting multi rule
      const totalAvailable = matches.reduce((sum, m) => {
        const available = Number(m.entry.count ?? 0);
        const availableForTake = multi ? Math.max(0, available - 1) : available;
        return sum + availableForTake;
      }, 0);

      if (totalAvailable <= 0) {
        const reason = multi
          ? 'You have no matching stacks with more than one copy (multi prevents taking the last copy).'
          : 'You have no available matching cards to send.';
        return message.reply({ content: reason }).catch(() => {});
      }

      // Cap by requested count
      let partialSend = false;
      const requestedCount = sendCount;
      if (sendCount > totalAvailable) {
        partialSend = true;
        sendCount = totalAvailable;
      }

      // Build transfers
      let remaining = sendCount;
      const transfers = [];

      matches.sort((a, b) => {
        const na = String(a.entry.name ?? '').localeCompare(String(b.entry.name ?? ''));
        if (na !== 0) return na;
        return String(a.entry.rarity ?? '').localeCompare(String(b.entry.rarity ?? ''));
      });

      for (const { entry } of matches) {
        if (remaining <= 0) break;

        const available = Number(entry.count ?? 0);
        const availableForTake = multi ? Math.max(0, available - 1) : available;
        if (availableForTake <= 0) continue;

        const take = Math.min(availableForTake, remaining);
        transfers.push({
          name: entry.name,
          rarity: entry.rarity,
          amount: take,
          locked: Boolean(entry.locked),
        });
        remaining -= take;
      }

      // Deduct from sender
      for (const t of transfers) {
        const curIdx = fromDoc.cards.findIndex(
          c => String(c.name) === String(t.name) && String(c.rarity ?? '') === String(t.rarity ?? '')
        );
        if (curIdx === -1) continue;

        const cardEntry = fromDoc.cards[curIdx];
        cardEntry.count = (Number(cardEntry.count) ?? 0) - t.amount;
        if (cardEntry.count <= 0) fromDoc.cards.splice(curIdx, 1);
      }
      fromDoc.markModified('cards');
      await fromDoc.save();

      // Credit recipient
      let toDoc = await User.findOne({ id: toUser.id }).exec();
      if (!toDoc) toDoc = new User({ id: toUser.id, cards: [] });

      const now = new Date();
      for (const t of transfers) {
        const toIdx = toDoc.cards.findIndex(
          c => String(c.name) === String(t.name) && String(c.rarity ?? '') === String(t.rarity ?? '')
        );

        if (toIdx !== -1) {
          const card = toDoc.cards[toIdx];
          card.count = (card.count ?? 0) + t.amount;
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

      // Summary
      const summaryParts = transfers.map(
        t => `${t.amount} x **[${String(t.rarity ?? '').toUpperCase()}] ${t.name}**${t.locked ? ' (locked)' : ''}`
      );

      const prefix = partialSend
        ? `You requested ${requestedCount} but only ${sendCount} ${sendCount === 1 ? 'card' : 'cards'} were available${multi ? ' (multi prevented taking last copies)' : ''}.\n`
        : '';

      const header = `${prefix}You sent (${hoardLabel}) `;
      const mention = ` to ${toUser.toString()}.`;
      const chunks = chunkSummary(header, summaryParts, mention);

      await message.reply({ content: `${header}${chunks[0] ?? ''}${mention}` }).catch(() => {});
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i] + (i === chunks.length - 1 ? mention : '')).catch(() => {});
      }
    } catch (err) {
      console.error('[gift-hoard] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running gift-hoard.' }); } catch {}
    }
  },
};