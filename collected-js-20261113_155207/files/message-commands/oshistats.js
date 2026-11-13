// message-commands/oshistats.js
// Shows oshi selections ranked from most picked to least picked.

const { EmbedBuilder } = require('discord.js');
const Oshi = require('../models/Oshi');
const OSHI_LIST = require('../config/oshis');

module.exports = {
  name: 'oshistats',
  description: 'Shows the most picked oshis from most to least.',

  async execute(message) {
    try {
      if (message.author?.bot) return;

      // Count selections directly in the Oshi collection. This intentionally
      // does not touch User/cards, so it stays lightweight even with huge inventories.
      const grouped = await Oshi.aggregate([
        {
          $group: {
            _id: '$oshiId',
            count: { $sum: 1 },
          },
        },
      ]).exec();

      const counts = new Map(
        grouped.map(row => [String(row._id ?? '').trim().toLowerCase(), Number(row.count) || 0])
      );

      const configuredIds = new Set(
        OSHI_LIST.map(oshi => String(oshi.id).trim().toLowerCase())
      );

      // Include every configured oshi, including those with 0 picks.
      const ranked = OSHI_LIST.map(oshi => ({
        id: String(oshi.id),
        label: String(oshi.label || oshi.id),
        count: counts.get(String(oshi.id).trim().toLowerCase()) || 0,
      }));

      // If an old/admin-edited record contains an oshiId that no longer exists
      // in config/oshis.js, keep it visible instead of silently dropping it.
      for (const row of grouped) {
        const rawId = String(row._id ?? '').trim();
        if (!rawId) continue;
        if (configuredIds.has(rawId.toLowerCase())) continue;

        ranked.push({
          id: rawId,
          label: `${rawId} (unlisted)`,
          count: Number(row.count) || 0,
        });
      }

      ranked.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
      });

      const totalSelections = grouped.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
      const pickedOshis = ranked.filter(row => row.count > 0).length;

      const lines = ranked.map((row, index) => {
        const rank = String(index + 1).padStart(2, '0');
        return `**${rank}. ${row.label}** — ${row.count}`;
      });

      // Discord embed descriptions are limited to 4096 chars. The current oshi
      // roster fits comfortably, but chunk into fields as a fallback if it grows.
      const fullText = lines.join('\n');
      const embed = new EmbedBuilder()
        .setTitle('Oshi Popularity Rankings')
        .setColor(0xff69b4)
        .setFooter({ text: `${totalSelections} total selections • ${pickedOshis} oshis currently picked` })
        .setTimestamp();

      if (fullText.length <= 4096) {
        embed.setDescription(fullText || 'No oshi selections found.');
      } else {
        const chunks = [];
        let chunk = '';

        for (const line of lines) {
          if ((chunk + '\n' + line).length > 1000) {
            if (chunk) chunks.push(chunk);
            chunk = line;
          } else {
            chunk = chunk ? `${chunk}\n${line}` : line;
          }
        }
        if (chunk) chunks.push(chunk);

        for (let i = 0; i < Math.min(chunks.length, 25); i += 1) {
          embed.addFields({
            name: i === 0 ? 'Rankings' : '\u200b',
            value: chunks[i],
            inline: false,
          });
        }
      }

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('[oshistats] error', err);
      return message.reply({ content: 'Failed to load oshi popularity stats.' }).catch(() => {});
    }
  },
};
