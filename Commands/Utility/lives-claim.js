// Commands/Utility/lives-claim.js
const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const User = require('../../models/User');
const { resolveAttemptAtomic, getDurationForStage, getStageName } = require('../../utils/liveAsync');

function msToHuman(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [];
  if (hrs) parts.push(`${hrs}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resultlives')
    .setDescription('Claim all ready live attempts and view stage statuses.'),
    requireOshi: true,
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });
    const userId = interaction.user.id;

    const user = await User.findOne({ id: userId }).lean();
    if (!user) return interaction.editReply({ content: 'You have no pending live attempts.', ephemeral: true });

    const now = Date.now();

    // Claim ready attempts
    const readyAttempts = (user.pendingAttempts || []).filter(a => !a.resolved && new Date(a.readyAt).getTime() <= now);

    const results = [];
    let successCount = 0;
    for (const att of readyAttempts) {
      try {
        const out = await resolveAttemptAtomic(userId, att.id);
        const stageName = getStageName(att.stage);
        if (!out.success) {
        results.push({ stage: att.stage, stageName, name: att.name, ok: false, note: out.reason || 'failed', points: out.awardedPoints || 0 });
            } else {
              const ok = Boolean(out.successResult);
              const note = ok
                ? (out.pCard ? `succeeded with her live and brought home **[P] ${out.pCard.name}** with her` : 'came home alone')
                : 'Live Failed.. - Graduated from sadness';
              results.push({ stage: att.stage, stageName, rarity: att.rarity, name: att.name, ok, note, points: out.awardedPoints || 0 });
              if (ok) successCount++;
            }
      } catch (err) {
        console.error('resolveAttemptAtomic error:', err);
        const stageName = getStageName(att?.stage ?? 'unknown');
        results.push({ stage: att?.stage, stageName, name: att?.name ?? 'unknown', ok: false, note: 'internal error' });
      }
    }

    // Re-fetch user to show current pending attempts & per-stage statuses
    const userAfter = await User.findOne({ id: userId }).lean();
    const stages = [1, 2, 3, 4, 5].map(stageNum => {
      const slot = (userAfter.pendingAttempts || []).find(a => !a.resolved && Number(a.stage) === stageNum);
      const durationMs = getDurationForStage(stageNum) || 0;
      if (!slot) return { stage: stageNum, empty: true, durationMs };
      const readyAt = new Date(slot.readyAt).getTime();
      const readyNow = readyAt <= now;
      const msUntil = Math.max(0, readyAt - now);
      return { stage: stageNum, empty: false, readyNow, msUntil, readyAt, durationMs, name: slot.name, rarity: slot.rarity };
    });

    const nextReadyTs = (userAfter.pendingAttempts || [])
      .filter(a => !a.resolved)
      .map(a => new Date(a.readyAt).getTime())
      .filter(t => t > now);
    const nextReadyText = nextReadyTs.length ? `<t:${Math.floor(Math.min(...nextReadyTs) / 1000)}:R>` : 'No pending attempts';

    const embed = new EmbedBuilder()
      .setTitle('Lives Claim Results')
      .setDescription(results.length
        ? results.map(r => `${r.ok ? '✅' : '❌'} [${r.stageName}] | **[${r.rarity}]** ${r.name} ${r.note}${r.points ? ` • + ${r.points} pts` : ''}`).join('\n')
        : 'No ready attempts to claim right now.')
      .setColor(successCount > 0 ? Colors.Green : Colors.Yellow)
      .addFields(
        { name: 'Successes', value: `${successCount}`, inline: true },
        { name: 'Next ready', value: nextReadyText, inline: true }
      );

    // Add per-stage details — use Discord relative timestamps (<t:...:R>) for ready times
    stages.forEach(s => {
      const stageLabel = `${s.stage} - (${getStageName(s.stage)})`;
      if (s.empty) {
        embed.addFields({ name: `${stageLabel}`, value: `Empty • Duration ${msToHuman(s.durationMs)}`, inline: false });
      } else {
        const readyTs = Math.floor(s.readyAt / 1000);
        const readyRelative = `<t:${readyTs}:R>`;
        if (s.readyNow) {
          embed.addFields({
            name: `${stageLabel}`,
            value: `Occupied (ready) • **[${s.rarity}]** ${s.name} • Ready ${readyRelative}`,
            inline: false
          });
        } else {
          embed.addFields({
            name: `${stageLabel}`,
            value: `Occupied • **[${s.rarity}]** ${s.name} • Ready ${readyRelative}`,
            inline: false
          });
        }
      }
    });

    return interaction.editReply({ embeds: [embed] });
  }
};
