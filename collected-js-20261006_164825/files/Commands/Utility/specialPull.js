// Commands/Utility/pull.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');

const User = require('../../models/User');
const PullQuota = require('../../utils/pullQuota'); // helper with getUpdatedQuota, constants
const PullQuotaModel = require('../../models/PullQuota'); // direct model for atomic updates
const SpecialPullGrant = require('../../models/SpecialPullGrant'); // active 24h grants
const { drawPack } = require('../../utils/newWeightedDraw'); // original 8-slot draw

// tolerant import for drawPackSpecial (works with different export styles)
let drawPackSpecial;
try {
  const specialModule = require('../../utils/drawPackSpecial');
  drawPackSpecial = specialModule && (specialModule.drawPackSpecial || specialModule.default || specialModule);
  if (typeof drawPackSpecial !== 'function') {
    console.error('[pull] drawPackSpecial not available; special pulls will fallback to normal drawPack');
    drawPackSpecial = null;
  }
} catch (err) {
  console.error('[pull] failed to require drawPackSpecial', err);
  drawPackSpecial = null;
}

const inFlightInteractions = new Map(); // simple in-process idempotency guard
const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const PAGE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const DEFAULT_GIF_DURATION_MS = 1200;

const gifs = [
  'https://media.discordapp.net/attachments/1046811248647475302/1437428233086963774/ppp.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428255249535096/ag.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428283217149962/hhw.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428356617338891/Roselia.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428386988556438/MyGO.gif',
  'https://cdn.discordapp.com/attachments/802431770023952406/1438516550628937819/Morf.gif',
  'https://cdn.discordapp.com/attachments/986110973574283265/1446127876339400724/ave_mujica.gif',
  'https://cdn.discordapp.com/attachments/986110973574283265/1441054422401683626/Pasupare.gif',
  'https://cdn.discordapp.com/attachments/802431770023952406/1443593296189456486/ras.gif'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find the most recent active special grant (24h) — returns lean doc or null.
 */
async function findMostRecentActiveSpecial() {
  try {
    return await SpecialPullGrant.findOne({ active: true, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
  } catch (err) {
    console.error('[findMostRecentActiveSpecial] error', err);
    return null;
  }
}

/**
 * Ensure the per-user PullQuota.specialPulls[label] key exists.
 * Atomic update that sets the key only if it does not already exist.
 */
async function ensureUserSpecialKey(userId, labelKey, defaultVal) {
  try {
    await PullQuotaModel.updateOne(
      { userId, [`specialPulls.${labelKey}`]: { $exists: false } },
      { $set: { [`specialPulls.${labelKey}`]: defaultVal } }
    ).exec();
    return true;
  } catch (err) {
    console.error('[ensureUserSpecialKey] updateOne failed', { userId, labelKey, err });
    return false;
  }
}

/**
 * Consume pulls using pullQuota as the authoritative source.
 * Supports timed pulls, event pulls (allowEvent), and optional special pulls keyed by grant.label.
 *
 * Returns an object:
 * {
 *   success: boolean,
 *   consumedFromEvent: number,
 *   consumedFromTimed: number,
 *   consumedFromSpecial: number,
 *   doc: PullQuota doc (after mutation) | null,
 *   remainingEvent: number,
 *   remainingTimed: number,
 *   remainingSpecial: number | null,
 *   nextRefillInMs: number | null,
 *   reason: string | null
 * }
 */
async function consumePulls(discordUserId, amount, allowEvent, specialLabel = null) {
  function computeNextRefill(doc) {
    if (!doc) return null;
    const now = Date.now();
    if (doc.lastRefill) {
      const lastRefillTs = new Date(doc.lastRefill).getTime();
      return Math.max(0, PullQuota.REFILL_INTERVAL_MS - (now - lastRefillTs));
    } else {
      return (doc.pulls >= PullQuota.MAX_STOCK) ? 0 : PullQuota.REFILL_INTERVAL_MS;
    }
  }

  // Special path: consume from specialPulls[label] if provided (label here is the map key)
  if (specialLabel) {
    const labelKey = String(specialLabel);

    // Verify an active grant exists for this label
    const grant = await SpecialPullGrant.findOne({ label: labelKey, active: true, expiresAt: { $gt: new Date() } }).lean();
    if (!grant) {
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        consumedFromSpecial: 0,
        doc: null,
        remainingEvent: 0,
        remainingTimed: 0,
        remainingSpecial: 0,
        nextRefillInMs: null,
        reason: 'no_active_special'
      };
    }

    // Ensure PullQuota doc exists and ensure per-user key exists (lazy init)
    const { doc: initialDoc } = await PullQuota.getUpdatedQuota(discordUserId);
    if (!initialDoc) {
      try {
        const init = { userId: discordUserId, pulls: 0, eventPulls: 0, specialPulls: {} };
        init.specialPulls[labelKey] = grant.pullsPerUser;
        await PullQuotaModel.updateOne({ userId: discordUserId }, { $setOnInsert: init }, { upsert: true }).catch(() => null);
      } catch (e) { /* ignore */ }
    }

    // Ensure the per-user key exists (atomic)
    await ensureUserSpecialKey(discordUserId, labelKey, grant.pullsPerUser);

    // Re-fetch authoritative doc
    const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
    if (!doc) {
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        consumedFromSpecial: 0,
        doc: null,
        remainingEvent: 0,
        remainingTimed: 0,
        remainingSpecial: 0,
        nextRefillInMs: null,
        reason: 'no_quota_doc'
      };
    }

    // Read remaining special pulls for this label (support Map or plain object)
    let remainingSpecial = 0;
    try {
      if (doc.specialPulls && typeof doc.specialPulls.get === 'function') {
        remainingSpecial = Number(doc.specialPulls.get(labelKey) || 0);
      } else if (doc.specialPulls && Object.prototype.hasOwnProperty.call(doc.specialPulls, labelKey)) {
        remainingSpecial = Number(doc.specialPulls[labelKey] || 0);
      } else {
        remainingSpecial = 0;
      }
    } catch (e) {
      remainingSpecial = 0;
    }

    if (remainingSpecial <= 0) {
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        consumedFromSpecial: 0,
        doc,
        remainingEvent: doc.eventPulls || 0,
        remainingTimed: doc.pulls || 0,
        remainingSpecial,
        nextRefillInMs: computeNextRefill(doc),
        reason: 'no_special_remaining'
      };
    }

    // Consume requested amount from special pulls (we only support amount=1 in current UI, but keep generic)
    const toConsume = Math.min(amount, remainingSpecial);
    try {
      // Atomic decrement via model
      const incObj = {};
      incObj[`specialPulls.${labelKey}`] = -toConsume;
      await PullQuotaModel.updateOne({ userId: discordUserId }, { $inc: incObj }).exec();
    } catch (e) {
      console.error('[consumePulls] special decrement failed', e);
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        consumedFromSpecial: 0,
        doc,
        remainingEvent: doc.eventPulls || 0,
        remainingTimed: doc.pulls || 0,
        remainingSpecial,
        nextRefillInMs: computeNextRefill(doc),
        reason: 'special_consume_failed'
      };
    }

    // Re-fetch doc to return accurate remaining counts
    const { doc: afterDoc } = await PullQuota.getUpdatedQuota(discordUserId);
    let afterRemainingSpecial = 0;
    if (afterDoc) {
      if (afterDoc.specialPulls && typeof afterDoc.specialPulls.get === 'function') {
        afterRemainingSpecial = Number(afterDoc.specialPulls.get(labelKey) || 0);
      } else if (afterDoc.specialPulls && Object.prototype.hasOwnProperty.call(afterDoc.specialPulls, labelKey)) {
        afterRemainingSpecial = Number(afterDoc.specialPulls[labelKey] || 0);
      } else {
        afterRemainingSpecial = 0;
      }
    }

    return {
      success: true,
      consumedFromEvent: 0,
      consumedFromTimed: 0,
      consumedFromSpecial: toConsume,
      doc: afterDoc || null,
      remainingEvent: afterDoc ? (afterDoc.eventPulls || 0) : 0,
      remainingTimed: afterDoc ? (afterDoc.pulls || 0) : 0,
      remainingSpecial: afterRemainingSpecial,
      nextRefillInMs: computeNextRefill(afterDoc),
      reason: null
    };
  }

  // No specialLabel: fall back to existing logic (allowEvent toggles event pulls)
  if (allowEvent) {
    const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
    if (!doc) {
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        consumedFromSpecial: 0,
        doc: null,
        remainingEvent: 0,
        remainingTimed: 0,
        remainingSpecial: null,
        nextRefillInMs: null
      };
    }

    const needed = amount;
    let consumedFromEvent = 0;
    let consumedFromTimed = 0;

    if (doc.eventPulls >= needed) {
      consumedFromEvent = needed;
      doc.eventPulls -= consumedFromEvent;
    } else if (doc.eventPulls > 0) {
      consumedFromEvent = doc.eventPulls;
      doc.eventPulls = 0;
    }

    const remainingNeeded = needed - consumedFromEvent;
    if (remainingNeeded > 0 && doc.pulls > 0) {
      consumedFromTimed = Math.min(doc.pulls, remainingNeeded);
      const wasFullBefore = doc.pulls >= PullQuota.MAX_STOCK;
      doc.pulls = Math.max(0, doc.pulls - consumedFromTimed);
      if (wasFullBefore && consumedFromTimed > 0) doc.lastRefill = new Date();
    }

    await doc.save();

    const nextIn = computeNextRefill(doc);
    const success = (consumedFromEvent + consumedFromTimed) === needed;
    return {
      success,
      consumedFromEvent,
      consumedFromTimed,
      consumedFromSpecial: 0,
      doc,
      remainingEvent: doc.eventPulls,
      remainingTimed: doc.pulls,
      remainingSpecial: null,
      nextRefillInMs: nextIn
    };
  } else {
    const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
    if (!doc) {
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        consumedFromSpecial: 0,
        doc: null,
        remainingEvent: 0,
        remainingTimed: 0,
        remainingSpecial: null,
        nextRefillInMs: null
      };
    }

    if (doc.pulls > 0) {
      const consumedFromTimed = 1;
      const wasFullBefore = doc.pulls >= PullQuota.MAX_STOCK;
      doc.pulls = Math.max(0, doc.pulls - consumedFromTimed);
      if (wasFullBefore) doc.lastRefill = new Date();
      await doc.save();

      const nextIn = computeNextRefill(doc);
      return {
        success: true,
        consumedFromEvent: 0,
        consumedFromTimed,
        consumedFromSpecial: 0,
        doc,
        remainingEvent: doc.eventPulls,
        remainingTimed: doc.pulls,
        remainingSpecial: null,
        nextRefillInMs: nextIn
      };
    }

    // No pulls available (timed) and not allowing event
    const nextIn = computeNextRefill(doc);
    return {
      success: false,
      consumedFromEvent: 0,
      consumedFromTimed: 0,
      consumedFromSpecial: 0,
      doc,
      remainingEvent: doc.eventPulls,
      remainingTimed: doc.pulls,
      remainingSpecial: null,
      nextRefillInMs: nextIn
    };
  }
}

