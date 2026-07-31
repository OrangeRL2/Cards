
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
const fs = require('node:fs');
const path = require('node:path');
const User = require('../../models/User');
const { resolveCardColor, getAttributeEmoji } = require('../../config/holomemColor');
const pools = require('../../utils/loadImages');
const { rarityChoices } = require('../../utils/rarities');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const PAGE_SIZE = 10;
const IDLE_LIMIT = 120_000; // 2 minutes

const RARITY_ORDER = [
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'COL', 'OSR',
  'P', 'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC', 'ORI', 'EV',
];
const RARITY2_ORDER = ['XMAS', 'VAL', 'EAS', 'SUN', '★★★', '★★★★', '★★★★★'];
const ALL_RARITY_ORDER = [...RARITY2_ORDER, ...RARITY_ORDER];

const COLOR_MAP = {
  SUN: 0xF4C542,
  '★★★': 0xF5C2E7,
  '★★★★': 0xE8B4F8,
  '★★★★★': 0xFFD166,
  XMAS:   0x05472A, // XMAS Green
  C:    Colors.Grey, 
  U:    Colors.White,
  R:    0x7bacec, // R Light Blue
  S:    0x55DDEE, // S Cyan
  RR:   0x2A69FB, // RR Blue
  OC:   Colors.Fuchsia, 
  SR:   0xEE7744, // SR Orange
  COL:  0xFF3377, // COL Pink
  OSR:  0xB19CD9, // OSR Purple
  P:    0xDDFFEE, // P Pastel Green
  SP:   0x33DDAA, // SP Aqua
  SY:   Colors.DarkAqua, 
  UR:   0xFF9922, // UR Orange
  OUR:  Colors.DarkPurple,
  HR:    Colors.Gold,
  BDAY:  0xF9CDCF, //Bday Pink
  UP:    0xFFEE22, // UP Yellow
  SEC:  0x6CCDF8, // SEC Light Blue
  VAL:  Colors.Red,
  ORI:  Colors.Orange,
  EAS:  0xFF2301,
};


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

