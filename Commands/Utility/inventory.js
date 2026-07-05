const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  Colors,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const User = require('../../models/User');
const { resolveCardColor, getAttributeEmoji } = require('../../config/holomemColor');

const IMAGE_BASE = 'http://152.69.195.48/images';
const ITEMS_PER_PAGE = 10;
const IDLE_LIMIT = 120_000; // 2 minutes

// Cards to always hide from output (any rarity)
const EXCEPTION_LIST = [
  'Test 001',
  'Test 999',
  'Test 002',
  'Test ',
  'Test 998',
];

// Normalized set for fast case-insensitive exact matching
const EXCEPTION_SET = new Set(
  EXCEPTION_LIST.map(n => String(n).trim().toLowerCase()).filter(Boolean)
);

function isExcludedCardName(name) {
  return EXCEPTION_SET.has(String(name).trim().toLowerCase());
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

function escapeMarkdown(str = '') {
  return String(str).replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
}

const RARITY_ORDER = {
  XMAS: 1,
  VAL: 2,
  EAS: 3,
  C: 4,
  U: 5,
  R: 6,
  S: 7,
  RR: 8,
  OC: 9,
  SR: 10,
  OSR: 11,
  COL: 12,
  P: 13,
  SP: 14,
  UP: 15,
  SY: 16,
  UR: 17,
  OUR: 18,
  HR: 19,
  BDAY: 20,
  SEC: 21,
  ORI: 22,
};

const RARITY_COLORS = {
  XMAS: 0x05472A,
  C: Colors.Grey,
  U: Colors.White,
  R: 0x7bacec,
  S: 0x55DDEE,
  RR: 0x2A69FB,
  OC: Colors.Fuchsia,
  SR: 0xEE7744,
  COL: 0xFF3377,
  OSR: 0xB19CD9,
  P: 0xDDFFEE,
  SP: 0x33DDAA,
  SY: Colors.DarkAqua,
  UR: 0xFF9922,
  OUR: Colors.DarkPurple,
  HR: Colors.Gold,
  BDAY: 0xF9CDCF,
  UP: 0xFFEE22,
  SEC: 0x6CCDF8,
  VAL: Colors.Red,
  ORI: Colors.Orange,
  EAS: 0xFF2301,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Show your card inventory')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('View another user\'s inventory (optional)')
    )
    .addStringOption(opt =>
      opt
        .setName('rarity')
        .setDescription('Filter by rarity')
        .addChoices(
          { name: 'XMAS', value: 'XMAS' },
          { name: 'VAL', value: 'VAL' },
          { name: 'EAS', value: 'EAS' },
          { name: 'C', value: 'C' },
          { name: 'U', value: 'U' },
          { name: 'R', value: 'R' },
          { name: 'S', value: 'S' },
          { name: 'RR', value: 'RR' },
          { name: 'OC', value: 'OC' },
          { name: 'SR', value: 'SR' },
          { name: 'COL', value: 'COL' },
          { name: 'OSR', value: 'OSR' },
          { name: 'P', value: 'P' },
          { name: 'SP', value: 'SP' },
          { name: 'UP', value: 'UP' },
          { name: 'SY', value: 'SY' },
          { name: 'UR', value: 'UR' },
          { name: 'OUR', value: 'OUR' },
          { name: 'HR', value: 'HR' },
          { name: 'BDAY', value: 'BDAY' },
          { name: 'SEC', value: 'SEC' },
          { name: 'ORI', value: 'ORI' },
          { name: 'EV', value: 'EV' },
        )
    )
    .addStringOption(opt =>
      opt
        .setName('search')
        .setDescription('Search by card name')
    )
    .addStringOption(opt =>
      opt
        .setName('color')
        .setDescription('Filter by attribute color (member default, can be wrong for some cards due to exceptions)')
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
      opt
        .setName('sort')
        .setDescription('Sort order')
        .addChoices(
          { name: 'Rarity (default)', value: 'rarity' },
          { name: 'Newest first', value: 'newest' },
          { name: 'Oldest first', value: 'oldest' },
          { name: 'Amount (count)', value: 'amount' },
          { name: 'Color (attribute)', value: 'color' },
        )
    )
    .addBooleanOption(opt =>
      opt
        .setName('multi')
        .setDescription('Show only cards you have 2 or more of')
    )
    .addBooleanOption(opt =>
      opt
        .setName('lockedonly')
        .setDescription('Show only locked cards')
    ),

  requireOshi: true,

  async execute(interaction) {
    const explicitTarget = interaction.options.getUser('user');
    const targetUser = explicitTarget ? explicitTarget : interaction.user;

    if (targetUser.bot) {
      await interaction.reply({ content: 'You cannot view a bot inventory.', ephemeral: true });
      return;
    }

    const ephemeralReply = targetUser.id !== interaction.user.id;
    await interaction.deferReply();

    const filterR = interaction.options.getString('rarity');
    const filterQ = interaction.options.getString('search')?.toLowerCase();
    const filterColor = interaction.options.getString('color');
    const sortBy = interaction.options.getString('sort') || 'rarity';
    const multiFilter = interaction.options.getBoolean('multi'); // true, false, or null
    const lockedOnly = interaction.options.getBoolean('lockedonly') === true;

    const userDoc = await User.findOne({ id: targetUser.id });

    if (!userDoc || !userDoc.cards || userDoc.cards.length === 0) {
      return interaction.editReply({
        content: targetUser.id === interaction.user.id
          ? 'No cards yet. Use `/pull`!'
          : `${targetUser.username} has no cards yet.`,
        ephemeral: ephemeralReply,
      });
    }

    // Flatten cards array into entries
    const allEntries = userDoc.cards.map(c => ({
      name: c.name,
      rarity: c.rarity,
      count: Number(c.count || 0),
      locked: Boolean(c.locked),
      firstAcquiredAt: c.firstAcquiredAt ? new Date(c.firstAcquiredAt).getTime() : 0,
      lastAcquiredAt: c.lastAcquiredAt ? new Date(c.lastAcquiredAt).getTime() : 0,
    }));

    // Apply filters
    let entries = allEntries.filter(c => {
      if (filterR && c.rarity !== filterR) return false;
      if (filterQ && !c.name.toLowerCase().includes(filterQ)) return false;
      if (multiFilter === true && c.count < 2) return false;
      if (multiFilter === false && c.count !== 1) return false;
      if (lockedOnly && !c.locked) return false;
      if (isExcludedCardName(c.name)) return false;

      if (filterColor) {
        const wanted = String(filterColor).trim().toLowerCase();
        const cc = resolveCardColor(c.name, c.rarity);

        // 'none' means: show cards with no resolved attribute
        if (wanted === 'none') {
          if (cc !== null && cc !== 'none') return false;
        } else {
          if (cc !== wanted) return false;
        }
      }

      return true;
    });

    if (!entries.length) {
      let filterMessage = 'No cards match filters.';
      if (lockedOnly) filterMessage = 'No locked cards match filters.';
      else if (multiFilter === true) filterMessage = 'No cards match filters (or no cards with 2 or more copies).';
      else if (multiFilter === false) filterMessage = 'No cards match filters (or no single-copy cards).';

      return interaction.editReply({ content: filterMessage, ephemeral: ephemeralReply });
    }

    // Totals
    const totalCards = allEntries.reduce((sum, e) => sum + e.count, 0);
    const filteredCards = entries.reduce((sum, e) => sum + e.count, 0);
    const lockedTotal = allEntries.filter(e => e.locked).reduce((sum, e) => sum + e.count, 0);

    // Sorting
    if (sortBy === 'newest') {
      entries.sort((a, b) => (b.lastAcquiredAt || 0) - (a.lastAcquiredAt || 0));
    } else if (sortBy === 'oldest') {
      entries.sort((a, b) => (a.firstAcquiredAt || 0) - (b.firstAcquiredAt || 0));
    } else if (sortBy === 'amount') {
      entries.sort((a, b) => {
        const ca = a.count;
        const cb = b.count;
        if (cb !== ca) return cb - ca;
        return a.name.localeCompare(b.name);
      });
    } else if (sortBy === 'color') {
      entries.sort((a, b) => {
        const ca = colorRankOf(a.name, a.rarity);
        const cb = colorRankOf(b.name, b.rarity);
        if (ca !== cb) return ca - cb;

        const dr = (RARITY_ORDER[b.rarity] ?? 999) - (RARITY_ORDER[a.rarity] ?? 999);
        if (dr !== 0) return dr;

        return a.name.localeCompare(b.name);
      });
    } else {
      entries.sort((a, b) => {
        const d = (RARITY_ORDER[b.rarity] || 999) - (RARITY_ORDER[a.rarity] || 999);
        if (d !== 0) return d;
        return a.name.localeCompare(b.name);
      });
    }

    // Paginate
    const totalPages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
    const pages = Array.from(
      { length: totalPages },
      (_, i) => entries.slice(i * ITEMS_PER_PAGE, (i + 1) * ITEMS_PER_PAGE)
    );

    // Prepare image data
    const imageResults = entries.map(c => ({
      c,
      url: `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${encodeURIComponent(c.name)}.png`,
    }));

    // Unique customId helper
    const uid = interaction.id || `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cid = name => `${name}_${uid}`;

    const titleSuffixes = [];
    if (multiFilter === true) titleSuffixes.push('Multiples Only');
    if (multiFilter === false) titleSuffixes.push('Singles Only');
    if (lockedOnly) titleSuffixes.push('Locked Only');
    const titleSuffix = titleSuffixes.length ? ` (${titleSuffixes.join(' / ')})` : '';

    const footerSuffixes = [];
    if (multiFilter === true) footerSuffixes.push('2+ copies');
    if (multiFilter === false) footerSuffixes.push('single copies');
    if (lockedOnly) footerSuffixes.push(`locked only, locked total: ${lockedTotal}`);
    const footerSuffix = footerSuffixes.length ? ` (${footerSuffixes.join(', ')})` : '';

    // Build embeds & buttons
    const listEmbeds = pages.map((chunk, i) =>
      new EmbedBuilder()
        .setTitle(`${targetUser.username}'s Inventory${titleSuffix}`)
        .setDescription(
          chunk.map(c => {
            const url = `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${encodeURIComponent(c.name)}.png`;
            const lockEmoji = c.locked ? ' 🔒' : '';
            const cc = resolveCardColor(c.name, c.rarity);
            const emoji = cc ? getAttributeEmoji(cc) : '';
            const attrTag = cc ? ` ${emoji}` : '';
            return `**[${c.rarity}]** [${escapeMarkdown(c.name)}](${url})${attrTag} (x${c.count})${lockEmoji}`;
          }).join('\n')
        )
        .setColor(Colors.Blue)
        .setFooter({
          text: `Page ${i + 1}/${totalPages} • Cards: ${filteredCards}/${totalCards}${footerSuffix}`,
        })
    );

    const listRows = pages.map((_, i) => {
      const prev = new ButtonBuilder()
        .setCustomId(cid(`list_prev_${i}`))
        .setLabel('◀ Prev')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);

      const view = new ButtonBuilder()
        .setCustomId(cid(`list_view_${i}`))
        .setLabel('🃏 Image')
        .setStyle(ButtonStyle.Success);

      const next = new ButtonBuilder()
        .setCustomId(cid(`list_next_${i}`))
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);

      const skip = new ButtonBuilder()
        .setCustomId(cid(`skip_${i}`))
        .setLabel('📖 Jump')
        .setStyle(ButtonStyle.Secondary);

      return new ActionRowBuilder().addComponents(prev, view, next, skip);
    });

    const imageEmbeds = imageResults.map(({ c, url }, i) => {
      const cc = resolveCardColor(c.name, c.rarity);
      const emoji = cc ? getAttributeEmoji(cc) : '';
      const attrTag = cc ? ` ${emoji}` : '';

      return new EmbedBuilder()
        .setTitle(`**[${c.rarity}]** ${escapeMarkdown(c.name)}${attrTag} (x${c.count})${c.locked ? ' 🔒' : ''}`)
        .setImage(url)
        .setColor(RARITY_COLORS[c.rarity] ?? Colors.Default)
        .setFooter({ text: `Card ${i + 1} of ${imageResults.length}` });
    });

    const imageRows = imageResults.map((_, i) => {
      const prev = new ButtonBuilder()
        .setCustomId(cid(`img_prev_${i}`))
        .setLabel('◀ Prev')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);

      const back = new ButtonBuilder()
        .setCustomId(cid(`img_back_${i}`))
        .setLabel('⤵️ Back')
        .setStyle(ButtonStyle.Secondary);

      const next = new ButtonBuilder()
        .setCustomId(cid(`img_next_${i}`))
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);

      return new ActionRowBuilder().addComponents(prev, back, next);
    });

    // Send initial list page
    await interaction.editReply({ embeds: [listEmbeds[0]], components: [listRows[0]] });
    const message = await interaction.fetchReply();

    let listPage = 0;
    let imageIdx = 0;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: btn => btn.user.id === interaction.user.id && String(btn.customId).endsWith(`_${uid}`),
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
        const idx = btn.customId.lastIndexOf(`_${uid}`);
        const parts = idx === -1 ? btn.customId : btn.customId.slice(0, idx);

        if (parts.startsWith('list_prev_')) {
          listPage = (listPage - 1 + totalPages) % totalPages;
          await btn.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
          return;
        }

        if (parts.startsWith('list_next_')) {
          listPage = (listPage + 1) % totalPages;
          await btn.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
          return;
        }

        if (parts.startsWith('list_view_')) {
          imageIdx = listPage * ITEMS_PER_PAGE;
          imageIdx = Math.max(0, Math.min(imageIdx, imageEmbeds.length - 1));
          await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [imageRows[imageIdx]] });
          return;
        }

        if (parts.startsWith('skip_')) {
          const modalId = `skip_modal_${uid}`;
          const modal = new ModalBuilder().setCustomId(modalId).setTitle('Jump to Page');
          const input = new TextInputBuilder()
            .setCustomId('page_input')
            .setLabel(`Enter a page (1-${totalPages})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await btn.showModal(modal);

          try {
            const modalInt = await btn.awaitModalSubmit({
              filter: m => m.customId === modalId && m.user.id === interaction.user.id,
              time: 60000,
            });

            resetIdleTimer();

            let target = parseInt(modalInt.fields.getTextInputValue('page_input'), 10);
            if (Number.isNaN(target)) target = 1;
            target = Math.max(1, Math.min(target, totalPages));
            listPage = target - 1;

            await modalInt.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
          } catch (err) {
            try {
              await btn.reply({ content: 'Jump cancelled or timed out.', ephemeral: true });
            } catch {}
          }

          return;
        }

        if (parts.startsWith('img_prev_')) {
          imageIdx = (imageIdx - 1 + imageEmbeds.length) % imageEmbeds.length;
          await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [imageRows[imageIdx]] });
          return;
        }

        if (parts.startsWith('img_next_')) {
          imageIdx = (imageIdx + 1) % imageEmbeds.length;
          await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [imageRows[imageIdx]] });
          return;
        }

        if (parts.startsWith('img_back_')) {
          listPage = Math.floor(imageIdx / ITEMS_PER_PAGE);
          await btn.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
          return;
        }
      } catch (err) {
        console.error('inventory collector error:', err);
      }
    });

    collector.on('end', async () => {
      try {
        if (idleTimeout) {
          clearTimeout(idleTimeout);
          idleTimeout = null;
        }

        const disabled = message.components.map(r => {
          const row = ActionRowBuilder.from(r);
          row.components.forEach(b => b.setDisabled(true));
          return row;
        });

        await message.edit({ components: disabled });
      } catch (err) {
        console.error('inventory cleanup error:', err);
      }
    });
  },
};