/* Helpers for escaping and link-safe text */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeLinkText(text) {
  return text.replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Spend a single pull to draw one pack of cards.')
    .addBooleanOption(option =>
      option.setName('event')
        .setDescription('Allow using event pulls if timed pulls are insufficient (true or false).')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('special')
        .setDescription('Use the currently active special pulls (if any). Toggle to use special pulls.')
        .setRequired(false)
    ),
  requireOshi: true,

  async execute(interaction) {
    try { await interaction.deferReply(); } catch (e) { /* ignore */ }

    if (inFlightInteractions.has(interaction.id)) {
      try { await interaction.editReply({ content: 'This interaction is already being processed. Please wait.' }); } catch (e) { /* ignore */ }
      return;
    }
    inFlightInteractions.set(interaction.id, Date.now());

    const gifUrl2 = gifs[Math.floor(Math.random() * gifs.length)];
    const loadingEmbed = new EmbedBuilder().setTitle('*PULLING...*').setColor(0x00BBFF).setImage(gifUrl2);
    let gifShownAt = Date.now();
    try { await interaction.editReply({ embeds: [loadingEmbed] }); gifShownAt = Date.now(); } catch (err) { /* ignore */ }

    const discordUserId = interaction.user.id;
    const amount = 1;
    const allowEvent = Boolean(interaction.options.getBoolean('event'));
    const useSpecial = Boolean(interaction.options.getBoolean('special'));

    // Resolve special grant if requested. We keep two values:
    // - consumeLabelKey: grant.label (map key) used for quota decrement
    // - drawToken: grant.displayLabel (human token) used for file matching
    let consumeLabelKey = null;
    let drawToken = null;
    let resolvedGrant = null;

    if (useSpecial) {
      try {
        const grant = await findMostRecentActiveSpecial();
        if (grant && grant.label) {
          consumeLabelKey = String(grant.label);
          drawToken = String(grant.displayLabel || grant.label);
          resolvedGrant = grant;
          try {
            loadingEmbed.setFooter({ text: `Active special: ${grant.displayLabel || grant.label}` });
            // color loading embed for special pulls
            loadingEmbed.setColor(0x87CEFA);
            await interaction.editReply({ embeds: [loadingEmbed] }).catch(() => null);
          } catch (e) { /* ignore */ }
        } else {
          inFlightInteractions.delete(interaction.id);
          const elapsed = Date.now() - gifShownAt;
          if (elapsed < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsed);
          const embed = new EmbedBuilder()
            .setTitle('No active special pulls')
            .setColor(0xFF5555)
            .setDescription('There is no active special pull event active right now.');
          await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
          return;
        }
      } catch (err) {
        console.error('failed to resolve active special grant:', err);
        inFlightInteractions.delete(interaction.id);
        const elapsed = Date.now() - gifShownAt;
        if (elapsed < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsed);
        await interaction.editReply({ content: 'Failed to check special pulls. Please try again later.', components: [] }).catch(() => null);
        return;
      }
    }

    // AUTHORITATIVE: consume pulls BEFORE drawing pack
    let consumeResult;
    try {
      // For consumption we pass the grant key (map key) if available so quotas decrement correctly
      const consumeLabel = consumeLabelKey || null;
      consumeResult = await consumePulls(discordUserId, amount, allowEvent, consumeLabel);
    } catch (err) {
      console.error('consumePulls error (pre-draw):', err);
      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'Failed to consume pulls. Please try again later.', components: [] }).catch(() => null);
      return;
    }

    if (!consumeResult.success) {
      // Not enough pulls — show the not-enough-pulls embed and exit
      let nextRefillText = 'Refill scheduled';
      if (typeof consumeResult.nextRefillInMs === 'number' && consumeResult.nextRefillInMs > 0) {
        nextRefillText = `<t:${Math.floor((Date.now() + consumeResult.nextRefillInMs) / 1000)}:R>`;
      } else if (consumeResult.nextRefillInMs === 0) {
        nextRefillText = 'Ready';
      }

      // If this was a special attempt, show a light-blue embed and only the special remaining count
      if (consumeLabelKey) {
        const embed = new EmbedBuilder()
          .setTitle('Not enough special pulls available')
          .setColor(0x87CEFA) // light blue
          .addFields(
            { name: 'Special pulls remaining', value: `${consumeResult.remainingSpecial ?? 0}`, inline: true },
            { name: 'Next timed pull', value: nextRefillText, inline: true }
          );

        inFlightInteractions.delete(interaction.id);
        const elapsed = Date.now() - gifShownAt;
        if (elapsed < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsed);
        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
        return;
      }

      // Default (non-special) embed (unchanged)
      const embed = new EmbedBuilder()
        .setTitle('Not enough pulls available')
        .setColor(0xFF5555)
        .addFields(
          { name: 'Timed pulls', value: `${consumeResult.remainingTimed ?? 0}`, inline: true },
          { name: 'Event pulls', value: `${consumeResult.remainingEvent ?? 0}`, inline: true },
          { name: 'Next timed pull', value: nextRefillText, inline: true },
        );

      if (consumeResult.reason === 'no_active_special') {
        embed.addFields({ name: 'Special pulls', value: `No active special available`, inline: false });
      } else if (consumeResult.reason === 'no_special_remaining') {
        embed.addFields({ name: 'Special pulls', value: `No special pulls remaining`, inline: false });
      }

      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsed);
      await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
      return;
    }

    // At this point, pulls have been consumed authoritatively.
    // Draw pack — use drawPackSpecial when drawToken is present, otherwise original drawPack
    let pack;
    try {
      if (drawToken && drawPackSpecial) {
        pack = await drawPackSpecial(discordUserId, drawToken);
      } else {
        pack = await drawPack(discordUserId, null);
      }
      console.debug('[pull] drawPack returned', { drawToken, packLength: Array.isArray(pack) ? pack.length : null });
    } catch (err) {
      console.error('drawPack error after consume:', err);
      // Attempt refund
      try {
        const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
        if (doc) {
          const inc = {};
          if (consumeResult.consumedFromEvent) inc.eventPulls = consumeResult.consumedFromEvent;
          if (consumeResult.consumedFromTimed) inc.pulls = consumeResult.consumedFromTimed;
          if (consumeResult.consumedFromSpecial && resolvedGrant) inc[`specialPulls.${resolvedGrant.label || resolvedGrant.displayLabel}`] = consumeResult.consumedFromSpecial;
          if (Object.keys(inc).length > 0) {
            await PullQuotaModel.updateOne({ userId: discordUserId }, { $inc: inc }).catch(() => null);
            if (!PullQuotaModel) {
              if (consumeResult.consumedFromEvent) doc.eventPulls = (doc.eventPulls || 0) + consumeResult.consumedFromEvent;
              if (consumeResult.consumedFromTimed) doc.pulls = (doc.pulls || 0) + consumeResult.consumedFromTimed;
              if (consumeResult.consumedFromSpecial && resolvedGrant) {
                doc.specialPulls = doc.specialPulls || {};
                doc.specialPulls[resolvedGrant.label || resolvedGrant.displayLabel] = (doc.specialPulls[resolvedGrant.label || resolvedGrant.displayLabel] || 0) + consumeResult.consumedFromSpecial;
              }
              await doc.save().catch(() => null);
            }
          }
        }
      } catch (refundErr) {
        console.error('refund error after draw failure:', refundErr);
      }

      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'An error occurred while drawing the pack. Your pull has been refunded. Please try again.', components: [] }).catch(() => null);
      return;
    }

    // Persist cards and increment user's pulls once (user-facing counter)
    const pageItems = [];
    const allNames = [];
    const now = new Date();

    try {
      // Ensure user document exists (upsert minimal doc)
      await User.updateOne({ id: discordUserId }, { $setOnInsert: { id: discordUserId, pulls: 0, cards: [] } }, { upsert: true });

      for (const item of pack) {
        const { rarity, file } = item;
        const base = path.basename(file);
        const ext = path.extname(base);
        const raw = base.slice(0, base.length - ext.length);
        const displayName = raw.replace(/[_-]+/g, ' ').trim();

        // Build a tolerant regex for matching existing card entries
        const key = displayName.replace(/[_\s\-]+/g, ' ').replace(/\s+/g, ' ').trim();
        const nameRegex = new RegExp(`^${escapeRegex(key)}$`, 'i');

        // Try to increment existing array element using a tolerant match on a normalized key
        const incResult = await User.updateOne(
          {
            id: discordUserId,
            cards: {
              $elemMatch: {
                name: { $regex: nameRegex },
                rarity: rarity
              }
            }
          },
          {
            $inc: { "cards.$.count": 1 },
            $set: { "cards.$.lastAcquiredAt": now }
          }
        );

        let currentCount = 1;
        if (incResult && incResult.matchedCount > 0) {
          const readDoc = await User.findOne(
            {
              id: discordUserId,
              cards: {
                $elemMatch: {
                  name: { $regex: nameRegex },
                  rarity: rarity
                }
              }
            },
            { "cards.$": 1 }
          ).lean();

          if (readDoc && Array.isArray(readDoc.cards) && readDoc.cards[0]) {
            currentCount = readDoc.cards[0].count || 1;
          } else {
            const agg = await User.aggregate([
              { $match: { id: discordUserId } },
              { $unwind: "$cards" },
              { $match: { "cards.rarity": rarity, "cards.name": { $regex: nameRegex } } },
              { $group: { _id: null, totalCount: { $sum: "$cards.count" }, lastAcquiredAt: { $max: "$cards.lastAcquiredAt" } } }
            ]);
            currentCount = (agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
          }
        } else {
          // No matched element existed; attempt a guarded push (only push if no matching element exists now)
          await User.updateOne(
            {
              id: discordUserId,
              $nor: [{
                cards: {
                  $elemMatch: {
                    name: { $regex: nameRegex },
                    rarity: rarity
                  }
                }
              }]
            },
            {
              $push: {
                cards: { name: displayName, rarity, count: 1, firstAcquiredAt: now, lastAcquiredAt: now }
              }
            }
          );

          // Read back authoritative element (handles race where another request pushed first)
          const readDoc = await User.findOne(
            {
              id: discordUserId,
              cards: {
                $elemMatch: {
                  name: { $regex: nameRegex },
                  rarity: rarity
                }
              }
            },
            { "cards.$": 1 }
          ).lean();

          if (readDoc && Array.isArray(readDoc.cards) && readDoc.cards[0]) {
            currentCount = readDoc.cards[0].count || 1;
          } else {
            const agg = await User.aggregate([
              { $match: { id: discordUserId } },
              { $unwind: "$cards" },
              { $match: { "cards.name": { $regex: nameRegex }, "cards.rarity": rarity } },
              { $group: { _id: null, totalCount: { $sum: "$cards.count" }, lastAcquiredAt: { $max: "$cards.lastAcquiredAt" } } }
            ]);
            currentCount = (agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
          }
        }

        const encodedUrl = `${IMAGE_BASE.replace(/\/$/, '')}/${rarity}/${encodeURIComponent(raw)}.png`;
        const visiblePrefix = `[${rarity}] - `;
        const titleBody = `${displayName}`;
        const titleCount = ` - #${currentCount}`;
        const titleLine = `${visiblePrefix}${titleBody}`;

        pageItems.push({ rarity, rawName: raw, displayName, titleLine, imageUrl: encodedUrl });
        allNames.push(`${visiblePrefix}[${escapeLinkText(titleBody)}](${encodedUrl})${titleCount}`);
      }
    } catch (err) {
      console.error('atomic update error after consume:', err);

      // Attempt refund because we consumed earlier but failed to persist cards
      try {
        const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
        if (doc) {
          const inc = {};
          if (consumeResult.consumedFromEvent) inc.eventPulls = consumeResult.consumedFromEvent;
          if (consumeResult.consumedFromTimed) inc.pulls = consumeResult.consumedFromTimed;
          if (consumeResult.consumedFromSpecial && resolvedGrant) inc[`specialPulls.${resolvedGrant.label || resolvedGrant.displayLabel}`] = consumeResult.consumedFromSpecial;
          if (Object.keys(inc).length > 0) {
            await PullQuotaModel.updateOne({ userId: discordUserId }, { $inc: inc }).catch(() => null);
            if (!PullQuotaModel) {
              if (consumeResult.consumedFromEvent) doc.eventPulls = (doc.eventPulls || 0) + consumeResult.consumedFromEvent;
              if (consumeResult.consumedFromTimed) doc.pulls = (doc.pulls || 0) + consumeResult.consumedFromTimed;
              if (consumeResult.consumedFromSpecial && resolvedGrant) {
                doc.specialPulls = doc.specialPulls || {};
                doc.specialPulls[resolvedGrant.label || resolvedGrant.displayLabel] = (doc.specialPulls[resolvedGrant.label || resolvedGrant.displayLabel] || 0) + consumeResult.consumedFromSpecial;
              }
              await doc.save().catch(() => null);
            }
          }
        }
      } catch (refundErr) {
        console.error('refund error after atomic update failure:', refundErr);
      }

      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'An error occurred while saving your pull. Your pull has been refunded. Please try again.', components: [] }).catch(() => null);
      return;
    }

    // Build description and truncate safely
    let descriptionAll = allNames.join('\n');
    const MAX_DESC = 4096;
    if (descriptionAll.length > MAX_DESC) {
      const truncated = descriptionAll.slice(0, MAX_DESC - 80);
      const lastNl = truncated.lastIndexOf('\n');
      const visible = lastNl > 0 ? truncated.slice(0, lastNl) : truncated;
      const visibleCount = visible.split('\n').filter(Boolean).length;
      const totalCount = allNames.length;
      const omitted = totalCount - visibleCount;
      descriptionAll = `${visible}\n...and ${omitted} more`;
    }

    const elapsedSinceGif = Date.now() - gifShownAt;
    if (elapsedSinceGif < DEFAULT_GIF_DURATION_MS) await sleep(DEFAULT_GIF_DURATION_MS - elapsedSinceGif);

    // If any SEC was pulled, show a special reveal GIF before the result embed
    const hasSEC = pageItems.some(it => String(it.rarity ?? '').toUpperCase() === 'SEC');
    if (hasSEC) {
      const specialGifUrl = 'https://media.discordapp.net/attachments/1046811248647475302/1437428522577821828/Ran_chan_drop_kick.gif';
      try {
        const secEmbed = new EmbedBuilder()
          .setTitle('**!?!?!?!?!?!?!?!?!?!?!?!?**')
          .setColor(0xFFD700)
          .setImage(specialGifUrl);

        await interaction.editReply({ embeds: [secEmbed], components: [] }).catch(() => null);
        await sleep(DEFAULT_GIF_DURATION_MS);
      } catch (err) {
        console.warn('failed to show SEC reveal gif:', err);
      }
    }

    // increment user's pulls once (informational user doc counter)
    try {
      await User.updateOne({ id: discordUserId }, { $inc: { pulls: 1 } });
    } catch (e) {
      console.warn('failed to increment user pulls counter (informational):', e);
    }

    // Build embed maker
    function makeEmbed(idx) {
      const it = pageItems[idx];

      // If this pull used a special draw token, show light-blue embed and only special remaining
      if (drawToken) {
        return new EmbedBuilder()
          .setTitle(`Card: ${idx + 1} **[${it.rarity}]** - ${it.displayName}`)
          .setDescription(descriptionAll)
          .setColor(0x87CEFA) // light blue for special pulls
          .addFields(
            { name: 'Special pulls remaining', value: `${consumeResult.remainingSpecial ?? 0}`, inline: true }
          )
          .setImage(it.imageUrl)
          .setURL(it.imageUrl)
          .setFooter({ text: `Card: ${idx + 1} / ${pageItems.length} | Pull by: ${interaction.user.username}` });
      }

      // Default (non-special) embed
      return new EmbedBuilder()
        .setTitle(`Card: ${idx + 1} **[${it.rarity}]** - ${it.displayName}`)
        .setDescription(descriptionAll)
        .setColor(0x00BB88)
        .addFields(
          { name: 'Timed pulls remaining', value: `${consumeResult.remainingTimed}`, inline: true },
          { name: 'Event pulls remaining', value: `${consumeResult.remainingEvent}`, inline: true },
        )
        .setImage(it.imageUrl)
        .setURL(it.imageUrl)
        .setFooter({ text: `Card: ${idx + 1} / ${pageItems.length} | Pull by: ${interaction.user.username}` });
    }

    // Buttons: create fresh instances for enabled/disabled rows
    const prevBtnEnabled = new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(pageItems.length <= 1);
    const nextBtnEnabled = new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(pageItems.length <= 1);
    const row = new ActionRowBuilder().addComponents(prevBtnEnabled, nextBtnEnabled);

    const prevBtnDisabled = new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(true);
    const nextBtnDisabled = new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(true);
    const disableRow = new ActionRowBuilder().addComponents(prevBtnDisabled, nextBtnDisabled);

    const message = await interaction.editReply({ embeds: [makeEmbed(0)], components: [row] }).catch(() => null);

    if (!message) {
      inFlightInteractions.delete(interaction.id);
      return;
    }

    if (pageItems.length <= 1) {
      setTimeout(async () => {
        try { await message.edit({ components: [disableRow] }); } catch (e) { /* ignore */ }
      }, Math.min(PAGE_TIMEOUT_MS, 10_000));
      inFlightInteractions.delete(interaction.id);
      return;
    }

    const collector = message.createMessageComponentCollector({ filter: (i) => i.user.id === discordUserId, time: PAGE_TIMEOUT_MS });
    let pageIndex = 0;

    collector.on('collect', async (btnInt) => {
      try {
        if (btnInt.customId === 'prev') pageIndex = (pageIndex - 1 + pageItems.length) % pageItems.length;
        else if (btnInt.customId === 'next') pageIndex = (pageIndex + 1) % pageItems.length;
        else return await btnInt.reply({ content: 'Unknown action', ephemeral: true });

        await btnInt.update({ embeds: [makeEmbed(pageIndex)], components: [row] });
      } catch (err) {
        console.error('collector interaction error:', err);
      }
    });

    collector.on('end', async () => {
      try { await message.edit({ components: [disableRow] }); } catch (e) { /* ignore */ }
      inFlightInteractions.delete(interaction.id);
    });
  },
};
