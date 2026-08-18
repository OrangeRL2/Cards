// Commands/Utility/recents.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Colors,
} = require('discord.js');
const User = require('../../models/User');
const { findCardIsland, getIslandFolder } = require('../../config/summer-cards');
const { resolveCardColor, getAttributeEmoji } = require('../../config/holomemColor');

const IMAGE_BASE = 'http://152.69.195.48/images';
const IDLE_LIMIT = 120_000;
const {
  RARITY_ORDER,
  RETENTION_DAYS,
  normalizeRarity,
  getJstDayStart,
  parseRaritySelector,
} = require('../../utils/recentAcquisitions');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LINES_PER_PAGE = 25;

const RARITY_ALIASES = new Map([
  ['3STAR', '★★★'],
  ['3STARS', '★★★'],
  ['3*', '★★★'],
  ['★★★', '★★★'],

  ['4STAR', '★★★★'],
  ['4STARS', '★★★★'],
  ['4*', '★★★★'],
  ['★★★★', '★★★★'],

  ['5STAR', '★★★★★'],
  ['5STARS', '★★★★★'],
  ['5*', '★★★★★'],
  ['★★★★★', '★★★★★'],
]);

function resolveRarityAlias(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const upper = raw.toUpperCase().replace(/\s+/g, '');
  return RARITY_ALIASES.get(upper) || normalizeRarity(raw);
}

function parseExcludeSelector(raw) {
  const text = String(raw || '').trim();
  if (!text) return { rarities: new Set(), label: 'None' };

  const selected = new Set();
  const tokens = text.split(',').map(x => x.trim()).filter(Boolean);

  if (!tokens.length) return { rarities: new Set(), label: 'None' };

  for (const rawToken of tokens) {
    const rarity = resolveRarityAlias(rawToken);

    if (!RARITY_ORDER.includes(rarity)) {
      return { error: `Unknown rarity \`${rawToken}\`.` };
    }

    selected.add(rarity);
  }

  return {
    rarities: selected,
    label: [...selected].join(', '),
  };
}

function getWindow(days) {
  const now = new Date();
  const today = getJstDayStart(now);
  const start = new Date(today.getTime() - (days - 1) * DAY_MS);
  return { start, end: now };
}

function flattenHistory(userDoc, start, end, allowedRarities) {
  const rows = [];

  for (const batch of userDoc?.recentAcquisitions || []) {
    const acquiredAt = batch?.acquiredAt ? new Date(batch.acquiredAt) : null;
    if (!acquiredAt || Number.isNaN(acquiredAt.getTime())) continue;
    if (acquiredAt < start || acquiredAt > end) continue;

    for (const card of batch.cards || []) {
      const rarity = normalizeRarity(card?.rarity);
      const name = String(card?.name || '').trim();
      const count = Math.max(1, Number(card?.count || 1));

      if (!name || !allowedRarities.has(rarity)) continue;

      // Match inventory/old recents behavior: hide TEST placeholder cards
      // such as "TEST", "TEST 999", "TEST 001", etc.
      if (/^TEST(?:\s|$)/i.test(name)) continue;

      rows.push({
        rarity,
        name,
        variant: card?.variant ?? null,
        count,
        acquiredAt,
      });
    }
  }

  return rows;
}

function sortRows(rows, sortMode) {
  if (sortMode === 'rarity') {
    rows.sort((a, b) => {
      const rarityDiff =
        RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity);

      if (rarityDiff !== 0) return rarityDiff;

      // Within the same rarity, newest acquisitions come first.
      return b.acquiredAt.getTime() - a.acquiredAt.getTime();
    });
    return;
  }

  // Default: newest acquisition first.
  rows.sort((a, b) => b.acquiredAt.getTime() - a.acquiredAt.getTime());
}

function rowText(row) {
  const ts = Math.floor(row.acquiredAt.getTime() / 1000);
  const count = row.count > 1 ? ` ×${row.count}` : '';
  const variant = row.variant ? ` (${row.variant})` : '';
  const imageUrl = buildCardImageUrl(row.name, row.rarity, row.variant);
  return `**[${row.rarity}]** [${escapeLinkText(row.name)}](${imageUrl})${variant}${count} — <t:${ts}:R>`;
}


