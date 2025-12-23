// commands/Utility/leaderboard.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const User = require('../../models/User');

const PAGE_SIZE = 10;
const COLLECTOR_TIMEOUT = 5 * 60 * 1000; // 2 minutes
const DISCORD_UNKNOWN_INTERACTION = 10062;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top pullers'),
  requireOshi: true,

  async execute(interaction) {
    // Safe reply helper (handles deferred/replied state and unknown interaction)
    const safeReplyOrEdit = async (payload) => {
      try {
        if (interaction.deferred || interaction.replied) {
          return await interaction.editReply(payload);
        }
        return await interaction.reply({ ...payload, fetchReply: true });
      } catch (err) {
        if (err?.code === DISCORD_UNKNOWN_INTERACTION) return null;
        throw err;
      }
    };

    // Safe message edit (handles unknown message errors)
    const safeEditMessage = async (message, payload) => {
      try {
        return await message.edit(payload);
      } catch (err) {
        if (err?.code === DISCORD_UNKNOWN_INTERACTION) return null;
        throw err;
      }
    };

    await interaction.deferReply().catch(() => {});

    // Fetch top 100 users (id and pulls only)
    const topUsers = await User.find()
      .select('id pulls -_id')
      .sort({ pulls: -1 })
      .limit(100)
      .lean();

    if (!topUsers || topUsers.length === 0) {
      await safeReplyOrEdit({ content: 'No leaderboard data available.' }).catch(() => {});
      return;
    }

    const totalPages = Math.max(1, Math.ceil(topUsers.length / PAGE_SIZE));
    let page = 0;

    const resolveDisplayName = async (id) => {
      try {
        if (interaction.guild) {
          const member = await interaction.guild.members.fetch(id).catch(() => null);
          if (member) return member.displayName;
        }
      } catch {}
      try {
        const user = await interaction.client.users.fetch(id).catch(() => null);
        if (user) return user.tag;
      } catch {}
      return id;
    };
const resolveDisplayNameFast = async (id, client, guild) => {
  // 1) guild member displayName if available (best UX)
  if (guild) {
    try {
      const memberCached = guild.members.cache.get(id);
      if (memberCached) return memberCached.displayName;
      // try a fetch as a fallback (may be rate-limited / slower)
      const fetchedMember = await guild.members.fetch(id).catch(() => null);
      if (fetchedMember) return fetchedMember.displayName;
    } catch {}
  }

  // 2) client cache user tag
  const cached = client.users.cache.get(id);
  if (cached) return cached.tag;

  // 3) one-off fetch from API — slower but ensures a readable name after restarts
  try {
    const fetched = await client.users.fetch(id).catch(() => null);
    if (fetched) return fetched.tag;
  } catch {}
  
  // 4) final fallback to raw id
  return id;
};

const userIndex = topUsers.findIndex(u => u.id === interaction.user.id);
  const userRank = userIndex === -1 ? null : userIndex + 1;
  const makeEmbed = async (pageIndex) => {
  const start = pageIndex * PAGE_SIZE;
  const slice = topUsers.slice(start, start + PAGE_SIZE);

  const lines = await Promise.all(
    slice.map(async (doc, idx) => {
      const rank = start + idx + 1;
      const pulls = typeof doc.pulls === 'number' ? doc.pulls : 0;
      const displayName = await resolveDisplayNameFast(doc.id, interaction.client, interaction.guild);
      // highlight the user who invoked the command
      return `**#${rank}** • ${displayName} - ${pulls} pulls`;
    })
  );

  const footerRank = userRank ? ` • Your rank: #${userRank}` : ' • Your rank: Unranked';
  return new EmbedBuilder()
    .setTitle('🏆 Pull Leaderboard')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Page ${pageIndex + 1} of ${totalPages}${footerRank}` })
    .setColor('Gold');
};



    const makeRow = (pageIndex, disabled = false) => {
      const prev = new ButtonBuilder()
        .setCustomId('lb_prev')
        .setLabel('◀ Prev')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || pageIndex <= 0);

      const next = new ButtonBuilder()
        .setCustomId('lb_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || pageIndex >= totalPages - 1);

      return new ActionRowBuilder().addComponents(prev, next);
    };

    // initial send
    const initialEmbed = await makeEmbed(page);
    const initialRow = makeRow(page);

    let message;
    try {
      const sent = await safeReplyOrEdit({ embeds: [initialEmbed], components: [initialRow], fetchReply: true });
      if (!sent) return;
      message = sent;
    } catch (err) {
      console.error('Failed to send leaderboard reply', err);
      return;
    }

    const filter = (i) => i.user.id === interaction.user.id && ['lb_prev', 'lb_next'].includes(i.customId);
    const collector = message.createMessageComponentCollector({ filter, time: COLLECTOR_TIMEOUT });

    let collectorStoppedDueToUnknown = false;

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        try {
          await i.reply({ content: "You can't control this leaderboard.", ephemeral: true });
        } catch {}
        return;
      }

      await i.deferUpdate().catch(() => {});

      if (i.customId === 'lb_prev' && page > 0) page -= 1;
      else if (i.customId === 'lb_next' && page < totalPages - 1) page += 1;

      try {
        const newEmbed = await makeEmbed(page);
        const newRow = makeRow(page);
        const edited = await safeEditMessage(message, { embeds: [newEmbed], components: [newRow] });
        if (edited === null) {
          collectorStoppedDueToUnknown = true;
          collector.stop('unknown_interaction');
        }
      } catch (err) {
        if (err?.code === DISCORD_UNKNOWN_INTERACTION) {
          collectorStoppedDueToUnknown = true;
          collector.stop('unknown_interaction');
        } else {
          console.error('Failed updating leaderboard page', err);
        }
      }
    });

    collector.on('end', async () => {
      if (collectorStoppedDueToUnknown) return;
      const disabledRow = makeRow(page, true);
      try {
        await safeEditMessage(message, { components: [disabledRow] }).catch(() => {});
      } catch {}
    });
  }
};
