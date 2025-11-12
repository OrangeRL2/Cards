// commands/oshi.js
const { SlashCommandBuilder } = require('discord.js');
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
      const chosenAtText = doc.chosenAt ? ` — chosen <t:${Math.floor(new Date(doc.chosenAt).getTime() / 1000)}:R>` : '';
      const imagePart = oshiMeta && oshiMeta.image ? `\n${oshiMeta.image}` : '';

      await interaction.reply({
        content: `${displayName}'s oshi is **${oshiLabel}**${chosenAtText}.${imagePart}`,
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
