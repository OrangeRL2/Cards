// commands/Utility/inventory.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
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
const fs = require('fs');
const User = require('../../models/User');

const CARDS_ROOT     = path.join(__dirname, '../../assets/images');
const ITEMS_PER_PAGE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Show your card inventory')
    .addStringOption(opt =>
      opt.setName('rarity')
         .setDescription('Filter by rarity')
         .addChoices(
           { name: 'UltraRare', value: 'UR' },
           { name: 'Rare',      value: 'R'  },
           { name: 'Common',    value: 'C'  }
         )
    )
    .addStringOption(opt =>
      opt.setName('search')
         .setDescription('Search by card name')
    )
    .addStringOption(opt =>
      opt.setName('sort')
         .setDescription('Sort order')
         .addChoices(
           { name: 'Rarity (default)', value: 'rarity' },
           { name: 'Newest first',     value: 'newest' },
           { name: 'Oldest first',     value: 'oldest' }
         )
    ),

  async execute(interaction) {
    const filterR = interaction.options.getString('rarity');
    const filterQ = interaction.options.getString('search')?.toLowerCase();
    const sortBy  = interaction.options.getString('sort') || 'rarity';

    const userDoc = await User.findOne({ id: interaction.user.id });
    if (!userDoc || userDoc.cards.size === 0) {
      return interaction.reply({ content: "No cards yet. Use `/pull`!", ephemeral: true });
    }

    // Transform map → array
    let entries = Array.from(userDoc.cards.entries())
      .map(([name, info]) => ({
        name,
        count:      info.count,
        rarity:     info.rarity,
        timestamps: info.timestamps
      }))
      .filter(c =>
        (!filterR || c.rarity === filterR) &&
        (!filterQ || c.name.toLowerCase().includes(filterQ))
      );

    // Apply sorting
    if (sortBy === 'newest') {
      entries.sort(
        (a, b) => Math.max(...b.timestamps) - Math.max(...a.timestamps)
      );
    } else if (sortBy === 'oldest') {
      entries.sort(
        (a, b) => Math.min(...a.timestamps) - Math.min(...b.timestamps)
      );
    } else {
      // default: rarity → name
      const order = { C:1, R:2, SuperRare:3, UR:4 };
      entries.sort((a, b) => {
        const d = order[b.rarity] - order[a.rarity];
        return d !== 0 ? d : a.name.localeCompare(b.name);
      });
    }

    if (entries.length === 0) {
      return interaction.reply({ content: 'No cards match filters.', ephemeral: true });
    }

    // Paginate
    const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
    const pages = Array.from(
      { length: totalPages },
      (_, i) => entries.slice(i * ITEMS_PER_PAGE, (i + 1) * ITEMS_PER_PAGE)
    );
    let listPage = 0;
    let imageIdx = 0;

    // Prepare image attachments
    const imageResults = entries
      .map(c => {
        const safe = c.name.replace(/[/\\?%*:|"<>]/g, '');
        const p = path.join(CARDS_ROOT, c.rarity, `${safe}.png`);
        return fs.existsSync(p)
          ? { ...c, attachment: new AttachmentBuilder(p, { name: `${safe}.png` }) }
          : null;
      })
      .filter(Boolean);

    // Builders
    const buildListEmbed = page => {
      const chunk = pages[page];
      return new EmbedBuilder()
        .setTitle(`${interaction.user.username}'s Inventory`)
        .setDescription(chunk.map(c => `**[${c.rarity}]** ${c.name} (x${c.count})`).join('\n'))
        .setColor(Colors.Blue)
        .setFooter({ text: `Page ${page+1}/${totalPages} • Pulls: ${userDoc.pulls}` });
    };

    const buildListButtons = page => new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('list_prev')
        .setLabel('⬅️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('list_view')
        .setLabel('🖼️ View Mode')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('list_next')
        .setLabel('➡️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === totalPages - 1),
      new ButtonBuilder()
        .setCustomId('skip')
        .setLabel('🔢 Go to Page')
        .setStyle(ButtonStyle.Secondary)
    );

    const buildImageEmbed = i => {
      const { name, rarity, count, attachment } = imageResults[i];
      const cm = { UltraRare:Colors.DarkPurple, SuperRare:Colors.Blue, Rare:Colors.Green, Common:Colors.Grey };
      return new EmbedBuilder()
        .setTitle(`[${rarity}] ${name} x${count}`)
        .setImage(`attachment://${attachment.name}`)
        .setColor(cm[rarity] ?? Colors.Default)
        .setFooter({ text: `Card ${i+1} of ${imageResults.length}` });
    };

    const buildImageButtons = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('⬅️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(imageIdx === 0),
      new ButtonBuilder()
        .setCustomId('back')
        .setLabel('🔙 List Mode')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('➡️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(imageIdx === imageResults.length - 1)
    );

    // Send first page
    const message = await interaction.reply({
      embeds: [buildListEmbed(0)],
      components: [buildListButtons(0)],
      fetchReply: true
    });

    // Collector
    const valid = ['list_prev','list_next','list_view','prev','next','back'];
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: i => valid.includes(i.customId) && i.user.id === interaction.user.id
    });

    collector.on('collect', async btn => {
      if (btn.customId === 'skip') {
    // build the modal
    const modal = new ModalBuilder()
      .setCustomId('skip_modal')
      .setTitle('Jump to Page');

    const input = new TextInputBuilder()
      .setCustomId('page_input')
      .setLabel(`Enter a page number (1–${totalPages})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 3')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    return btn.showModal(modal);
  }
      switch (btn.customId) {
        case 'list_prev':
          listPage--;
          return btn.update({ embeds:[buildListEmbed(listPage)], components:[buildListButtons(listPage)] });
        case 'list_next':
          listPage++;
          return btn.update({ embeds:[buildListEmbed(listPage)], components:[buildListButtons(listPage)] });
        case 'list_view':
          imageIdx = 0;
          return btn.update({
            embeds: [buildImageEmbed(imageIdx)],
            files:  [imageResults[imageIdx].attachment],
            components: [buildImageButtons()]
          });
        case 'prev':
        case 'next':
          imageIdx += btn.customId === 'next' ? 1 : -1;
          return btn.update({
            embeds: [buildImageEmbed(imageIdx)],
            files:  [imageResults[imageIdx].attachment],
            components: [buildImageButtons()]
          });
        case 'back':
          return btn.update({
            embeds: [buildListEmbed(listPage)],
            files:  [],
            components: [buildListButtons(listPage)]
          });
      }
    });
    const modalCollector = interaction.channel.createMessageComponentCollector({
  componentType: ComponentType.ModalSubmit,
  time: 120_000
});

modalCollector.on('collect', async modalInt => {
  if (modalInt.customId !== 'skip_modal' || modalInt.user.id !== interaction.user.id)
    return;

  // parse and clamp the page
  const raw = modalInt.fields.getTextInputValue('page_input');
  let target = parseInt(raw, 10);
  if (isNaN(target)) target = 1;
  target = Math.max(1, Math.min(target, totalPages));
  listPage = target - 1;

  // update the list‐embed
  await modalInt.update({
    embeds: [buildListEmbed(listPage)],
    components: [buildListButtons(listPage)],
    files: []  // clear any attachments
  });
});

    collector.on('end', async () => {
      const disabled = message.components.map(r => {
        const row = ActionRowBuilder.from(r);
        row.components.forEach(b => b.setDisabled(true));
        return row;
      });
      await message.edit({ components: disabled });
    });
  }
};
