// Commands/Utility/lives-claim.js
const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const User = require('../../models/User');
const { resolveAttemptAtomic, getDurationForStage, getStageName, normalizeCardName } = require('../../utils/liveAsync');

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
    if (!user) return interaction.editReply({ content: 'You have no pending live attempts.' });

    const now = Date.now();

    // Build deterministic map: for each stage pick the unresolved attempt with earliest readyAt
    const stageMap = {};
    (user.pendingAttempts || []).forEach(a => {
      if (a.resolved) return;
      const s = Number(a.stage);
      const readyAt = new Date(a.readyAt).getTime();
      if (!stageMap[s] || readyAt < new Date(stageMap[s].readyAt).getTime()) {
        stageMap[s] = a;
      }
    });

    // Claim ready attempts: collect all attempts that are ready (by scanning stageMap)
    const readyAttempts = Object.values(stageMap).filter(a => new Date(a.readyAt).getTime() <= now);

    if (!readyAttempts.length) {
      // show per-stage status using stageMap and deterministic selection
      const nextReadyTsEmpty = Object.values(stageMap)
        .map(a => new Date(a.readyAt).getTime())
        .filter(t => t > now);
      const nextReadyTextEmpty = nextReadyTsEmpty.length ? `<t:${Math.floor(Math.min(...nextReadyTsEmpty) / 1000)}:R>` : 'No pending attempts';

      const embedEmpty = new EmbedBuilder()
        .setTitle('Lives Claim Results')
        .setDescription('No ready attempts to claim right now.')
        .setColor(Colors.Yellow)
        .addFields(
          { name: 'Successes', value: `0`, inline: true },
          { name: 'Next ready', value: nextReadyTextEmpty, inline: true }
        );

      [1,2,3,4,5].forEach(stageNum => {
        const slot = stageMap[stageNum];
        const durationMs = getDurationForStage(stageNum) || 0;
        const stageLabel = `${stageNum} - (${getStageName(stageNum)})`;
        if (!slot) {
          embedEmpty.addFields({ name: `${stageLabel}`, value: `Empty • Duration ${msToHuman(durationMs)}`, inline: false });
        } else {
          const readyTs = Math.floor(new Date(slot.readyAt).getTime() / 1000);
          const readyRelative = `<t:${readyTs}:R>`;
          const readyNow = new Date(slot.readyAt).getTime() <= now;
          if (readyNow) {
            embedEmpty.addFields({
              name: `${stageLabel}`,
              value: `Occupied (ready) • **[${slot.rarity}]** ${slot.name} • Ready ${readyRelative}`,
              inline: false
            });
          } else {
            embedEmpty.addFields({
              name: `${stageLabel}`,
              value: `Occupied • **[${slot.rarity}]** ${slot.name} • Ready ${readyRelative}`,
              inline: false
            });
          }
        }
      });

      return interaction.editReply({ embeds: [embedEmpty] });
    }

    const MAX_PROCESS = 25;
    const toProcess = readyAttempts.slice(0, MAX_PROCESS);

    const results = [];
    let successCount = 0;

    for (const att of toProcess) {
      try {
        const out = await resolveAttemptAtomic(userId, att.id);
        const stageName = getStageName(att.stage);
        if (!out || out.success === false) {
          results.push({
            stage: att.stage,
            stageName,
            rarity: att.rarity || 'unknown',
            name: att.name,
            ok: false,
            note: out?.reason || 'failed',
            points: out?.awardedPoints || 0
          });
        } else {
          const ok = Boolean(out.successResult);
          let note;
          const sentName = normalizeCardName(att.name) || '';

          if (ok) {
            if (out.pCard) {
              const gainedRarity = out.pCard.rarity || 'P';
              const gainedName = out.pCard.name || out.pCard.displayName || 'special guest';
              note = `**[${gainedRarity}] ${gainedName}** showed up at **${sentName}**'s live!`;
            } else {
              note = `**${sentName}** came home from the live`;
            }
          } else {
            note = `**${sentName}** Live Failed.. - Graduated from sadness`;
          }

          results.push({
            stage: att.stage,
            stageName,
            rarity: att.rarity || 'unknown',
            name: att.name,
            ok,
            note,
            points: out.awardedPoints || 0
          });
          if (ok) successCount++;
        }
      } catch (err) {
        console.error('resolveAttemptAtomic error:', err);
        const stageName = getStageName(att?.stage ?? 'unknown');
        results.push({ stage: att?.stage, stageName, rarity: att?.rarity || 'unknown', name: att?.name ?? 'unknown', ok: false, note: 'internal error', points: 0 });
      }
    }

    const moreNotice = readyAttempts.length > MAX_PROCESS ? `\n\n(Processed ${MAX_PROCESS} of ${readyAttempts.length} ready attempts — run again to claim the rest.)` : '';

    // Re-fetch user to show current pending attempts after processing and rebuild deterministic stageMap
    const userAfter = await User.findOne({ id: userId }).lean();
    const stageMapAfter = {};
    (userAfter?.pendingAttempts || []).forEach(a => {
      if (a.resolved) return;
      const s = Number(a.stage);
      const readyAt = new Date(a.readyAt).getTime();
      if (!stageMapAfter[s] || readyAt < new Date(stageMapAfter[s].readyAt).getTime()) {
        stageMapAfter[s] = a;
      }
    });

    const nextReadyTs = Object.values(stageMapAfter)
      .map(a => new Date(a.readyAt).getTime())
      .filter(t => t > now);
    const nextReadyText = nextReadyTs.length ? `<t:${Math.floor(Math.min(...nextReadyTs) / 1000)}:R>` : 'No pending attempts';

    const embed = new EmbedBuilder()
      .setTitle('Lives Claim Results')
      .setDescription(
        results.length
          ? results.map(r => {
              let pointsText = '';
              if (r.points) {
                const unit = Number(r.points) === 1 ? 'fan' : 'fans';
                if (Number(r.stage) === 5) {
                  pointsText = ` and gained ${r.points} ${unit}!`;
                } else {
                  pointsText = `, and ${r.points} ${unit} stayed behind after graduation ended`;
                }
              }
              return `${r.ok ? '✅' : '❌'} [${r.stageName} live] |  ${r.note}${pointsText}`;
            }).join('\n') + moreNotice
          : 'No ready attempts to claim right now.'
      )
      .setColor(successCount > 0 ? Colors.Green : Colors.Yellow)
      .addFields(
        { name: 'Successes', value: `${successCount}`, inline: true },
        { name: 'Next ready', value: nextReadyText, inline: true }
      );

    [1,2,3,4,5].forEach(stageNum => {
      const slot = stageMapAfter[stageNum];
      const durationMs = getDurationForStage(stageNum) || 0;
      const stageLabel = `${stageNum} - (${getStageName(stageNum)})`;
      if (!slot) {
        embed.addFields({ name: `${stageLabel}`, value: `Empty • Duration ${msToHuman(durationMs)}`, inline: false });
      } else {
        const readyTs = Math.floor(new Date(slot.readyAt).getTime() / 1000);
        const readyRelative = `<t:${readyTs}:R>`;
        const readyNow = new Date(slot.readyAt).getTime() <= now;
        if (readyNow) {
          embed.addFields({
            name: `${stageLabel}`,
            value: `Occupied (ready) • **[${slot.rarity}]** ${slot.name} • Ready ${readyRelative}`,
            inline: false
          });
        } else {
          embed.addFields({
            name: `${stageLabel}`,
            value: `Occupied • **[${slot.rarity}]** ${slot.name} • Ready ${readyRelative}`,
            inline: false
          });
        }
      }
    });

    return interaction.editReply({ embeds: [embed] });
  }
};
