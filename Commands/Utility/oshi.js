// commands/oshi.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const OshiUser = require('../../models/Oshi');
const OSHI_LIST = require('../../config/oshis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('oshi')
    .setDescription('Show the oshi a user picked. If no user is provided, shows your oshi.')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user whose oshi you want to see')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const targetId = targetUser.id;

      // Try to resolve a GuildMember to get displayName; fallback to tag if not available
      let displayName = targetUser.tag;
      if (interaction.guild) {
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (member) displayName = member.displayName;
        } catch (e) {
          // ignore and keep fallback
        }
      } else {
        // If no guild (DM), fall back to username/tag
        displayName = targetUser.username;
      }

      const doc = await OshiUser.findOne({ userId: targetId }).lean().exec();

      if (!doc) {
        if (targetId === interaction.user.id) {
          return await interaction.reply({
            content: "You haven't picked an oshi yet. Use the command that triggers the oshi chooser.",
            ephemeral: true,
          });
        } else {
          return await interaction.reply({
            content: `${displayName} hasn't picked an oshi yet.`,
            ephemeral: true,
          });
        }
      }

      const oshiMeta = OSHI_LIST.find(o => o.id === doc.oshiId);
      const oshiLabel = oshiMeta ? `${oshiMeta.label}` : doc.oshiId;
      
      // Get level and XP info
      const level = doc.level || 1;
      const xp = doc.xp || 0;
      const xpToNext = doc.xpToNext || 100; // Default if not set
      
      // Calculate XP progress percentage
      const progressPercent = Math.min(100, Math.max(0, (xp / xpToNext) * 100));
      
      // Create progress bar (10 segments)
      const progressBarSegments = 10;
      const filledSegments = Math.floor(progressPercent / (100 / progressBarSegments));
      const emptySegments = progressBarSegments - filledSegments;
      const progressBar = '█'.repeat(filledSegments) + '░'.repeat(emptySegments);

      // Build the image URL
      const baseName = typeof oshiLabel === 'string' ? oshiLabel.trim() : String(oshiLabel);
      const cardName = `${baseName} 001`;
      const rarity = 'OSR';
      const encodedCardName = encodeURIComponent(cardName);
      const imageUrl = `http://152.69.195.48/images/${rarity}/${encodedCardName}.png`;

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle(`${displayName}'s Oshi: ${oshiLabel}`)
        .setColor(0xFF69B4) // Pink color for oshi theme
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
        .setImage(imageUrl)
        .addFields(
          { 
            name: 'Level Progress', 
            value: `**Level ${level}**\n${xp}/${xpToNext} XP\n\`${progressBar}\` ${progressPercent.toFixed(1)}%`,
            inline: true 
          }
        );

      // Add chosen time if available
      if (doc.chosenAt) {
        embed.addFields({
          name: 'Chosen',
          value: `<t:${Math.floor(new Date(doc.chosenAt).getTime() / 1000)}:R>`,
          inline: true
        });
      }

      // Add last leveled time if available
      if (doc.lastLeveledAt) {
        embed.addFields({
          name: 'Last Level Up',
          value: `<t:${Math.floor(new Date(doc.lastLeveledAt).getTime() / 1000)}:R>`,
          inline: true
        });
      }

      await interaction.reply({
        embeds: [embed],
        ephemeral: false,
      });
    } catch (err) {
      console.error('[CMD] /oshi error', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'An error occurred while fetching oshi info.', ephemeral: true });
      } else {
        await interaction.followUp({ content: 'An error occurred while fetching oshi info.', ephemeral: true });
      }
    }
  },
};
