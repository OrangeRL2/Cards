// commands/Utility/pull.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  Colors,
} = require('discord.js');
const path = require('node:path');
const weightedDraw = require('../../utils/weightedDraw');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Perform an 8-card gacha pull'),

  async execute(interaction) {
    let userDoc = await User.findOne({ id: interaction.user.id });
    if (!userDoc) userDoc = new User({ id: interaction.user.id });

    userDoc.pulls += 8;
    const results = [];

    for (let i = 0; i < 8; i++) {
      const { file } = weightedDraw();
      const rarity = path.basename(path.dirname(file));
      const name   = path.basename(file, path.extname(file));
      const atch   = new AttachmentBuilder(file, { name: path.basename(file) });

      results.push({ rarity, name, attachment: atch });

      const existing = userDoc.cards.get(name);
      const now = new Date();
      if (existing) {
        existing.count += 1;
        existing.timestamps.push(now);
      } else {
        userDoc.cards.set(name, {
          count: 1,
          rarity,
          timestamps: [now]
        });
      }
    }

    await userDoc.save();

    // Pagination UI (unchanged)…
    let idx = 0;
    const buildEmbed = i => {
      const { rarity, attachment } = results[i];
      const colorMap = { UR: Colors.DarkPurple, R: Colors.Green, C: Colors.Grey };
      return new EmbedBuilder()
        .setTitle(`Pull ${i+1} — ${rarity}`)
        .setImage(`attachment://${attachment.name}`)
        .setColor(colorMap[rarity] ?? Colors.Default)
        .setFooter({ text: `Card ${i+1} of ${results.length}` });
    };

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('⬅️ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('Next ➡️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(results.length === 1)
    );

    const message = await interaction.reply({
      embeds: [buildEmbed(0)],
      files: [results[0].attachment],
      components: [buttons],
      fetchReply: true
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000
    });

    collector.on('collect', async btnInt => {
      if (btnInt.user.id !== interaction.user.id) {
        return btnInt.reply({ content: "Not yours!", ephemeral: true });
      }
      idx += btnInt.customId === 'next' ? 1 : -1;
      buttons.components[0].setDisabled(idx === 0);
      buttons.components[1].setDisabled(idx === results.length - 1);
      await btnInt.update({
        embeds: [buildEmbed(idx)],
        files: [results[idx].attachment],
        components: [buttons]
      });
    });

    collector.on('end', async () => {
      buttons.components.forEach(b => b.setDisabled(true));
      await message.edit({ components: [buttons] });
    });
  }
};
