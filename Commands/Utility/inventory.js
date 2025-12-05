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
          { name: 'C', value: 'C' },
          { name: 'OC', value: 'OC' },
          { name: 'U', value: 'U' },
          { name: 'R', value: 'R' },
          { name: 'S', value: 'S' },
          { name: 'P', value: 'P' },
          { name: 'SP', value: 'SP' },
          { name: 'UP', value: 'UP' },
          { name: 'RR', value: 'RR' },
          { name: 'SR', value: 'SR' },
          { name: 'OSR', value: 'OSR' },
          { name: 'SY', value: 'SY' },
          { name: 'UR', value: 'UR' },
          { name: 'OUR', value: 'OUR' },
          { name: 'SEC', value: 'SEC' },
          { name: 'HR', value: 'HR' },
          { name: 'bday', value: 'bday'},
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
    ),
  requireOshi: true,

  async execute(interaction) {
    // resolve target user (owner of inventory) and viewer (interaction.user)
    const explicitTarget = interaction.options.getUser('user');
    const targetUser = explicitTarget ? explicitTarget : interaction.user;

    // disallow viewing bot inventories
    if (targetUser.bot) {
      await interaction.reply({ content: 'You cannot view a bot inventory.', ephemeral: true });
      return;
    }

    const ephemeralReply = targetUser.id !== interaction.user.id;
    await interaction.deferReply();

    // single declarations for filters / sort
    const filterR = interaction.options.getString('rarity');
    const filterQ = interaction.options.getString('search')?.toLowerCase();
    const sortBy = interaction.options.getString('sort') || 'rarity';

    const userDoc = await User.findOne({ id: targetUser.id });
    if (!userDoc || !userDoc.cards || (userDoc.cards instanceof Map ? userDoc.cards.size === 0 : Object.keys(userDoc.cards || {}).length === 0)) {
      return interaction.editReply({ content: `${targetUser.id === interaction.user.id ? 'No cards yet. Use `/pull`!' : `${targetUser.username} has no cards yet.`}`, ephemeral: ephemeralReply });
    }

    // Normalize top-level entries (Map or plain object)
    const topEntries = userDoc.cards instanceof Map
      ? Array.from(userDoc.cards.entries())
      : Object.entries(userDoc.cards || {});

    // Flatten to one entry per (name, rarity), tolerate multiple shapes
    const allEntries = [];
    for (const [topKey, groupRaw] of topEntries) {
      const nameKey = topKey;
      const group = groupRaw || {};

      // Case A: grouped shape with byRarity
      if (group.byRarity) {
        const inner = group.byRarity instanceof Map
          ? Array.from(group.byRarity.entries())
          : Object.entries(group.byRarity || {});

        for (const [rarityKey, infoRaw] of inner) {
          const info = infoRaw || {};
          const entryName = group.name || nameKey;
          const rarity = (info.rarity || rarityKey || '').toString();
          const count = Number(info.count || 0);
          const timestamps = Array.isArray(info.timestamps) ? info.timestamps.map(t => new Date(t).getTime()) : [];
          allEntries.push({ name: entryName, rarity, count, timestamps, locked: info.locked || false });
        }
        continue;
      }

      // Case B: flat cardInfo stored directly
      if (group.count !== undefined && group.rarity) {
        const entryName = group.name || nameKey;
        const rarity = (group.rarity || '').toString();
        const count = Number(group.count || 0);
        const timestamps = Array.isArray(group.timestamps) ? group.timestamps.map(t => new Date(t).getTime()) : [];
        allEntries.push({ name: entryName, rarity, count, timestamps, locked: group.locked || false });
        continue;
      }

      // Case C: composite key "Name::R"
      if (typeof nameKey === 'string' && nameKey.includes('::')) {
        const [nm, rar] = nameKey.split('::');
        const info = group || {};
        const rarity = (info.rarity || rar || '').toString();
        const count = Number(info.count || 0);
        const timestamps = Array.isArray(info.timestamps) ? info.timestamps.map(t => new Date(t).getTime()) : [];
        allEntries.push({ name: nm, rarity, count, timestamps, locked: info.locked || false });
        continue;
      }

      // Fallback: try inner entries
      const possibleInner = Object.entries(group || {}).slice(0, 50);
      for (const [k, v] of possibleInner) {
        if (v && (v.count !== undefined || v.rarity)) {
          const entryName = group.name || nameKey;
          const rarity = (v.rarity || k || '').toString();
          const count = Number(v.count || 0);
          const timestamps = Array.isArray(v.timestamps) ? v.timestamps.map(t => new Date(t).getTime()) : [];
          allEntries.push({ name: entryName, rarity, count, timestamps, locked: v.locked || false });
        }
      }
    }

    // Apply filters
    let entries = allEntries.filter(c =>
      (!filterR || c.rarity === filterR) &&
      (!filterQ || c.name.toLowerCase().includes(filterQ))
    );

    if (!entries.length) {
      return interaction.editReply({ content: 'No cards match filters.', ephemeral: ephemeralReply });
    }

    // Totals
    const totalCards = allEntries.reduce((sum, e) => sum + (Number(e.count) || 0), 0);
    const totalPulls = allEntries.reduce((sum, e) => sum + (Array.isArray(e.timestamps) ? e.timestamps.length : 0), 0);
    const filteredCards = entries.reduce((sum, e) => sum + (Number(e.count) || 0), 0);
    const filteredPulls = entries.reduce((sum, e) => sum + (Array.isArray(e.timestamps) ? e.timestamps.length : 0), 0);

    // safe timestamp helpers (avoid spreading large arrays or empty spreads)
    function maxTimestamp(arr = []) {
      if (!arr || arr.length === 0) return 0;
      return arr.reduce((m, t) => Math.max(m, Number(t) || 0), 0);
    }
    function minTimestamp(arr = []) {
      if (!arr || arr.length === 0) return 0;
      return arr.reduce((m, t) => Math.min(m, Number(t) || 0), Number(arr[0]) || 0);
    }

    // Sorting
    if (sortBy === 'newest') {
      entries.sort((a, b) => maxTimestamp(b.timestamps) - maxTimestamp(a.timestamps));
    } else if (sortBy === 'oldest') {
      entries.sort((a, b) => minTimestamp(a.timestamps) - minTimestamp(b.timestamps));
    } else if (sortBy === 'amount') {
      entries.sort((a, b) => {
        const ca = Number(a.count || 0);
        const cb = Number(b.count || 0);
        if (cb !== ca) return cb - ca;
        return a.name.localeCompare(b.name);
      });
    } else {
      const order = {
  C: 1,
  U: 2,
  R: 3,
  OC: 4,
  S: 5,
  P: 6,
  SP: 7,
  RR: 8,
  SR: 9,
  OSR: 10,
  SY: 11,
  HR: 12,
  bday: 13,
  UR: 14,
  OUR: 15,
  SEC: 16,
  UP: 17
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

    // Prepare image data (encoded name)
    const imageResults = entries.map(c => {
      const encodedName = encodeURIComponent(String(c.name));
      const url = `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${encodedName}.png`;
      return { c, url };
    });

    // Helper to build unique customIds per interaction
    const uid = interaction.id || `${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const cid = (name) => `${name}_${uid}`;

    // Build embeds and components (prebuilt)
    const listEmbeds = pages.map((chunk, i) =>
      new EmbedBuilder()
        .setTitle(`${targetUser.username}'s Inventory`)
        .setDescription(
          chunk
            .map(c => {
              const encodedName = encodeURIComponent(String(c.name));
              const url = `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${encodedName}.png`;
              const lockEmoji = c.locked ? ' 🔒' : '';
              return `**[${c.rarity}]** [${escapeMarkdown(c.name)}](${url}) (x${c.count}) ${lockEmoji}`;
            })
            .join('\n')
        )
        .setColor(Colors.Blue)
        .setFooter({ text: `Page ${i + 1}/${totalPages} • Cards: ${filteredCards}` })
    );

    const listRows = pages.map((_, i) => {
      const prev = new ButtonBuilder().setCustomId(cid(`list_prev_${i}`)).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(i === 0);
      const view = new ButtonBuilder().setCustomId(cid(`list_view_${i}`)).setLabel('🃏 Image').setStyle(ButtonStyle.Success);
      const next = new ButtonBuilder().setCustomId(cid(`list_next_${i}`)).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(i === totalPages - 1);
      const skip = new ButtonBuilder().setCustomId(cid(`skip_${i}`)).setLabel('📖 Jump').setStyle(ButtonStyle.Secondary);
      return new ActionRowBuilder().addComponents(prev, view, next, skip);
    });

    const imageEmbeds = imageResults.map(({ c, url }, i) =>
    new EmbedBuilder()
        .setTitle(`**[${c.rarity}]** ${escapeMarkdown(c.name)} (x${c.count})${c.locked ? ' 🔒' : ''} `)
        .setImage(url)
        .setColor({
          UR: Colors.DarkPurple,
          R: Colors.Green,
          C: Colors.Grey,
          SuperRare: Colors.Blue,
        }[c.rarity] ?? Colors.Default)
        .setFooter({ text: `Card ${i + 1} of ${imageResults.length}` })
    );

    const imageRows = imageResults.map((_, i) => {
      const prev = new ButtonBuilder().setCustomId(cid(`img_prev_${i}`)).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(i === 0);
      const back = new ButtonBuilder().setCustomId(cid(`img_back_${i}`)).setLabel('⤵️ Back').setStyle(ButtonStyle.Secondary);
      const next = new ButtonBuilder().setCustomId(cid(`img_next_${i}`)).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(i === imageResults.length - 1);
      return new ActionRowBuilder().addComponents(prev, back, next);
    });

    // Send initial list page
    await interaction.editReply({ embeds: [listEmbeds[0]], components: [listRows[0]] });
    const message = await interaction.fetchReply();

    let listPage = 0;
    let imageIdx = 0;

    // create the collector and filter by the uid embedded in customId
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
        const parts = idx === -1 ? btn.customId : btn.customId.slice(0, idx); // e.g., list_prev_0 or img_next_3
        // normalize action and index
        if (parts.startsWith('list_prev_')) {
          listPage = Math.max(0, listPage - 1);
          await btn.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
          return;
        }
        if (parts.startsWith('list_next_')) {
          listPage = Math.min(totalPages - 1, listPage + 1);
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
          imageIdx = Math.max(0, imageIdx - 1);
          await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [imageRows[imageIdx]] });
          return;
        }
        if (parts.startsWith('img_next_')) {
          imageIdx = Math.min(imageEmbeds.length - 1, imageIdx + 1);
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

        // disable the message buttons by mapping current components into disabled clones
        const disabled = message.components.map(r => {
          const row = ActionRowBuilder.from(r);
          row.components.forEach(b => b.setDisabled(true));
          return row;
        });
        await message.edit({ components: disabled });

        // removed timed-out follow-up message per request
      } catch (err) {
        console.error('inventory cleanup error:', err);
      }
    });
  },
};