const RARITY_COLORS = {
  XMAS: 0x05472A,
  SUN: 0xF4C542,
  '★★★': 0xF5C2E7,
  '★★★★': 0xE8B4F8,
  '★★★★★': 0xFFD166,
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

function buildCardImageUrl(name, rarity, variant = null) {
  const baseUrl = IMAGE_BASE.replace(/\/$/, '');
  const normalizedRarity = String(rarity || '').trim().toUpperCase();
  const encodedName = encodeURIComponent(String(name || '').trim());

  if (
    normalizedRarity === 'SUN' &&
    String(variant || '').trim().toLowerCase() === 'full art'
  ) {
    return `${baseUrl}/SUN/Full%20Art/${encodedName}.png`;
  }

  if (/^★{3,5}$/.test(normalizedRarity)) {
    return `${baseUrl}/HOLODORI/${encodeURIComponent(normalizedRarity)}/${encodedName}.png`;
  }

  if (normalizedRarity === 'SUN' && String(name || '').startsWith('Full Art: ')) {
    const legacyName = encodeURIComponent(String(name).slice('Full Art: '.length).trim());
    return `${baseUrl}/SUN/Full%20Art/${legacyName}.png`;
  }

  if (normalizedRarity === 'SUN') {
    const island = findCardIsland(name);
    const folder = getIslandFolder(island);
    if (folder) return `${baseUrl}/SUN/${folder}/${encodedName}.png`;
  }

  return `${baseUrl}/${normalizedRarity}/${encodedName}.png`;
}

function escapeMarkdown(str = '') {
  return String(str).replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
}

function escapeLinkText(text = '') {
  return String(text).replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recents')
    .setDescription('Show your recent notable card acquisitions.')
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription(`JST calendar days to include (1-${RETENTION_DAYS}).`)
        .setMinValue(1)
        .setMaxValue(RETENTION_DAYS)
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('rarity')
        .setDescription('Examples: OUR+, OUR,SEC,SUN,ORI, or 3star')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('exclude')
        .setDescription('Hide rarities, e.g. 3star or ★★★,SR,COL')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('sort')
        .setDescription('Choose how acquisitions are ordered.')
        .addChoices(
          { name: 'Newest first', value: 'newest' },
          { name: 'Highest rarity first', value: 'rarity' },
        )
        .setRequired(false)
    ),

  requireOshi: false,

  async execute(interaction) {
    await interaction.deferReply();

    const days = interaction.options.getInteger('days') || 1;
    const rarityRaw = interaction.options.getString('rarity');
    const excludeRaw = interaction.options.getString('exclude');
    const sortMode = interaction.options.getString('sort') || 'newest';

    // Apply aliases to positive rarity filters too, so 3star/4star/5star work
    // anywhere a rarity can be entered.
    const normalizedRarityRaw = rarityRaw
      ? rarityRaw
          .split(',')
          .map(token => {
            const trimmed = token.trim();
            const plus = trimmed.endsWith('+');
            const base = plus ? trimmed.slice(0, -1) : trimmed;
            const resolved = resolveRarityAlias(base);
            return `${resolved}${plus ? '+' : ''}`;
          })
          .join(',')
      : null;

    const parsed = parseRaritySelector(normalizedRarityRaw);
    const excluded = parseExcludeSelector(excludeRaw);

    if (parsed.error) {
      await interaction.editReply(parsed.error);
      return;
    }

    if (excluded.error) {
      await interaction.editReply(excluded.error);
      return;
    }

    for (const rarity of excluded.rarities) {
      parsed.rarities.delete(rarity);
    }

    const { start, end } = getWindow(days);
    const userDoc = await User.findOne(
      { id: String(interaction.user.id) },
      { recentAcquisitions: 1 }
    ).lean().exec();

    const rows = flattenHistory(userDoc, start, end, parsed.rarities);
    sortRows(rows, sortMode);

    if (!rows.length) {
      const filter = rarityRaw ? ` matching \`${rarityRaw}\`` : '';
      const excludeText = excludeRaw ? ` after excluding \`${excludeRaw}\`` : '';
      await interaction.editReply(
        `No notable acquisitions${filter}${excludeText} found in the last **${days} JST day${days === 1 ? '' : 's'}**.`
      );
      return;
    }

    const totalCards = rows.reduce((sum, row) => sum + row.count, 0);
    const totalPages = Math.max(1, Math.ceil(rows.length / MAX_LINES_PER_PAGE));
    const pages = Array.from(
      { length: totalPages },
      (_, i) => rows.slice(i * MAX_LINES_PER_PAGE, (i + 1) * MAX_LINES_PER_PAGE)
    );

    const uid = interaction.id || `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cid = name => `${name}_${uid}`;

    const listEmbeds = pages.map((chunk, pageIndex) =>
      new EmbedBuilder()
        .setTitle(`${interaction.user.username}'s Recent Acquisitions`)
        .setDescription(chunk.map(rowText).join('\n'))
        .setColor(0x00BB88)
        .addFields(
          {
            name: 'Window',
            value: `Last **${days} JST day${days === 1 ? '' : 's'}**`,
            inline: true,
          },
          {
            name: 'Filter',
            value: rarityRaw ? `\`${rarityRaw}\`` : 'Default notable rarities',
            inline: true,
          },
          {
            name: 'Excluded',
            value: excludeRaw ? `\`${excludeRaw}\`` : 'None',
            inline: true,
          },
          {
            name: 'Sort',
            value: sortMode === 'rarity' ? 'Highest rarity first' : 'Newest first',
            inline: true,
          },
          {
            name: 'Found',
            value: `${totalCards} card${totalCards === 1 ? '' : 's'}`,
            inline: true,
          },
        )
        .setFooter({ text: `Page ${pageIndex + 1}/${totalPages}` })
    );

    const imageEmbeds = rows.map((row, imageIndex) => {
      const cc = resolveCardColor(row.name, row.rarity);
      const emoji = cc ? getAttributeEmoji(cc) : '';
      const attrTag = emoji ? ` ${emoji}` : '';
      const variantTag = row.variant ? ` (${row.variant})` : '';
      const countTag = row.count > 1 ? ` ×${row.count}` : '';
      const ts = Math.floor(row.acquiredAt.getTime() / 1000);

      return new EmbedBuilder()
        .setTitle(`**[${row.rarity}]** ${escapeMarkdown(row.name)}${attrTag}${countTag}`)
        .setDescription(`Acquired <t:${ts}:R>${variantTag}`)
        .setImage(buildCardImageUrl(row.name, row.rarity, row.variant))
        .setURL(buildCardImageUrl(row.name, row.rarity, row.variant))
        .setColor(RARITY_COLORS[row.rarity] ?? Colors.Default)
        .setFooter({ text: `Card ${imageIndex + 1}/${rows.length}` });
    });

    function buildListRow() {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(cid('list_prev'))
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(cid('list_view'))
          .setLabel('🃏 Image')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(cid('list_next'))
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(cid('list_jump'))
          .setLabel('📖 Jump')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    function buildImageRow() {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(cid('img_prev'))
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(cid('img_back'))
          .setLabel('⤵️ Back')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(cid('img_next'))
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(cid('img_jump'))
          .setLabel('📖 Jump')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    await interaction.editReply({
      embeds: [listEmbeds[0]],
      components: [buildListRow()],
    });

    const message = await interaction.fetchReply();
    let listPage = 0;
    let imageIdx = 0;
    let mode = 'list';

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: btn =>
        btn.user.id === interaction.user.id &&
        String(btn.customId).endsWith(`_${uid}`),
    });

    let idleTimeout = null;

    function resetIdleTimer() {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => collector.stop('idle'), IDLE_LIMIT);
    }

    async function showJumpModal(btn, jumpMode) {
      const max = jumpMode === 'image' ? rows.length : totalPages;
      const noun = jumpMode === 'image' ? 'Card' : 'Page';
      const modalId = `recents_jump_${jumpMode}_${uid}`;

      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Jump to ${noun}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('jump_number')
              .setLabel(`Enter ${noun.toLowerCase()} (1-${max})`)
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(String(max).length)
              .setRequired(true)
          )
        );

      await btn.showModal(modal);

      const modalInt = await btn.awaitModalSubmit({
        filter: m => m.customId === modalId && m.user.id === interaction.user.id,
        time: 60_000,
      }).catch(() => null);

      if (!modalInt) return;

      resetIdleTimer();

      let target = Number(modalInt.fields.getTextInputValue('jump_number').trim());
      if (!Number.isInteger(target)) target = 1;
      target = Math.max(1, Math.min(target, max));

      if (jumpMode === 'image') {
        imageIdx = target - 1;
        mode = 'image';
        await modalInt.update({
          embeds: [imageEmbeds[imageIdx]],
          components: [buildImageRow()],
        });
      } else {
        listPage = target - 1;
        mode = 'list';
        await modalInt.update({
          embeds: [listEmbeds[listPage]],
          components: [buildListRow()],
        });
      }
    }

    resetIdleTimer();

    collector.on('collect', async btn => {
      resetIdleTimer();

      try {
        const suffix = `_${uid}`;
        const action = btn.customId.endsWith(suffix)
          ? btn.customId.slice(0, -suffix.length)
          : btn.customId;

        if (action === 'list_prev') {
          listPage = (listPage - 1 + totalPages) % totalPages;
          await btn.update({ embeds: [listEmbeds[listPage]], components: [buildListRow()] });
          return;
        }

        if (action === 'list_next') {
          listPage = (listPage + 1) % totalPages;
          await btn.update({ embeds: [listEmbeds[listPage]], components: [buildListRow()] });
          return;
        }

        if (action === 'list_view') {
          imageIdx = Math.min(listPage * MAX_LINES_PER_PAGE, rows.length - 1);
          mode = 'image';
          await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [buildImageRow()] });
          return;
        }

        if (action === 'list_jump') {
          await showJumpModal(btn, 'list');
          return;
        }

        if (action === 'img_prev') {
          imageIdx = (imageIdx - 1 + rows.length) % rows.length;
          await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [buildImageRow()] });
          return;
        }

        if (action === 'img_next') {
          imageIdx = (imageIdx + 1) % rows.length;
          await btn.update({ embeds: [imageEmbeds[imageIdx]], components: [buildImageRow()] });
          return;
        }

        if (action === 'img_back') {
          listPage = Math.floor(imageIdx / MAX_LINES_PER_PAGE);
          mode = 'list';
          await btn.update({ embeds: [listEmbeds[listPage]], components: [buildListRow()] });
          return;
        }

        if (action === 'img_jump') {
          await showJumpModal(btn, 'image');
          return;
        }
      } catch (err) {
        console.error('recents collector error:', err);
      }
    });

    collector.on('end', async () => {
      try {
        if (idleTimeout) clearTimeout(idleTimeout);

        const row = mode === 'image' ? buildImageRow() : buildListRow();
        row.components.forEach(button => button.setDisabled(true));
        await message.edit({ components: [row] });
      } catch (err) {
        console.error('recents cleanup error:', err);
      }
    });
  },
};
