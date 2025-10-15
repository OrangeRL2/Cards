// commands/Utility/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top pullers'),

  async execute(interaction) {
    // 1) Get top 10 from Mongo, no _id needed in output
    const topUsers = await User.find()
      .sort({ pulls: -1 })
      .limit(10)
      .lean();

    // 2) Map each Mongo document to a display string
    const lines = await Promise.all(
      topUsers.map(async (doc, index) => {
        let displayName;

        // Try to fetch the guild member (for nicknames)
        try {
          const member = await interaction.guild.members.fetch(doc.id);
          displayName = member.displayName;
        } catch {
          // Fallback to global username#discriminator
          const user = await interaction.client.users.fetch(doc.id);
          displayName = user.tag;
        }

        return `**#${index + 1}** • ${displayName} — ${doc.pulls} pulls`;
      })
    );

    // 3) Send an embed
    const embed = new EmbedBuilder()
      .setTitle('🏆 Pull Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor('Gold');

    await interaction.reply({ embeds: [embed] });
  },
};
