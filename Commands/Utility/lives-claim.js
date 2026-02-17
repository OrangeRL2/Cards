// Commands/Utility/lives-claim.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const User = require('../../models/User');
const {
  resolveAttemptAtomic,
  getDurationForStage,
  getStageName,
  normalizeCardName
} = require('../../utils/liveAsync');
const { startAttemptAtomic } = require('../../utils/liveAsync');

// Helpers (copied/adapted from lives-start.js)
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
function levenshtein(a, b) {
  const aLen = a.length, bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  let v0 = Array(bLen + 1).fill(0).map((_, i) => i);
  let v1 = Array(bLen + 1).fill(0);
  for (let i = 0; i < aLen; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bLen; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    [v0, v1] = [v1, v0];
  }
  return v0[bLen];
}
// findBestCardMatch: returns card element or null
function findBestCardMatch(cards, query, rarity, minCount = 1) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const q = (query || '').toLowerCase().trim();
  let best = null;
  for (const c of cards) {
    if (rarity && String(c.rarity).toLowerCase() !== String(rarity).toLowerCase()) continue;
    if (c.locked) continue;
    const name = String(c.name || '').toLowerCase();
    if (!name) continue;
    if (!c.count || c.count < minCount) continue;
    let score = 0;
    if (name === q) score = 100;
    else if (q.length > 0 && name.startsWith(q)) score = 80;
    else if (q.length > 0 && name.includes(q)) score = 60;
    else {
      const dist = levenshtein(q, name);
      const norm = 1 - (dist / Math.max(name.length, q.length, 1));
      score = Math.max(0, Math.round(norm * 50));
    }
    if (!best || score > best.score) best = { card: c, score };
  }
  return best ? best.card : null;
}

// pickRandomOwnedCard: pick random owned card matching rarity and minCount
function pickRandomOwnedCard(cards, rarity, minCount = 1) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const pool = cards.filter(c => (!rarity || String(c.rarity).toLowerCase() === String(rarity).toLowerCase()) && c.count >= minCount && !c.locked);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

