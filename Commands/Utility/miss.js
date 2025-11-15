// commands/Utility/miss.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  Colors,
} = require('discord.js');
const path = require('node:path');
const User = require('../../models/User');
const pools = require('../../utils/loadImages');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const PAGE_SIZE = 10;

const RARITY_ORDER = [
  'C', 'OC', 'U', 'R', 'S', 'P','SP','UP', 'SY', 'RR', 'SR', 'OSR', 'UR', 'OUR', 'SEC', 'HR', 'bday',
];

const COLOR_MAP = {
  UR: Colors.DarkPurple, R: Colors.Green, C: Colors.Grey,
  U: Colors.LightGrey, RR: Colors.Green, SR: Colors.Gold,
  OSR: Colors.Purple, OUR: Colors.DarkPurple, SEC: Colors.Orange,
  S: Colors.Blue, HR: Colors.DarkBlue, SY: Colors.Gold, OC: Colors.Grey, P: Colors.Gold,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('miss')
    .setDescription('Show which cards you do not have yet')
    .addStringOption(opt =>
      opt.setName('rarity')
        .setDescription('Filter by rarity')
        .addChoices(
          { name: 'All', value: 'ALL' },
          ...RARITY_ORDER.map(r => ({ name: r, value: r })),
        ),
    )
    .addStringOption(opt =>
      opt.setName('search')
        .setDescription('Search missing card names'),
    ),
  requireOshi: true,

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const filterR = interaction.options.getString('rarity') || 'ALL';
      const filterQ = interaction.options.getString('search')?.toLowerCase();

      // load user doc and owned map
      const userDoc = await User.findOne({ id: interaction.user.id });
      const owned = Array.isArray(userDoc?.cards) ? userDoc.cards : [];

      // build universe from pools in desired order
      const universe = [];
      for (const rarity of RARITY_ORDER) {
        const files = Array.isArray(pools[rarity]) ? pools[rarity] : [];
        for (const f of files) {
          const name = path.basename(f, path.extname(f));
          universe.push({ rarity, name, file: f });
        }
      }

      // filter and select missing: consider owned only when exact rarity matches
      let missing = universe.filter(card => {
        if (filterR !== 'ALL' && card.rarity !== filterR) return false;
        if (filterQ && !card.name.toLowerCase().includes(filterQ)) return false;

        const info = owned.find(c => c.name === card.name && c.rarity === card.rarity);
        // If no entry for this name -> missing
        if (!info) return true;
        // If entry exists but rarity differs -> still missing for this rarity
        if (info.rarity !== card.rarity) return true;
        // exact name+rarity match -> owned
        return false;
      });

      if (missing.length === 0) {
        return interaction.editReply({ content: 'You have all matching cards (no misses).', ephemeral: true });
      }

      // order by rarity (RARITY_ORDER) then name
      const orderIndex = r => {
        const idx = RARITY_ORDER.indexOf(r);
        return idx === -1 ? 999 : idx;
      };
      missing.sort((a, b) => {
        const d = orderIndex(a.rarity) - orderIndex(b.rarity);
        return d || a.name.localeCompare(b.name);
      });

      // paginate
      const pages = [];
      for (let i = 0; i < missing.length; i += PAGE_SIZE) {
        pages.push(missing.slice(i, i + PAGE_SIZE));
      }

      const buildEmbed = (pageIdx) => {
        const page = pages[pageIdx];
        const description = page.map(c => `**[${c.rarity}]** ${c.name}`).join('\n');
        const first = page[0];
        const color = COLOR_MAP[first?.rarity] ?? Colors.Default;

        return new EmbedBuilder()
          .setTitle(`Missing cards (${missing.length} total)`)
          .setDescription(description)
          .setColor(color)
          .setFooter({ text: `Page ${pageIdx + 1} of ${pages.length}` });
      };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('miss_prev')
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('miss_next')
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(pages.length === 1),
      );

      await interaction.editReply({ embeds: [buildEmbed(0)], components: [row] });
      const message = await interaction.fetchReply();

      let idx = 0;
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120_000,
      });

      collector.on('collect', async btnInt => {
        try {
          if (btnInt.user.id !== interaction.user.id) {
            return btnInt.reply({ content: 'Not yours!', ephemeral: true });
          }

          idx += btnInt.customId === 'miss_next' ? 1 : -1;
          idx = Math.max(0, Math.min(idx, pages.length - 1));

          row.components[0].setDisabled(idx === 0);
          row.components[1].setDisabled(idx === pages.length - 1);

          await btnInt.update({ embeds: [buildEmbed(idx)], components: [row] });
        } catch (err) {
          console.error('miss collector error', err);
          if (!btnInt.replied && !btnInt.deferred) {
            await btnInt.reply({ content: 'Internal error.', ephemeral: true });
          }
        }
      });

      collector.on('end', async () => {
        try {
          row.components.forEach(c => c.setDisabled(true));
          await message.edit({ components: [row] });
        } catch (e) { /* ignore */ }
      });

    } catch (err) {
      console.error('miss command error', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', ephemeral: true });
        } else {
          await interaction.editReply({ content: 'An error occurred.', ephemeral: true });
        }
      } catch (e) { /* ignore */ }
    }
  },
};