function buildMissingCardImageUrl(card) {
  const baseUrl = IMAGE_BASE.replace(/\/$/, '');
  const rarity = String(card?.rarity || '').trim().toUpperCase();
  const encodedName = encodeURIComponent(String(card?.name || '').trim());
  if (rarity === 'SUN' && card.folder) {
    return `${baseUrl}/SUN/${encodeURIComponent(card.folder)}/${encodedName}.png`;
  }
  if (/^★{3,5}$/.test(rarity)) {
    return `${baseUrl}/HOLODORI/${encodeURIComponent(rarity)}/${encodedName}.png`;
  }
  if (rarity === 'COL' || rarity === 'ORI') {
    return `${baseUrl}/${encodeURIComponent(rarity)}/secret.png`;
  }
  return `${baseUrl}/${encodeURIComponent(rarity)}/${encodedName}.png`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('miss')
    .setDescription('Show which cards you do not have yet')
    .addStringOption(opt =>
      opt.setName('rarity')
        .setDescription('Filter by standard rarity')
        .addChoices(
          { name: 'All', value: 'ALL' },
          ...rarityChoices(),
        )
    )
    .addStringOption(opt =>
      opt.setName('rarity2')
        .setDescription('Filter by event or special rarity')
        .addChoices(...rarityChoices({ group: 'special' }))
    )
    .addStringOption(opt =>
      opt.setName('search')
        .setDescription('Search missing card names'),
    )
  .addStringOption(opt =>
    opt.setName('sort')
      .setDescription('Sort order')
      .addChoices(
        { name: 'Rarity (default)', value: 'rarity' },
        { name: 'Color (attribute)', value: 'color' },
      ),
  )
  .addStringOption(opt =>
    opt.setName('color')
      .setDescription('Filter by attribute')
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
  ),
requireOshi: true,

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const filterR1 = interaction.options.getString('rarity');
      const filterR2 = interaction.options.getString('rarity2');
      if (filterR1 && filterR2) {
        return interaction.editReply({ content: 'Choose either `rarity` or `rarity2`, not both.', ephemeral: true });
      }
      const filterR = filterR2 || filterR1 || 'ALL';
      const filterRNorm = String(filterR).trim().toUpperCase();
      const filterQ = interaction.options.getString('search')?.toLowerCase();
  const filterColor = interaction.options.getString('color');
  const sortBy = interaction.options.getString('sort') || 'rarity';

      // load user doc and owned map
      const userDoc = await User.findOne({ id: interaction.user.id });
      const owned = Array.isArray(userDoc?.cards) ? userDoc.cards : [];

      // Build the complete card universe. SUN and HOLODORI use nested folders.
      const universe = [];
      const assetsBase = path.join(__dirname, '..', '..', 'assets', 'images');

      for (const rarity of ALL_RARITY_ORDER) {
        if (rarity === 'SUN') {
          // SUN's source of truth is the image folders on disk.
          // Scan only island folders and intentionally exclude "Full Art".
          const sunBase = path.join(assetsBase, 'SUN');
          const islandFolders = ['Blue', 'Green', 'Red', 'Yellow'];

          for (const folder of islandFolders) {
            const folderPath = path.join(sunBase, folder);
            if (!fs.existsSync(folderPath)) continue;

            const files = fs.readdirSync(folderPath, { withFileTypes: true })
              .filter(entry => entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name))
              .map(entry => entry.name);

            for (const file of files) {
              universe.push({
                rarity: 'SUN',
                name: path.basename(file, path.extname(file)),
                folder,
                file: path.join(folderPath, file),
              });
            }
          }

          continue;
        }

        if (/^★{3,5}$/.test(rarity)) {
          const starFolder = path.join(assetsBase, 'HOLODORI', rarity);
          if (fs.existsSync(starFolder)) {
            const starFiles = fs.readdirSync(starFolder)
              .filter(file => /\.(png|jpe?g|webp|gif)$/i.test(file));
            for (const file of starFiles) {
              universe.push({ rarity, name: path.basename(file, path.extname(file)), file });
            }
          }
          continue;
        }

        const rarityFiles = Array.isArray(pools[rarity]) ? pools[rarity] : [];
        for (const file of rarityFiles) {
          universe.push({ rarity, name: path.basename(file, path.extname(file)), file });
        }
      }

      // filter and select missing: consider owned only when exact rarity matches
      let missing = universe.filter(card => {
        if (filterRNorm !== 'ALL' && String(card.rarity).trim().toUpperCase() !== filterRNorm) return false;
        if (filterQ && !card.name.toLowerCase().includes(filterQ)) return false;
    if (filterColor) {
      const wanted = String(filterColor).trim().toLowerCase();
      const cc = resolveCardColor(card.name, card.rarity);
      if (wanted === 'none') {
        if (cc !== null && cc !== 'none') return false;
      } else {
        if (cc !== wanted) return false;
      }
    }

        const info = owned.find(c => c.name === card.name && c.rarity === card.rarity);

      // Missing if no record OR record exists but count is 0 or less
      if (!info) return true;
            
      const cnt = Number(info.count ?? info.qty ?? 0);
      if (!Number.isFinite(cnt) || cnt <= 0) return true;
            
      return false;

      });

      if (missing.length === 0) {
        return interaction.editReply({ content: 'You have all matching cards (no misses).', ephemeral: true });
      }

      // order by rarity (RARITY_ORDER) then name
      const orderIndex = r => {
        const idx = ALL_RARITY_ORDER.indexOf(r);
        return idx === -1 ? 999 : idx;
      };
      if (sortBy === 'color') {
    missing.sort((a, b) => {
      const ca = colorRankOf(a.name, a.rarity);
      const cb = colorRankOf(b.name, b.rarity);
      if (ca !== cb) return ca - cb;
      const d = orderIndex(a.rarity) - orderIndex(b.rarity);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
  } else {
    missing.sort((a, b) => {
        const d = orderIndex(a.rarity) - orderIndex(b.rarity);
        return d || a.name.localeCompare(b.name);
      });
  }

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
      const imageResults = missing.map(c => ({ c, url: buildMissingCardImageUrl(c) }));

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
                const url = buildMissingCardImageUrl(c);
                const cc = resolveCardColor(c.name, c.rarity);
                const emoji = cc ? getAttributeEmoji(cc) : '';
                const attrTag = emoji ? ` ${emoji}` : '';
                return `**[${c.rarity}]** [${escapeMarkdown(c.name)}](${url})${attrTag}`;
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
      const imageEmbeds = imageResults.map(({ c, url }, i) => {
      const cc = resolveCardColor(c.name, c.rarity);
      const emoji = cc ? getAttributeEmoji(cc) : '';
      const attrTag = emoji ? ` ${emoji}` : '';

      return new EmbedBuilder()
      .setTitle(`**[${c.rarity}]** ${escapeMarkdown(c.name)}${attrTag}`)
      .setImage(url)
      .setColor(COLOR_MAP[c.rarity] ?? Colors.Default)
      .setFooter({ text: `Card ${i + 1} of ${imageResults.length}` });
});

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
