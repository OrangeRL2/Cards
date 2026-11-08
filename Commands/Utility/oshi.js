const { installLocalImageTransport } = require('../../utils/localizeInteractionEmbeds');
const { resolveOshiImage, remoteOshiImageUrl, embedImage } = require('../../utils/oshiImageResolver');
// commands/oshi.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const OshiUser = require('../../models/Oshi');
const OSHI_LIST = require('../../config/oshis');

// Lightweight override model used by /change-img (if present).
// Defining it here avoids requiring another file and is safe if the collection doesn't exist yet.
const { Schema } = mongoose;
const OshiImageOverrideSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  rarity: { type: String, trim: true, required: true },
  cardName: { type: String, trim: true, required: true },
  updatedAt: { type: Date, default: () => new Date() }
});
const OshiImageOverride = mongoose.models.OshiImageOverride || mongoose.model('OshiImageOverride', OshiImageOverrideSchema);


module.exports = {
  data: new SlashCommandBuilder()
    .setName('oshi')
    .setDescription('Show a user\'s oshi (or your own).')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('The user whose oshi you want to see')
        .setRequired(false)
    ),

  async execute(interaction) {
    installLocalImageTransport(interaction);
    try {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const targetId = targetUser.id;

      // Resolve display name (prefer guild displayName)
      let displayName = targetUser.tag;
      if (interaction.guild) {
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (member) displayName = member.displayName;
        } catch (e) {
          // ignore and keep fallback
        }
      } else {
        displayName = targetUser.username;
      }

      // Load the user's oshi document
      const doc = await OshiUser.findOne({ userId: targetId }).lean().exec();

      if (!doc) {
        if (targetId === interaction.user.id) {
          return await interaction.reply({ content: "You haven't picked an oshi yet. Use the oshi chooser command first.", ephemeral: true });
        } else {
          return await interaction.reply({ content: `${displayName} hasn't picked an oshi yet.`, ephemeral: true });
        }
      }

      const oshiMeta = OSHI_LIST.find(o => o.id === doc.oshiId);
      const oshiLabel = oshiMeta ? oshiMeta.label : doc.oshiId;

      // Level / XP info
      const level = doc.level || 0;
      const xp = doc.xp || 0;
      const xpToNext = doc.xpToNext || 100;
      const progressPercent = Math.min(100, Math.max(0, (xp / xpToNext) * 100));
      const progressBarSegments = 10;
      const filledSegments = Math.floor(progressPercent / (100 / progressBarSegments));
      const emptySegments = progressBarSegments - filledSegments;
      const progressBar = '█'.repeat(filledSegments) + '░'.repeat(emptySegments);

      // Prefer override from OshiImageOverride collection if present
      const override = await OshiImageOverride.findOne({ userId: targetId }).lean().exec();

      const selectedCard = override?.rarity && override?.cardName
        ? { rarity: override.rarity, cardName: override.cardName }
        : { rarity: 'OSR', cardName: `${String(oshiLabel).trim()} 001` };
      const resolved = resolveOshiImage(selectedCard.rarity, selectedCard.cardName);
      // A missing local file does NOT mean its artwork is missing on the image
      // server. This remote fallback was supported before the Nov 8 patch.
      const remoteUrl = resolved.path ? null : remoteOshiImageUrl(selectedCard.rarity, selectedCard.cardName);
      const image = resolved.path ? embedImage(resolved.path)
        : remoteUrl ? { url: remoteUrl, file: null }
        : null;
      if (!image) {
        console.warn(`[oshi] Invalid artwork path for user ${targetId}: [${selectedCard.rarity}] ${selectedCard.cardName}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`${displayName}'s Oshi: ${oshiLabel}`)
        .setColor(0xFF69B4)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
        .addFields(
          {
            name: 'Anniversary Progress',
            value: `**${level} Years**\n${xp}/${xpToNext} days until next anniversary\n\`${progressBar}\` ${progressPercent.toFixed(1)}%`,
            inline: true
          }
        );

      if (image) embed.setImage(image.url);
      if (!image) embed.addFields({ name: 'Oshi image', value: 'Artwork file unavailable on the bot server.', inline: false });

      if (doc.chosenAt) {
        embed.addFields({
          name: 'Debut',
          value: `<t:${Math.floor(new Date(doc.chosenAt).getTime() / 1000)}:R>`,
          inline: true
        });
      }

      if (doc.lastLeveledAt) {
        embed.addFields({
          name: 'Last Anniversary',
          value: `<t:${Math.floor(new Date(doc.lastLeveledAt).getTime() / 1000)}:R>`,
          inline: true
        });
      }

      await interaction.reply({ embeds: [embed], ...(image?.file ? { files: [image.file] } : {}), ephemeral: false });
    } catch (err) {
      console.error('[CMD] /oshi error', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'An error occurred while fetching oshi info.', ephemeral: true });
      } else {
        await interaction.followUp({ content: 'An error occurred while fetching oshi info.', ephemeral: true });
      }
    }
  }
};

