// commands/Utility/miss.js
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
const path = require('node:path');
const User = require('../../models/User');
const pools = require('../../utils/loadImages');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const PAGE_SIZE = 10;
const IDLE_LIMIT = 120_000; // 2 minutes

const RARITY_ORDER = [
  'XMAS', 'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'COL', 'OSR', 'P', 'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC','VAL'
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
        if (!info) return true;
        if (info.rarity !== card.rarity) return true;
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

      // helper escape
      function escapeMarkdown(str = '') {
        return String(str).replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
      }

      // prepare imageResults (flat list of missing cards for image view)
      const imageResults = missing.map(c => {
        // If rarity is COL, show secret.png instead of the card image
        const imageFile = c.rarity === 'COL' ? 'secret.png' : `${encodeURIComponent(String(c.name))}.png`;
        const url = `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${imageFile}`;
        return { c, url };
      });

      // uid and cid helpers to avoid collisions
      const uid = interaction.id || `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const cid = (name) => `${name}_${uid}`;

      // Build list embeds and rows (same UX as inventory)
      const listEmbeds = pages.map((chunk, i) =>
        new EmbedBuilder()
          .setTitle(`Missing cards (${missing.length} total)`)
          .setDescription(
            chunk
              .map(c => {
                // If rarity is COL, link to secret.png instead of the card image
                const imageFile = c.rarity === 'COL' ? 'secret.png' : `${encodeURIComponent(String(c.name))}.png`;
                const url = `${IMAGE_BASE}/${encodeURIComponent(c.rarity)}/${imageFile}`;
                return `**[${c.rarity}]** [${escapeMarkdown(c.name)}](${url})`;
              })
              .join('\n')
          )
          .setColor(COLOR_MAP[chunk[0]?.rarity] ?? Colors.Default)
          .setFooter({ text: `Page ${i + 1}/${pages.length}` })
      );

      const listRows = pages.map((_, i) => {
        const prev = new ButtonBuilder().setCustomId(cid(`list_prev_${i}`)).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(false);
        const view = new ButtonBuilder().setCustomId(cid(`list_view_${i}`)).setLabel('🃏 Image').setStyle(ButtonStyle.Success);
        const next = new ButtonBuilder().setCustomId(cid(`list_next_${i}`)).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(false);
        const skip = new ButtonBuilder().setCustomId(cid(`skip_${i}`)).setLabel('📖 Jump').setStyle(ButtonStyle.Secondary);
        return new ActionRowBuilder().addComponents(prev, view, next, skip);
      });

      // image embeds and rows
      const imageEmbeds = imageResults.map(({ c, url }, i) =>
        new EmbedBuilder()
          .setTitle(`**[${c.rarity}]** ${escapeMarkdown(c.name)}`)
          .setImage(url)
          .setColor(COLOR_MAP[c.rarity] ?? Colors.Default)
          .setFooter({ text: `Card ${i + 1} of ${imageResults.length}` })
      );

      const imageRows = imageResults.map((_, i) => {
        const prev = new ButtonBuilder().setCustomId(cid(`img_prev_${i}`)).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(false);
        const back = new ButtonBuilder().setCustomId(cid(`img_back_${i}`)).setLabel('⤵️ Back').setStyle(ButtonStyle.Secondary);
        const next = new ButtonBuilder().setCustomId(cid(`img_next_${i}`)).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(false);
        return new ActionRowBuilder().addComponents(prev, back, next);
      });

      // send initial list page
      await interaction.editReply({ embeds: [listEmbeds[0]], components: [listRows[0]] });
      const message = await interaction.fetchReply();

      // state
      let listPage = 0;
      let imageIdx = 0;

      // collector with filter for user and uid suffix
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: btn => btn.user.id === interaction.user.id && String(btn.customId).endsWith(`_${uid}`),
      });

      // manual idle timer (works across discord.js versions)
      let idleTimeout = null;
      function resetIdleTimer() {
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => collector.stop('idle'), IDLE_LIMIT);
      }
      resetIdleTimer();

      collector.on('collect', async btn => {
        resetIdleTimer();
        try {
          // normalize customId (strip uid suffix)
          const idx = btn.customId.lastIndexOf(`_${uid}`);
          const parts = idx === -1 ? btn.customId : btn.customId.slice(0, idx);

          // list navigation
          if (parts.startsWith('list_prev_')) {
            listPage = (listPage - 1 + pages.length) % pages.length;
            await btn.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
            return;
          }
          if (parts.startsWith('list_next_')) {
            listPage = (listPage + 1) % pages.length;
            await btn.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
            return;
          }
          if (parts.startsWith('list_view_')) {
            // open image view at first card of current page
            imageIdx = listPage * PAGE_SIZE;
            imageIdx = Math.max(0, Math.min(imageIdx, imageEmbeds.length - 1));
            await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [imageRows[imageIdx]] });
            return;
          }

          // jump modal
          if (parts.startsWith('skip_')) {
            const modalId = `skip_modal_${uid}`;
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('Jump to Page');
            const input = new TextInputBuilder()
              .setCustomId('page_input')
              .setLabel(`Enter a page (1–${pages.length})`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await btn.showModal(modal);

            try {
              const modalInt = await btn.awaitModalSubmit({ filter: m => m.customId === modalId && m.user.id === interaction.user.id, time: 60_000 });
              resetIdleTimer();
              let target = parseInt(modalInt.fields.getTextInputValue('page_input'), 10);
              if (isNaN(target)) target = 1;
              target = Math.max(1, Math.min(target, pages.length));
              listPage = target - 1;
              await modalInt.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
            } catch (err) {
              try { await btn.reply({ content: 'Jump cancelled or timed out.', ephemeral: true }); } catch {}
            }
            return;
          }

          // image navigation
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
            listPage = Math.floor(imageIdx / PAGE_SIZE);
            await btn.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
            return;
          }
        } catch (err) {
          console.error('miss collector error', err);
          try {
            if (!btn.replied && !btn.deferred) {
              await btn.reply({ content: 'Internal error.', ephemeral: true });
            }
          } catch (e) { /* ignore */ }
        }
      });

      collector.on('end', async () => {
        try {
          if (idleTimeout) {
            clearTimeout(idleTimeout);
            idleTimeout = null;
          }
          // disable all buttons
          const disabled = message.components.map(r => {
            const row = ActionRowBuilder.from(r);
            row.components.forEach(b => b.setDisabled(true));
            return row;
          });
          await message.edit({ components: disabled });
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
