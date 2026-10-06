// Commands/Utility/show-points.js
const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show how many points a player has (you or another user).')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('User to look up (omit to see your own points)')
        .setRequired(false)
    ),
  requireOshi: true,
  async execute(interaction) {
    try {
      const requesterId = interaction.user.id;
      const targetUser = interaction.options.getUser('target') || interaction.user;

      // Use ephemeral for self-lookup, public for others
      const ephemeral = false;
      await interaction.deferReply({ ephemeral });

      // find user doc by Discord id stored in User.id
      const u = await User.findOne({ id: targetUser.id }).lean();

      const points = (u && typeof u.points === 'number') ? u.points : 0;
      const pulls = (u && typeof u.pulls === 'number') ? u.pulls : 0;

      // NEW: pulls since last SEC
      const pullsSinceLastSEC =
        (u && typeof u.pullsSinceLastSEC === 'number') ? u.pullsSinceLastSEC : 0;

      const cardCount = Array.isArray(u?.cards)
        ? u.cards.reduce((s, c) => s + (Number(c.count) || 0), 0)
        : 0;

      const pending = Array.isArray(u?.pendingAttempts)
        ? u.pendingAttempts.filter(a => !a.resolved).length
        : 0;

      const embed = new EmbedBuilder()
        .setTitle(`${targetUser.username}'s Account`)
        .setColor(targetUser.id === requesterId ? Colors.Green : Colors.Blurple)
        .addFields(
          { name: 'Fans', value: `${points}`, inline: true },
          { name: 'Pulls', value: `${pulls}`, inline: true },
          { name: 'Pulls Since Last SEC', value: `${pullsSinceLastSEC}`, inline: true },
          { name: 'Cards (total count)', value: `${cardCount}`, inline: true },
          { name: 'Pending lives', value: `${pending}`, inline: true }
        )
        .setFooter({ text: `Requested by ${interaction.user.username}` });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('show-points error', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({ content: 'Internal error while fetching points.', ephemeral: true });
        }
        return interaction.editReply({ content: 'Internal error while fetching points.' });
      } catch {
        return;
      }
    }
  }
};