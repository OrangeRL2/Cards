// commands/givemiss.js
const { EmbedBuilder } = require('discord.js');
const path = require('node:path');

const User = require('../models/User');
const pools = require('../utils/loadImages');
const { resolveCardColor } = require('../config/holomemColor');

// Keep consistent with your other prefix command style
const PREFIX = '!';
const ALLOWED_IDS = ['153551890976735232', '409717160995192832', '272129129841688577']; // same pattern as admingive [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/admingive.js)

// Same rarity order as /miss [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/miss.js)
const RARITY_ORDER = [
  'XMAS', 'VAL', 'EAS', 'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'COL', 'OSR', 'P',
  'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC', 'ORI'
];

// Small flag parser (matches your admingive style) [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/admingive.js)
function parseFlags(content) {
  const tokenRe = /--[^\s=]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?/g;
  const tokens = content.match(tokenRe) || [];
  const flags = {};
  for (const tok of tokens) {
    const withoutLeading = tok.slice(2);
    const [k, v] = withoutLeading.split(/=(.+)/);
    if (v === undefined) flags[k] = true;
    else flags[k] = v.replace(/^"(.+)"$/s, '$1').replace(/^'(.+)'$/s, '$1');
  }
  return flags;
}

module.exports = {
  name: 'givemiss',
  description: 'Give a user all cards that would show up in /miss (admin only)',

  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Admin-only like !admingive (recommended to prevent abuse) [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/admingive.js)
      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const flags = parseFlags(message.content);

      // Optional:
      // --target=@user (defaults to author)
      // --rarity=ALL|SEC|UR|...
      // --search=substring
      // --color=white|green|red|blue|purple|yellow|support|mixed|typo|none
      // --dry (no DB writes; shows how many would be granted)
      const rawTarget = flags.target;
      const filterR = String(flags.rarity || 'ALL').toUpperCase();
      const filterQ = flags.search ? String(flags.search).toLowerCase() : null;
      const filterColor = flags.color ? String(flags.color).trim().toLowerCase() : null;
      const dryRun = !!flags.dry;

      const guild = message.guild;
      if (!guild) {
        return message.reply({ content: 'This command must be used in a guild.' }).catch(() => {});
      }

      // Resolve target user (single user only)
      let targetUser = message.author;
      if (rawTarget) {
        const id =
          (rawTarget.match(/<@!?(\d+)>/) || rawTarget.match(/^(\d+)$/))?.[1];

        if (!id) {
          return message.reply({ content: 'Could not parse --target. Use @mention or user ID.' }).catch(() => {});
        }
        const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
        if (!member) {
          return message.reply({ content: 'Target user not found in this guild.' }).catch(() => {});
        }
        targetUser = member.user;
      }

      // Ensure user doc exists (same idea as admingive upsert) [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/admingive.js)
      await User.updateOne(
        { id: targetUser.id },
        { $setOnInsert: { pulls: 0, points: 0, cards: [], pendingAttempts: [] } },
        { upsert: true }
      ).exec();

      const userDoc = await User.findOne({ id: targetUser.id }).lean();
      const ownedArr = Array.isArray(userDoc?.cards) ? userDoc.cards : [];

      // Build owned map for exact rarity+name match, same as /miss logic [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/miss.js)
      const ownedMap = new Map();
      for (const c of ownedArr) {
        const key = `${c.rarity}::${c.name}`;
        ownedMap.set(key, Number(c.count ?? c.qty ?? 0));
      }

      // Build the same "universe" used by /miss from pools [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/miss.js)
      const universe = [];
      for (const rarity of RARITY_ORDER) {
        const files = Array.isArray(pools[rarity]) ? pools[rarity] : [];
        for (const f of files) {
          const name = path.basename(f, path.extname(f));
          universe.push({ rarity, name });
        }
      }

      // Filter + compute missing (same rules as /miss: missing if no record or count <= 0) [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/miss.js)
      const missing = universe.filter(card => {
        if (filterR !== 'ALL' && card.rarity !== filterR) return false;
        if (filterQ && !card.name.toLowerCase().includes(filterQ)) return false;

        if (filterColor) {
          const cc = resolveCardColor(card.name, card.rarity);
          if (filterColor === 'none') {
            if (cc !== null && cc !== 'none') return false;
          } else {
            if (cc !== filterColor) return false;
          }
        }

        const key = `${card.rarity}::${card.name}`;
        const cnt = ownedMap.has(key) ? ownedMap.get(key) : null;
        if (cnt === null) return true;
        return !Number.isFinite(cnt) || cnt <= 0;
      });

      if (missing.length === 0) {
        return message.reply({ content: `✅ ${targetUser.username} has no missing cards for these filters.` }).catch(() => {});
      }

      // Split missing into:
      // - toPush: doesn't exist in cards array
      // - toSetOne: exists but count <= 0
      const toPush = [];
      const toSetOne = [];

      for (const card of missing) {
        const key = `${card.rarity}::${card.name}`;
        if (!ownedMap.has(key)) toPush.push(card);
        else toSetOne.push(card);
      }

      if (!dryRun) {
        const ops = [];

        // Set existing entries to 1
        for (const card of toSetOne) {
          ops.push({
            updateOne: {
              filter: { id: targetUser.id, cards: { $elemMatch: { name: card.name, rarity: card.rarity } } },
              update: { $set: { 'cards.$.count': 1 } }
            }
          });
        }

        // Push all new ones in a single update
        if (toPush.length) {
          ops.push({
            updateOne: {
              filter: { id: targetUser.id },
              update: {
                $push: {
                  cards: {
                    $each: toPush.map(c => ({ name: c.name, rarity: c.rarity, count: 1 }))
                  }
                }
              }
            }
          });
        }

        if (ops.length) {
          await User.bulkWrite(ops, { ordered: false });
        }
      }

      const preview = missing.slice(0, 20).map(c => `• [${c.rarity}] ${c.name}`).join('\n');
      const more = missing.length > 20 ? `\n...and ${missing.length - 20} more` : '';

      const embed = new EmbedBuilder()
        .setTitle(dryRun ? 'GiveMiss (Dry Run)' : 'GiveMiss Complete')
        .setDescription(
          `${dryRun ? 'Would give' : 'Gave'} **${missing.length}** missing card(s) to **${targetUser.username}**.\n\n` +
          `**Newly added:** ${toPush.length}\n` +
          `**Fixed (count→1):** ${toSetOne.length}\n\n` +
          `**Preview:**\n${preview}${more}`
        )
        .setColor(dryRun ? 0xF1C40F : 0x2ECC71);

      return message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[givemiss] error', err);
      return message.reply({ content: 'Unexpected error running givemiss.' }).catch(() => {});
    }
  }
};