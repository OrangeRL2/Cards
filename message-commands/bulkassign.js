// commands/bulkassign.js
// Prefix command: !bulkassign
// - Only allowed for the specific admin IDs listed in ALLOWED_IDS
// - Uses your User model and your helper incOrUpsertCard + normalizeCardName
// - Iterates a hardcoded ASSIGNMENT map (username -> { id, cards: [...] })
// - Normalizes rarity to UPPERCASE, preserves name (including serial like "003")
// - Calls incOrUpsertCard for each card once per entry and records a per-user log
// - Replies with an embed summarising what was added / incremented per user
//
// Requires: ../models/User, ../utils/liveAsync (exports incOrUpsertCard, normalizeCardName)

const { EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const { incOrUpsertCard, normalizeCardName } = require('../utils/liveAsync');

const PREFIX = '!';
const ALLOWED_IDS = [
  '153551890976735232'
];

// ---------- ASSIGNMENT (merged entries with IDs) ----------
const ASSIGNMENT = {
  char: {
    id: '776481620949205042',
    cards: ['sr Ririka 003', 'sr Matsuri 001']
  },
  alt: {
    id: '647219814011502607',
    cards: ['oc Mumei 001', 'sr Ao 002', 'sr Ina 001']
  },
  sayael: {
    id: '284655499415126016',
    cards: ['ur Marine 001', 'ur Noel 001', 'our Raden 001']
  },
  moomoo: {
    id: '91098889796481024',
    cards: ['osr Anya 001', 'oc Flare 003']
  },
  toxique: {
    id: '875080998314975374',
    cards: ['sr Watame 001', 'osr Niko 001']
  },
  lu: {
    id: '443061305721618432',
    cards: ['oc Suisei 001', 'sy La+ 001']
  },
  Kiyoko: {
    id: '402522309606375434',
    cards: ['oc Kanata 001', 'sy Luna 001']
  },
  shiro: {
    id: '511182422340272128',
    cards: ['sr Ina 001', 'ur Azki 001', 'our Kanata 001']
  },
  umu: {
    id: '581483331548348416',
    cards: ['osr Lui 001']
  },
  baba: {
    id: '409728788117848074',
    cards: ['ur Hajime 001']
  },
  midori: {
    id: '1312674257104539761',
    cards: ['osr Luna 001', 'sr Miko 002', 'sr Shion 004']
  },
  Kasumi: {
    id: '1311652316973240380',
    cards: ['osr Watame 001']
  },
  koko: {
    id: '443047182619377676',
    cards: ['oc Flare 002']
  },
  ange: {
    id: '409724952091295745',
    cards: ['oc Hajime 001']
  },
  akane: {
    id: '399012422805094410',
    cards: ['osr Lui 001', 'oc Iroha 001']
  },
  blacky: {
    id: '1171127294413246567',
    cards: ['osr Iofi 001', 'sy Marine 001']
  },
  wiwi: {
    id: '615094014575902720',
    cards: ['ur Korone 001', 'sr Iroha 001']
  }
};

// ---------- helpers ----------
function parseCardString(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const rarity = parts[0].toUpperCase();
  const name = parts.slice(1).join(' ');
  return { rarity, name };
}

// ---------- module export (prefix command) ----------
module.exports = {
  name: 'bulkassign',
  description: 'Assign all cards from the predefined list to their respective users (admins only)',
  async execute(message, args = []) {
    try {
      if (!message.content || !message.content.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // permission check
      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      // quick DB upsert for all target users to ensure documents exist
      const upsertPromises = [];
      for (const [, info] of Object.entries(ASSIGNMENT)) {
        if (!info || !info.id) continue;
        upsertPromises.push(
          User.updateOne({ id: info.id }, { $setOnInsert: { id: info.id, pulls: 0, points: 0, cards: [], pendingAttempts: [] } }, { upsert: true }).exec()
        );
      }
      try {
        await Promise.all(upsertPromises);
      } catch (err) {
        console.error('[bulkassign] upsert error', err);
        // proceed: individual operations will surface issues
      }

      const overallResults = {}; // username -> { id, added: [], incremented: [], errors: [] }

      // iterate assignment map
      for (const [username, info] of Object.entries(ASSIGNMENT)) {
        const userId = info.id;
        if (!userId) continue;
        overallResults[username] = { id: userId, added: [], incremented: [], errors: [] };

        const cards = Array.isArray(info.cards) ? info.cards : [];
        for (const rawCard of cards) {
          const parsed = parseCardString(rawCard);
          if (!parsed) {
            overallResults[username].errors.push(`invalid-card-format: ${rawCard}`);
            continue;
          }

          // normalize name via provided helper if you want consistent storage (optional)
          const normName = normalizeCardName ? normalizeCardName(parsed.name) : parsed.name;
          const rarity = parsed.rarity;

          try {
            // incOrUpsertCard expected to return an object with .card and maybe .action or .path
            // We call it once per card (count 1). If you want multiple counts, loop or add param.
            const res = await incOrUpsertCard(userId, normName, rarity);
            if (!res || !res.card) {
              overallResults[username].errors.push(`db-failed: ${rawCard}`);
              continue;
            }

            // Determine if it was a new insert or incremented.
            // incOrUpsertCard implementations vary; try to infer from returned data (common shapes below).
            if (res.action === 'increment' || (res.meta && res.meta.incremented)) {
              overallResults[username].incremented.push(`${rarity} ${normName}`);
            } else if (res.action === 'created' || res.action === 'upsert' || (res.card && res.card.count === 1 && res.meta && !res.meta.previousCount)) {
              overallResults[username].added.push(`${rarity} ${normName}`);
            } else {
              // fallback: if count > 1 treat as increment, else added
              const count = res.card.count || 1;
              if (count > 1) overallResults[username].incremented.push(`${rarity} ${normName}`);
              else overallResults[username].added.push(`${rarity} ${normName}`);
            }
          } catch (err) {
            console.error('[bulkassign] error on incOrUpsertCard', username, userId, rawCard, err);
            overallResults[username].errors.push(`exception: ${rawCard}`);
          }
        }
      }

      // Build reply embed (trim long lists for readability)
      const lines = [];
      for (const [username, data] of Object.entries(overallResults)) {
        const parts = [];
        if (data.added.length) parts.push(`Added: ${data.added.join('; ')}`);
        if (data.incremented.length) parts.push(`Incremented: ${data.incremented.join('; ')}`);
        if (data.errors.length) parts.push(`Errors: ${data.errors.join('; ')}`);
        if (!parts.length) parts.push('No changes');
        lines.push(`**${username}** (${data.id}) — ${parts.join(' — ')}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('Bulk assignment complete')
        .setDescription(lines.slice(0, 25).join('\n'))
        .setColor(0x2E8B57)
        .setTimestamp();

      if (lines.length > 25) {
        embed.addFields({ name: 'Note', value: `...and ${lines.length - 25} more users (omitted)` });
      }

      return message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[bulkassign] unexpected error', err);
      return message.reply({ content: 'Unexpected error running bulkassign.' }).catch(() => {});
    }
  }
};