const STAGE_LIST = [1, 2, 3, 4, 5];
const EPHEMERAL_FLAG = 1 << 6;

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

      STAGE_LIST.forEach(stageNum => {
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
              // Prefer multi-reward list; fallback to single reward for backward compatibility
              const gainedCards =
                Array.isArray(out.pCards) ? out.pCards :
                (out.pCard ? [out.pCard] : []);
            
              const formatCard = (c) => {
                const gainedRarity = c?.rarity || 'P';
                const gainedName = c?.displayName || c?.name || 'special guest';
                return `**[${gainedRarity}] ${gainedName}**`;
              };
            
              if (gainedCards.length >= 2) {
                // Your requested format when 2 appeared:
                // **[R] Name** & **[R] Name** showed up at **Sent**'s live!
                const shown = gainedCards.slice(0, 2).map(formatCard).join(' & ');
                note = `${shown} showed up at **${sentName}**'s live!`;
              } else if (gainedCards.length === 1) {
                note = `${formatCard(gainedCards[0])} showed up at **${sentName}**'s live!`;
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

    STAGE_LIST.forEach(stageNum => {
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

    // --- Resend finished lives button logic ---
    // Determine which stages were processed in this run (unique)
    const processedStages = results
      .filter(r => r && r.stage)
      .map(r => Number(r.stage))
      .filter((v, i, a) => a.indexOf(v) === i);

    // Map stage -> last processed rarity (so we can pick matching random cards)
    const processedRarityMap = {};
    for (const r of results) {
      if (r && r.stage) processedRarityMap[Number(r.stage)] = r.rarity || null;
    }

    // Fetch stored lastLiveOptions from userAfter (schema must include lastLiveOptions.stage_X)
    const lastOpts = userAfter?.lastLiveOptions || {};

    // Eligible stages: processed in this run AND have stored options (multi/any) AND not currently occupied
    const eligibleStages = processedStages.filter(s => {
      const opt = lastOpts?.[`stage_${s}`];
      if (!opt || (typeof opt.any !== 'boolean' && typeof opt.multi !== 'boolean')) return false;
      // skip if stage currently occupied (unresolved attempt exists)
      const slot = (userAfter?.pendingAttempts || []).find(a => !a.resolved && Number(a.stage) === Number(s));
      return !slot;
    });

    if (eligibleStages.length > 0) {
      const resendBtn = new ButtonBuilder()
        .setCustomId(`live_resend_finished_${interaction.id}_${Date.now()}`)
        .setLabel('Resend finished lives')
        .setStyle(ButtonStyle.Primary);

      const actionRow = new ActionRowBuilder().addComponents(resendBtn);

      try {
        await interaction.editReply({ embeds: [embed], components: [actionRow] });
      } catch {
        // fallback: edit without components
        await interaction.editReply({ embeds: [embed] });
      }

      // create collector for the button
      const fetched = await interaction.fetchReply();
      const btnCollector = fetched.createMessageComponentCollector({ time: 120_000 });

      btnCollector.on('collect', async btn => {
  if (btn.user.id !== interaction.user.id) {
    await btn.reply({ content: "This isn't for you.", ephemeral: true });
    return;
  }

  // DO NOT defer the button interaction here. If we need to show a modal,
  // showModal must be called on the original interaction before any reply/deferral.
  // We'll decide later whether to reply or followUp based on whether a modal was shown.
  const freshUser = await User.findOne({ id: userId }).lean();
  const stagesToProcess = eligibleStages.filter(s => {
    const slot = (freshUser?.pendingAttempts || []).find(a => !a.resolved && Number(a.stage) === Number(s));
    return !slot;
  });

  if (!stagesToProcess.length) {
    await btn.reply({ content: 'No eligible finished lives to resend (they may be occupied now).', ephemeral: true });
    btnCollector.stop();
    return;
  }

  const summary = [];
  let modalShown = false; // track whether we called showModal at least once

  for (const s of stagesToProcess) {
    const opts = lastOpts?.[`stage_${s}`];
    if (!opts) {
      summary.push(`Stage ${s}: skipped (no saved options)`);
      continue;
    }

    const targetRarity = processedRarityMap[s] || null;
    const minCount = opts.multi ? 2 : 1;

    if (opts.any) {
      // random pick flow (no modal)
      const fresh = await User.findOne({ id: userId }).lean();
      const candidate = pickRandomOwnedCard(fresh.cards || [], targetRarity, minCount);
      if (!candidate) {
        summary.push(`Stage ${s}: skipped (no matching owned card for random pick${targetRarity ? ` of rarity ${targetRarity}` : ''})`);
        continue;
      }

      const startRes = await startAttemptAtomic(userId, candidate.name, candidate.rarity);
      if (startRes && startRes.success) {
        try {
          await User.updateOne({ id: userId }, { $set: { [`lastLiveOptions.stage_${s}`]: opts } }).exec();
        } catch (e) {
          console.warn('[live.claim] failed to persist lastLiveOptions on resend', e);
        }
        summary.push(`Stage ${s}: resent as [${candidate.rarity}] ${candidate.name}`);
      } else {
        summary.push(`Stage ${s}: failed to resend (${startRes?.reason || 'unknown'})`);
      }
      continue;
    }

    // any:false -> show modal to ask for name
    // IMPORTANT: showModal must be called on the original button interaction (btn) before replying/deferring it.
    modalShown = true;
    const modalId = `live_resend_name_modal_${interaction.id}_${s}_${Date.now()}`;
    const modal = new ModalBuilder().setCustomId(modalId).setTitle(`Resend Stage ${s} (${getStageName(s)})`);
    const nameInput = new TextInputBuilder()
      .setCustomId('name_field')
      .setLabel(`Card name for stage ${s}`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(opts.multi ? 'Enter a card you own with count >1' : 'Enter card name or partial')
      .setRequired(true)
      .setMaxLength(100);
    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

    try {
      await btn.showModal(modal);
    } catch (e) {
      console.error('showModal failed for resend', e);
      summary.push(`Stage ${s}: could not open modal`);
      // If showModal fails, continue to next stage
      continue;
    }

    // await modal submit
let submitted;
try {
  submitted = await btn.awaitModalSubmit({
    time: 30_000,
    filter: (m) => m.customId === modalId && m.user.id === interaction.user.id
  });
} catch (e) {
  summary.push(`Stage ${s}: timed out waiting for name`);
  continue;
}

if (!submitted) {
  summary.push(`Stage ${s}: no modal submission received`);
  continue;
}

// IMPORTANT: acknowledge the modal submit immediately to avoid client error
let deferred = false;
try {
  await submitted.deferReply({ ephemeral: true }); // acknowledge quickly
  await submitted.deleteReply(); // remove the ephemeral reply so nothing is shown
} catch (err) {
  console.warn('[live.claim] modal ack/delete failed', err);
  // fallback: try to clear the reply instead of deleting
  try { await submitted.editReply({ content: '' }); } catch {}
}

const rawName = submitted.fields.getTextInputValue('name_field').trim();
const fresh2 = await User.findOne({ id: userId }).lean();
const candidate = findBestCardMatch(fresh2.cards || [], rawName, targetRarity, minCount);

if (!candidate) {
  summary.push(`Stage ${s}: no matching owned card for "${rawName}"`);
  if (deferred) {
    try { await submitted.editReply({ content: `No matching owned card found for "${rawName}".`, ephemeral: true }); } catch {}
  }
  continue;
}

let startRes2;
try {
  startRes2 = await startAttemptAtomic(userId, candidate.name, candidate.rarity);
} catch (err) {
  console.error('[live.claim] startAttemptAtomic error (resend modal)', err);
  summary.push(`Stage ${s}: failed to resend (internal error)`);
  if (deferred) {
    try { await submitted.editReply({ content: `Failed to resend stage ${s}: internal error`, ephemeral: true }); } catch {}
  }
  continue;
}

if (startRes2 && startRes2.success) {
  try {
    await User.updateOne({ id: userId }, { $set: { [`lastLiveOptions.stage_${s}`]: opts } }).exec();
  } catch (e) {
    console.warn('[live.claim] failed to persist lastLiveOptions on resend (modal)', e);
  }

  summary.push(`Stage ${s}: resent as [${candidate.rarity}] ${candidate.name}`);

  // clear the deferred ephemeral reply so the modal submit shows nothing
  if (deferred) {
    try { await submitted.editReply({ content: '', ephemeral: true }); } catch {}
  }
} else {
  const reason = startRes2?.reason || 'unknown';
  summary.push(`Stage ${s}: failed to resend (${reason})`);
  if (deferred) {
    try { await submitted.editReply({ content: `Failed to resend stage ${s}: ${reason}`, ephemeral: true }); } catch {}
  }
}
  }

  // Send final summary. If we showed any modal, the original button interaction has already been responded to
  // by showModal, so we must use followUp. Otherwise we can reply directly.
  const finalText = summary.join('\n') || 'No stages resent.';
  try {
    if (modalShown) {
      await btn.followUp({ content: finalText, ephemeral: true });
    } else {
      await btn.reply({ content: finalText, ephemeral: true });
    }
  } catch (e) {
    console.warn('failed to send final summary', e);
  }

  btnCollector.stop();
});
      btnCollector.on('end', () => {});
      return; // we've already edited reply with button
    }

    // If no eligible stages, just send embed as before
    return interaction.editReply({ embeds: [embed] });
  }
};
