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
const path = require('path');
const User = require('../../models/User');

const IMAGE_BASE = 'http://152.69.195.48/images';
const ITEMS_PER_PAGE = 10;
const IDLE_LIMIT = 120_000; // 2 minutes

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Show your card inventory')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('View another user\'s inventory (optional)')
    )
    .addStringOption(opt =>
      opt.setName('rarity')
        .setDescription('Filter by rarity')
        .addChoices(
          { name: 'XMAS', value: 'XMAS' },
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
          { name: 'BDAY', value: 'BDAY'},
          { name: 'SEC', value: 'SEC' },
          { name: 'VAL', value: 'VAL' },
        ),
    )
    .addStringOption(opt =>
      opt.setName('search')
        .setDescription('Search by card name'),
    )
    .addStringOption(opt =>
      opt.setName('sort')
        .setDescription('Sort order')
        .addChoices(
          { name: 'Rarity (default)', value: 'rarity' },
          { name: 'Newest first', value: 'newest' },
          { name: 'Oldest first', value: 'oldest' },
          { name: 'Amount (count)', value: 'amount' },
        ),
    )
    .addBooleanOption(opt =>
      opt.setName('multi')
      .setDescription('Show only cards you have 2 or more of')
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
    const sortBy = interaction.options.getString('sort') || 'rarity';
    const multiFilter = interaction.options.getBoolean('multi') || false;

    const userDoc = await User.findOne({ id: targetUser.id });
    if (!userDoc || !userDoc.cards || userDoc.cards.length === 0) {
      return interaction.editReply({ content: `${targetUser.id === interaction.user.id ? 'No cards yet. Use `/pull`!' : `${targetUser.username} has no cards yet.`}`, ephemeral: ephemeralReply });
    }

    // Flatten cards array into entries
    const allEntries = userDoc.cards.map(c => ({
      name: c.name,
      rarity: c.rarity,
      count: Number(c.count || 0),
      locked: c.locked || false,
      firstAcquiredAt: c.firstAcquiredAt ? new Date(c.firstAcquiredAt).getTime() : 0,
      lastAcquiredAt: c.lastAcquiredAt ? new Date(c.lastAcquiredAt).getTime() : 0,
    }));

    // Apply filters
    let entries = allEntries.filter(c =>
      (!filterR || c.rarity === filterR) &&
      (!filterQ || c.name.toLowerCase().includes(filterQ)) &&
      (!multiFilter || c.count >= 2)
    );

    if (!entries.length) {
      const filterMessage = multiFilter ?
        'No cards match filters (or no cards with 2 or more copies).' :
        'No cards match filters.';
      return interaction.editReply({ content: filterMessage, ephemeral: ephemeralReply });
    }

    // Totals
    const totalCards = allEntries.reduce((sum, e) => sum + e.count, 0);
    const totalPulls = allEntries.reduce((sum, e) => sum + e.count, 0); // or keep previous calculation if needed
    const filteredCards = entries.reduce((sum, e) => sum + e.count, 0);

    // Sorting
    if (sortBy === 'newest') {
      entries.sort((a, b) => (b.lastAcquiredAt || 0) - (a.lastAcquiredAt || 0));
    } else if (sortBy === 'oldest') {
      entries.sort((a, b) => (a.firstAcquiredAt || 0) - (b.firstAcquiredAt || 0));
    } else if (sortBy === 'amount') {
      entries.sort((a, b) => {
        const ca = a.count, cb = b.count;
        if (cb !== ca) return cb - ca;
        return a.name.localeCompare(b.name);
      });
    } else {
      const order = {
        XMAS: 1, C: 2, U: 3, R: 4, S: 5, RR: 6, OC: 7, SR: 8, OSR: 9,
        P: 10, SP: 11, UP: 12, SY: 13, UR: 14, OUR: 15, HR: 16, BDAY: 17, SEC: 18, VAL: 19
      };
      entries.sort((a, b) => {
        const d = (order[b.rarity] || 999) - (order[a.rarity] || 999);
        if (d !== 0) return d;
        return a.name.localeCompare(b.name);
      });
    }

    function escapeMarkdown(str = '') {
      return String(str).replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
    }

    // Paginate
    const totalPages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
    const pages = Array.from({ length: totalPages }, (_, i) => entries.slice(i * ITEMS_PER_PAGE, (i + 1) * ITEMS_PER_PAGE));

    // Prepare image data
    const imageResults = entries.map(c => ({
      c,
      url: `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${encodeURIComponent(c.name)}.png`
    }));

    // Unique customId helper
    const uid = interaction.id || `${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const cid = name => `${name}_${uid}`;

    // Build embeds & buttons
    const listEmbeds = pages.map((chunk, i) =>
      new EmbedBuilder()
        .setTitle(`${targetUser.username}'s Inventory${multiFilter ? ' (Multiples Only)' : ''}`)
        .setDescription(
          chunk.map(c => {
            const url = `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${encodeURIComponent(c.name)}.png`;
            const lockEmoji = c.locked ? ' 🔒' : '';
            return `**[${c.rarity}]** [${escapeMarkdown(c.name)}](${url}) (x${c.count}) ${lockEmoji}`;
          }).join('\n')
        )
        .setColor(Colors.Blue)
        .setFooter({ text: `Page ${i + 1}/${totalPages} • Cards: ${filteredCards}${multiFilter ? ' (2+ copies)' : ''}` })
    );

    const listRows = pages.map((_, i) => {
      const prev = new ButtonBuilder().setCustomId(cid(`list_prev_${i}`)).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(false);
      const view = new ButtonBuilder().setCustomId(cid(`list_view_${i}`)).setLabel('🃏 Image').setStyle(ButtonStyle.Success);
      const next = new ButtonBuilder().setCustomId(cid(`list_next_${i}`)).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(false);
      const skip = new ButtonBuilder().setCustomId(cid(`skip_${i}`)).setLabel('📖 Jump').setStyle(ButtonStyle.Secondary);
      return new ActionRowBuilder().addComponents(prev, view, next, skip);
    });

    const imageEmbeds = imageResults.map(({ c, url }, i) =>
      new EmbedBuilder()
        .setTitle(`**[${c.rarity}]** ${escapeMarkdown(c.name)} (x${c.count})${c.locked ? ' 🔒' : ''}`)
        .setImage(url)
        .setColor({
          UR: Colors.DarkPurple, R: Colors.Green, C: Colors.Grey, SuperRare: Colors.Blue
        }[c.rarity] ?? Colors.Default)
        .setFooter({ text: `Card ${i + 1} of ${imageResults.length}` })
    );

    const imageRows = imageResults.map((_, i) => {
      const prev = new ButtonBuilder().setCustomId(cid(`img_prev_${i}`)).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(false);
      const back = new ButtonBuilder().setCustomId(cid(`img_back_${i}`)).setLabel('⤵️ Back').setStyle(ButtonStyle.Secondary);
      const next = new ButtonBuilder().setCustomId(cid(`img_next_${i}`)).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(false);
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
          const input = new TextInputBuilder().setCustomId('page_input').setLabel(`Enter a page (1–${totalPages})`).setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await btn.showModal(modal);

          try {
            const modalInt = await btn.awaitModalSubmit({ filter: m => m.customId === modalId && m.user.id === interaction.user.id, time: 60000 });
            resetIdleTimer();
            let target = parseInt(modalInt.fields.getTextInputValue('page_input'), 10);
            if (isNaN(target)) target = 1;
            target = Math.max(1, Math.min(target, totalPages));
            listPage = target - 1;
            await modalInt.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
          } catch (err) {
            try { await btn.reply({ content: 'Jump cancelled or timed out.', ephemeral: true }); } catch {}
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

    collector.on('end', async (_collected, reason) => {
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
