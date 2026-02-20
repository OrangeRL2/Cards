const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  Colors,
} = require('discord.js');
const User = require('../../models/User');
const { normalizeCards } = require('../../utils/normalizeCards');

const ITEMS_PER_PAGE = 10;
const IDLE_LIMIT = 120_000;

// Cards to always hide from output (any rarity)
const EXCEPTION_LIST = [
  'Test 001',
  'Test 999',
  'Test 002',
];

const EXCEPTION_SET = new Set(
  EXCEPTION_LIST.map(n => String(n).trim().toLowerCase()).filter(Boolean)
);

function isExcludedCardName(name) {
  return EXCEPTION_SET.has(String(name).trim().toLowerCase());
}


// RARITY order consistent with inventory / miss (later items considered rarer)
const RARITY_ORDER = [
  'XMAS', 'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'COL', 'OSR', 'P', 'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC', "VAL", "ORI"
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('diff')
    .setDescription('Show card differences between you and another user')
    .addUserOption(opt => opt.setName('user').setDescription('Target user to compare').setRequired(true))
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Which direction to show')
        .addChoices(
          { name: 'From', value: 'theirs-minus-yours' },
          { name: 'For', value: 'yours-minus-theirs' },
        ).setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('rarity')
        .setDescription('Filter by rarity (optional)')
    )
    .addStringOption(opt =>
      opt.setName('search')
        .setDescription('Search by card name (optional)')
    )
    .addStringOption(opt =>
      opt.setName('sort')
      .setDescription('Sort results by')
      .addChoices(
        { name: 'Rarity (default)', value: 'rarity' },
        { name: 'Amount difference', value: 'amount' }
      )
      .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('multi')
        .setDescription('Only show cards where the source user has more than 1 copy')
        .setRequired(false)
    ),
  requireOshi: true,

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    if (!targetUser || targetUser.bot) {
      await interaction.reply({ content: 'Please specify a valid user (not a bot).', ephemeral: true });
      return;
    }
    const mode = interaction.options.getString('mode');
    const filterR = interaction.options.getString('rarity');
    const filterQ = interaction.options.getString('search')?.toLowerCase();
    const sortBy = interaction.options.getString('sort') || 'rarity';
    const multiOnly = Boolean(interaction.options.getBoolean('multi'));

    await interaction.deferReply({ ephemeral: false });

    try {
      const [youDoc, themDoc] = await Promise.all([
        User.findOne({ id: interaction.user.id }),
        User.findOne({ id: targetUser.id }),
      ]);

      const youCards = normalizeCards(youDoc?.cards).filter(c => !isExcludedCardName(c.name));
      const themCards = normalizeCards(themDoc?.cards).filter(c => !isExcludedCardName(c.name));

      // Build maps keyed by lower-case name::rarity -> count
      const keyOf = c => `${String(c.name)}::${String(c.rarity)}`;
      const youMap = new Map(youCards.map(c => [keyOf(c), c.count || 0]));
      const themMap = new Map(themCards.map(c => [keyOf(c), c.count || 0]));

      // Build list depending on mode
      let results = [];
      if (mode === 'theirs-minus-yours') {
        for (const c of themCards) {
          if (filterR && c.rarity !== filterR) continue;
          if (filterQ && !String(c.name).toLowerCase().includes(filterQ)) continue;
          const k = keyOf(c);
          const youCount = youMap.get(k) || 0;
          const themCount = c.count || 0;
          // show only cards the target has that you have zero of
          if (youCount !== 0) continue;
          if (themCount <= 0) continue;
          if (multiOnly && themCount <= 1) continue;
          const diff = themCount - youCount; // effectively themCount
          results.push({ name: c.name, rarity: c.rarity, youCount, themCount, diff });
        }
      } else {
        for (const c of youCards) {
          if (filterR && c.rarity !== filterR) continue;
          if (filterQ && !String(c.name).toLowerCase().includes(filterQ)) continue;
          const k = keyOf(c);
          const themCount = themMap.get(k) || 0;
          const youCount = c.count || 0;
          // show only cards you have that the other user has zero of
          if (themCount !== 0) continue;
          if (youCount <= 0) continue;
          if (multiOnly && youCount <= 1) continue;
          const diff = youCount - themCount; // effectively youCount
          results.push({ name: c.name, rarity: c.rarity, youCount, themCount, diff });
        }
      }

      if (results.length === 0) {
        await interaction.editReply({ content: 'No differences found for the chosen filters.', ephemeral: true });
        return;
      }

      // Build order map where larger value means rarer; sort by descending rarity then name
      const ORDER = {};
      RARITY_ORDER.forEach((r, i) => { ORDER[r] = i + 1; });

      results.sort((a, b) => {
        if (sortBy === 'amount') {
          // primary sort: difference amount desc
          const dd = b.diff - a.diff;
          if (dd !== 0) return dd;
          // tie-breaker: rarity desc, then name
        }
        const oa = ORDER[a.rarity] || 0;
        const ob = ORDER[b.rarity] || 0;
        const dr = ob - oa;
        if (dr !== 0) return dr;
        // final tie-breaker alphabetical
        return a.name.localeCompare(b.name);
      });

      // paginate
      const pages = [];
      for (let i = 0; i < results.length; i += ITEMS_PER_PAGE) pages.push(results.slice(i, i + ITEMS_PER_PAGE));

      const buildEmbed = (pageIdx) => {
        const page = pages[pageIdx];
        const desc = page.map(c => {
          return `**[${c.rarity}]** ${c.name} (${c.diff})`;
        }).join('\n');
        return new EmbedBuilder()
          .setTitle(mode === 'theirs-minus-yours'
            ? `${targetUser.username}'s cards you don't have`
            : `Your cards ${targetUser.username} doesn't have`)
          .setDescription(desc)
          .setColor(Colors.Blue)
          .setFooter({ text: `Page ${pageIdx + 1}/${pages.length} • ${results.length} items` });
      };

      // scoped custom ids
      const uid = interaction.id ?? `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const prevId = `diff_prev_${uid}`;
      const nextId = `diff_next_${uid}`;

      // Buttons disabled only when there's a single page
      const singlePage = pages.length === 1;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(prevId).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(singlePage),
        new ButtonBuilder().setCustomId(nextId).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(singlePage),
      );

      await interaction.editReply({ embeds: [buildEmbed(0)], components: [row] });
      const message = await interaction.fetchReply();

      let pageIdx = 0;
      // collector filters to invoking user + our customIds
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: btn => btn.user.id === interaction.user.id && (btn.customId === prevId || btn.customId === nextId),
      });

      let idleTimeout = null;
      function resetIdleTimer() {
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => collector.stop('idle'), IDLE_LIMIT);
      }
      resetIdleTimer();

      collector.on('collect', async btn => {
        resetIdleTimer();
        try {
          if (btn.customId === prevId) {
            // wrap to last if at first
            pageIdx = pageIdx === 0 ? pages.length - 1 : pageIdx - 1;
          } else if (btn.customId === nextId) {
            // wrap to first if at last
            pageIdx = pageIdx === pages.length - 1 ? 0 : pageIdx + 1;
          }

          // update button state: still only disabled when a single page exists
          const newRow = ActionRowBuilder.from(row);
          newRow.components[0].setDisabled(singlePage);
          newRow.components[1].setDisabled(singlePage);

          await btn.update({ embeds: [buildEmbed(pageIdx)], components: [newRow] });
        } catch (err) {
          console.error('diff collector error', err);
          try {
            if (!btn.replied && !btn.deferred) await btn.reply({ content: 'Internal error.', ephemeral: true });
          } catch {}
        }
      });

      collector.on('end', async () => {
        try {
          if (idleTimeout) clearTimeout(idleTimeout);
          const disabledRow = ActionRowBuilder.from(row);
          disabledRow.components.forEach(c => c.setDisabled(true));
          await message.edit({ components: [disabledRow] });
        } catch (err) {
          console.error('diff cleanup error', err);
        }
      });
    } catch (err) {
      console.error('diff command error', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred.', ephemeral: true });
        } else {
          await interaction.editReply({ content: 'An error occurred.', ephemeral: true });
        }
      } catch {}
    }
  },
};
