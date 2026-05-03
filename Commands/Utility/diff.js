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
const { resolveCardColor, getAttributeEmoji } = require('../../config/holomemColor');
const { rarityChoices, parseRarityFilter } = require('../../utils/rarities');
const ITEMS_PER_PAGE = 10;
const IDLE_LIMIT = 120_000;

// Cards to always hide from output (any rarity)
const EXCEPTION_LIST = [
  'Test 001',
  'Test 999',
  'Test 002',
  'Test 998',
];

const EXCEPTION_SET = new Set(
  EXCEPTION_LIST.map(n => String(n).trim().toLowerCase()).filter(Boolean)
);

function isExcludedCardName(name) {
  return EXCEPTION_SET.has(String(name).trim().toLowerCase());
}


function normCount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}



// Attribute (color/type) sort order
const COLOR_SORT_ORDER = {
  white: 1,
  green: 2,
  red: 3,
  blue: 4,
  purple: 5,
  yellow: 6,
  support: 7,
  mixed: 8,
  typo: 9,
  none: 10,
};
function colorRankOf(name, rarity) {
  const c = resolveCardColor(name, rarity) ?? 'none';
  return COLOR_SORT_ORDER[String(c).toLowerCase()] ?? 999;
}
// RARITY order consistent with inventory / miss (later items considered rarer)
const RARITY_ORDER = [
  'XMAS', "VAL", "EAS", 'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'COL', 'OSR', 'P', 'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC',  "ORI"
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
    .setDescription('Rarity')
    .addChoices(...rarityChoices({ includeAnyAll: true }))
)
    .addStringOption(opt =>
      opt.setName('search')
        .setDescription('Search by card name (optional)')
    )
    
  .addStringOption(opt =>
    opt.setName('color')
      .setDescription('Filter by attribute color')
      .addChoices(
        { name: 'White', value: 'white' },
        { name: 'Green', value: 'green' },
        { name: 'Red', value: 'red' },
        { name: 'Blue', value: 'blue' },
        { name: 'Purple', value: 'purple' },
        { name: 'Yellow', value: 'yellow' },
        { name: 'Support', value: 'support' },
        { name: 'Typo', value: 'typo' },
        { name: 'Mixed', value: 'mixed' },
        { name: 'None', value: 'none' },
      )
  )
.addStringOption(opt =>
      opt.setName('sort')
      .setDescription('Sort results by')
      .addChoices(
        { name: 'Rarity (default)', value: 'rarity' },
        { name: 'Amount difference', value: 'amount' },
 { name: 'Color (attribute)', value: 'color' }
      )
      .setRequired(false)
    )
 .addBooleanOption(opt =>
 opt.setName('allowlocked')
 .setDescription('Include locked cards in diff results')
 .setRequired(false)
 )
,
 requireOshi: true,

  async execute(interaction) {
    const { any, rarity } = parseRarityFilter(interaction.options.getString('rarity'));
    const targetUser = interaction.options.getUser('user');
    if (!targetUser || targetUser.bot) {
      await interaction.reply({ content: 'Please specify a valid user (not a bot).', ephemeral: true });
      return;
    }
    const mode = interaction.options.getString('mode');
    const filterR = interaction.options.getString('rarity');
  const filterRNorm = filterR ? String(filterR).trim().toUpperCase() : null;
  const targetAllRarities = !filterRNorm || filterRNorm === 'ALL' || filterRNorm === 'ANY' || filterRNorm === '*';
    const filterQ = interaction.options.getString('search')?.toLowerCase();
  const filterColor = interaction.options.getString('color');
    const sortBy = interaction.options.getString('sort') || 'rarity';
    const multiFilter = interaction.options.getBoolean('multi'); // true, false, or null
  const multiOnly = multiFilter === true;
  const singleOnly = multiFilter === false;
  const allowLocked = Boolean(interaction.options.getBoolean('allowlocked'));

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
 // Lock maps (keyed by name::rarity) so we can exclude locked cards by default
 const youLockedMap = new Map((youDoc?.cards || []).map(c => [keyOf(c), Boolean(c.locked)]));
 const themLockedMap = new Map((themDoc?.cards || []).map(c => [keyOf(c), Boolean(c.locked)]));

      const youMap = new Map(youCards.map(c => [keyOf(c), normCount(c.count)]));
      const themMap = new Map(themCards.map(c => [keyOf(c), normCount(c.count)]));

      // Build list depending on mode
      let results = [];
      if (mode === 'theirs-minus-yours') {
        for (const c of themCards) {
          if (!targetAllRarities && String(c.rarity).trim().toUpperCase() !== filterRNorm) continue;
          if (filterQ && !String(c.name).toLowerCase().includes(filterQ)) continue;
      if (filterColor) {
        const wanted = String(filterColor).trim().toLowerCase();
        const cc = resolveCardColor(c.name, c.rarity);
        if (wanted === 'none') {
          if (cc !== null && cc !== 'none') continue;
        } else {
          if (cc !== wanted) continue;
        }
      }
          const k = keyOf(c);
 // Exclude locked cards by default (unless allowlocked=true)
 const sourceLocked = Boolean(themLockedMap.get(k) ?? c.locked);
 if (!allowLocked && sourceLocked) continue;
          
          const youCount = normCount(youMap.get(k));
          const themCount = normCount(c.count);
          
          // show only cards the target has that you have zero of
          if (youCount !== 0) continue;
          if (themCount <= 0) continue;
          if (multiOnly && themCount <= 1) continue;
      if (singleOnly && themCount !== 1) continue;
          const diff = themCount - youCount; // effectively themCount
          results.push({ name: c.name, rarity: c.rarity, youCount, themCount, diff });
        }
      } else {
        for (const c of youCards) {
          if (!targetAllRarities && String(c.rarity).trim().toUpperCase() !== filterRNorm) continue;
          if (filterQ && !String(c.name).toLowerCase().includes(filterQ)) continue;
      if (filterColor) {
        const wanted = String(filterColor).trim().toLowerCase();
        const cc = resolveCardColor(c.name, c.rarity);
        if (wanted === 'none') {
          if (cc !== null && cc !== 'none') continue;
        } else {
          if (cc !== wanted) continue;
        }
      }
          const k = keyOf(c);
 // Exclude locked cards by default (unless allowlocked=true)
 const sourceLocked = Boolean(youLockedMap.get(k) ?? c.locked);
 if (!allowLocked && sourceLocked) continue;
          const themCount = themMap.get(k) || 0;
          const youCount = c.count || 0;
          // show only cards you have that the other user has zero of
          if (themCount !== 0) continue;
          if (youCount <= 0) continue;
          if (multiOnly && youCount <= 1) continue;
      if (singleOnly && youCount !== 1) continue;
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
        if (sortBy === 'color') {
      const ca = colorRankOf(a.name, a.rarity);
      const cb = colorRankOf(b.name, b.rarity);
      const dc = ca - cb;
      if (dc !== 0) return dc;
      // tie-breakers below
    }
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
        const cc = resolveCardColor(c.name, c.rarity);
        const emoji = cc ? getAttributeEmoji(cc) : '';
        const tag = emoji ? ` ${emoji}` : '';
        return `**[${c.rarity}]** ${c.name}${tag} (${c.diff})`;
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
