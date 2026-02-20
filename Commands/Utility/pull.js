// Commands/Utility/pull.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const User = require('../../models/User');

// === Quota + models (special-aware) ===
const PullQuota = require('../../utils/pullQuota'); // helper with getUpdatedQuota, constants
const PullQuotaModel = require('../../models/PullQuota'); // direct model for atomic updates
const SpecialPullGrant = require('../../models/SpecialPullGrant'); // active 24h grants
const PullLock = require('../../models/PullLock'); // per-user advisory lock (Mongo-backed)

// === Draw functions ===
const { drawPack } = require('../../utils/newWeightedDraw'); // normal draw
const { drawPackBoss } = require('../../utils/drawPackBoss'); // boss-channel biased draw
const { getBossChannelDrawToken } = require('../../utils/bossPullBias');

// Tolerant import for special draw
let drawPackSpecial;
try {
  const specialModule = require('../../utils/drawPackSpecial');
  drawPackSpecial =
    (specialModule && (specialModule.drawPackSpecial || specialModule.default || specialModule));
  if (typeof drawPackSpecial !== 'function') {
    console.error('[pull] drawPackSpecial not available; special pulls will fallback to normal drawPack');
    drawPackSpecial = null;
  }
} catch (err) {
  console.error('[pull] failed to require drawPackSpecial', err);
  drawPackSpecial = null;
}

// Users who are exempt from "pullsSinceLastSEC" pity tracking
const PITY_EXEMPT_IDS = new Set([
  '234567890123456789',
  // add more...
]);

// In-process guard still useful for same-interaction re-entry,
// but it doesn't stop two different interactions from the same user.
const inFlightInteractions = new Map();

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const PAGE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const DEFAULT_GIF_DURATION_MS = 1200;  // base animation delay for first/solo pulls

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

// --- Mongo-backed per-user advisory lock + queue ---
async function acquirePullLock(userId, owner, ttlMs = 8000) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  try {
    const res = await PullLock.updateOne(
      // Acquire if: no lock, or expired, or we already own it (re-entrant).
      { userId, $or: [{ until: { $lt: now } }, { owner }] },
      { $set: { userId, owner, until } },
      { upsert: true }
    ).exec();
    return Boolean(res.matchedCount > 0 || res.upsertedCount > 0);
  } catch {
    return false; // someone else is holding it right now
  }
}

async function releasePullLock(userId, owner) {
  try { await PullLock.deleteOne({ userId, owner }).exec(); } catch {}
}

// Waits for lock without ever showing a rejection to the user (queue behavior).
async function waitForPullLock(userId, owner, timeoutMs = 20000, retryMs = 50) {
  const start = Date.now();
  while (true) {
    const ok = await acquirePullLock(userId, owner, 8000);
    if (ok) return true;
    if (Date.now() - start > timeoutMs) return false;
    await sleep(retryMs);
  }
}

// === Special + quota helpers ===
async function findMostRecentActiveSpecial() {
  try {
    return await SpecialPullGrant
      .findOne({ active: true, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .lean();
  } catch (err) {
    console.error('[findMostRecentActiveSpecial] error', err);
    return null;
  }
}

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
 * Authoritative pulls consumption.
 * (Special path already uses atomic $inc. We'll harden timed-only to use $inc too.)
 */
async function consumePulls(discordUserId, amount, allowEvent, specialLabel = null) {
  function computeNextRefill(doc) {
    if (!doc) return null;
    const now = Date.now();
    if (doc.lastRefill) {
      const last = new Date(doc.lastRefill).getTime();
      return Math.max(0, PullQuota.REFILL_INTERVAL_MS - (now - last));
    }
    return (doc.pulls >= PullQuota.MAX_STOCK) ? 0 : PullQuota.REFILL_INTERVAL_MS;
  }

  // --- Special path (kept as-is; already atomic) ---
  if (specialLabel) {
    const labelKey = String(specialLabel);
    const grant = await SpecialPullGrant
      .findOne({ label: labelKey, active: true, expiresAt: { $gt: new Date() } })
      .lean();
    if (!grant) {
      return {
        success: false,
        consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: 0,
        doc: null, remainingEvent: 0, remainingTimed: 0, remainingSpecial: 0,
        nextRefillInMs: null, reason: 'no_active_special'
      };
    }

    const { doc: initialDoc } = await PullQuota.getUpdatedQuota(discordUserId);
    if (!initialDoc) {
      try {
        const init = { userId: discordUserId, pulls: 0, eventPulls: 0, specialPulls: {} };
        init.specialPulls[labelKey] = grant.pullsPerUser;
        await PullQuotaModel.updateOne(
          { userId: discordUserId },
          { $setOnInsert: init },
          { upsert: true }
        ).catch(() => null);
      } catch {}
    }
    await ensureUserSpecialKey(discordUserId, labelKey, grant.pullsPerUser);

    const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
    if (!doc) {
      return {
        success: false,
        consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: 0,
        doc: null, remainingEvent: 0, remainingTimed: 0, remainingSpecial: 0,
        nextRefillInMs: null, reason: 'no_quota_doc'
      };
    }

    let remainingSpecial = 0;
    try {
      if (doc.specialPulls && typeof doc.specialPulls.get === 'function') {
        remainingSpecial = Number(doc.specialPulls.get(labelKey) ?? 0);
      } else if (doc.specialPulls && Object.prototype.hasOwnProperty.call(doc.specialPulls, labelKey)) {
        remainingSpecial = Number(doc.specialPulls[labelKey] ?? 0);
      }
    } catch { remainingSpecial = 0; }

    if (remainingSpecial <= 0) {
      return {
        success: false,
        consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: 0,
        doc, remainingEvent: doc.eventPulls ?? 0, remainingTimed: doc.pulls ?? 0, remainingSpecial,
        nextRefillInMs: computeNextRefill(doc), reason: 'no_special_remaining'
      };
    }

    const toConsume = Math.min(amount, remainingSpecial);
    try {
      const incObj = {};
      incObj[`specialPulls.${labelKey}`] = -toConsume;
      await PullQuotaModel.updateOne({ userId: discordUserId }, { $inc: incObj }).exec();
    } catch (e) {
      console.error('[consumePulls] special decrement failed', e);
      return {
        success: false,
        consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: 0,
        doc, remainingEvent: doc.eventPulls ?? 0, remainingTimed: doc.pulls ?? 0, remainingSpecial,
        nextRefillInMs: computeNextRefill(doc), reason: 'special_consume_failed'
      };
    }

    const { doc: afterDoc } = await PullQuota.getUpdatedQuota(discordUserId);
    let afterRemainingSpecial = 0;
    if (afterDoc) {
      if (afterDoc.specialPulls && typeof afterDoc.specialPulls.get === 'function') {
        afterRemainingSpecial = Number(afterDoc.specialPulls.get(labelKey) ?? 0);
      } else if (afterDoc.specialPulls && Object.prototype.hasOwnProperty.call(afterDoc.specialPulls, labelKey)) {
        afterRemainingSpecial = Number(afterDoc.specialPulls[labelKey] ?? 0);
      }
    }
    return {
      success: true,
      consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: toConsume,
      doc: afterDoc ?? null,
      remainingEvent: afterDoc ? (afterDoc.eventPulls ?? 0) : 0,
      remainingTimed: afterDoc ? (afterDoc.pulls ?? 0) : 0,
      remainingSpecial: afterRemainingSpecial,
      nextRefillInMs: computeNextRefill(afterDoc),
      reason: null
    };
  }

  // --- Non-special path (original logic + atomic $inc for timed-only) ---
  const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
  if (!doc) {
    return {
      success: false,
      consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: 0,
      doc: null, remainingEvent: 0, remainingTimed: 0, remainingSpecial: null, nextRefillInMs: null
    };
  }

  if (allowEvent) {
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
  }

  // Timed-only path: atomic decrement
  const dec = await PullQuotaModel.updateOne(
    { userId: discordUserId, pulls: { $gte: 1 } },
    [
  {
    $set: {
      lastRefill: {
        $cond: [
          { $eq: ["$pulls", PullQuota.MAX_STOCK] },
          new Date(),
          "$lastRefill"
        ]
      }
    }
  },
  {
    $set: {
      pulls: { $subtract: ["$pulls", 1] }
    }
  }
]
  ).exec();

  if (dec && dec.modifiedCount === 1) {
    const { doc: afterDoc } = await PullQuota.getUpdatedQuota(discordUserId);
    const nextIn = computeNextRefill(afterDoc);
    return {
      success: true,
      consumedFromEvent: 0, consumedFromTimed: 1, consumedFromSpecial: 0,
      doc: afterDoc ?? null,
      remainingEvent: afterDoc ? (afterDoc.eventPulls ?? 0) : 0,
      remainingTimed: afterDoc ? (afterDoc.pulls ?? 0) : 0,
      remainingSpecial: null,
      nextRefillInMs: nextIn
    };
  }

  const nextIn = computeNextRefill(doc);
  return {
    success: false,
    consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: 0,
    doc, remainingEvent: doc.eventPulls, remainingTimed: doc.pulls,
    remainingSpecial: null, nextRefillInMs: nextIn
  };
}

// --- Helpers for escaping/link-safe text ---
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeLinkText(text) {
  return text.replace(/([_\*\[\]\(\)\~\`\>\#\-\=\{\}\.\!\\])/g, '\\$1');
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
        .setDescription('Use the currently active special pulls (if any).')
        .setRequired(false)
    ),
  requireOshi: true,
  async execute(interaction) {
    // Defer immediately so Discord doesn’t time us out while we queue.
    try { await interaction.deferReply(); } catch {}

    // Show loading GIF right away (users see something even if they spam).
    const gifUrl = gifs[Math.floor(Math.random() * gifs.length)];
    const loadingEmbed = new EmbedBuilder().setTitle('*PULLING...*').setColor(0x00BBFF).setImage(gifUrl);
    let gifShownAt = Date.now();
    try { await interaction.editReply({ embeds: [loadingEmbed] }); gifShownAt = Date.now(); } catch {}

    // Guard against duplicate processing of the same interaction id.
    if (inFlightInteractions.has(interaction.id)) {
      try { await interaction.editReply({ content: 'This interaction is already being processed. Please wait.' }); } catch {}
      return;
    }
    inFlightInteractions.set(interaction.id, Date.now());

    const discordUserId = interaction.user.id;
    const lockOwner = interaction.id;
    const pityExempt = PITY_EXEMPT_IDS.has(discordUserId);
    // Try to get the lock immediately; if not, wait (queue) without showing any "please wait" error.
    let acquiredFast = await acquirePullLock(discordUserId, lockOwner, 8000);
    let queued = false;
    if (!acquiredFast) {
      queued = true; // this pull is queued behind another from the same user
      acquiredFast = await waitForPullLock(discordUserId, lockOwner, /*timeoutMs*/ 20000, /*retryMs*/ 50);
      if (!acquiredFast) {
        // Extremely rare: still couldn't get the lock after 20s.
        // Show a graceful error and exit without consuming a pull.
        const ANIM_MS = queued ? 0 : DEFAULT_GIF_DURATION_MS;
        const elapsed = Date.now() - gifShownAt;
        if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
        try {
          await interaction.editReply({
            content: 'Server is busy handling your previous pulls. Please try again in a moment.',
            components: []
          });
        } catch {}
        inFlightInteractions.delete(interaction.id);
        return;
      }
    }

    // From here, we own the lock. Always release it at the end.
    let lockReleased = false;
    const release = async () => {
      if (!lockReleased) { lockReleased = true; await releasePullLock(discordUserId, lockOwner); }
    };

    // If this was queued, skip the GIF delays to speed up results.
    const ANIM_MS = queued ? 0 : DEFAULT_GIF_DURATION_MS;

    try {
      const amount = 1;
      const allowEvent = Boolean(interaction.options.getBoolean('event'));
      const useSpecial = Boolean(interaction.options.getBoolean('special'));

      // --- Resolve active special grant (if requested) ---
      let consumeLabelKey = null; // quota key (grant.label)
      let specialDrawToken = null; // draw token (grant.displayLabel || label)
      let resolvedGrant = null;

      if (useSpecial) {
        try {
          const grant = await findMostRecentActiveSpecial();
          if (!grant || !grant.label) {
            inFlightInteractions.delete(interaction.id);
            const elapsed = Date.now() - gifShownAt;
            if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
            const embed = new EmbedBuilder()
              .setTitle('No active special pulls')
              .setColor(0xFF5555)
              .setDescription('There is no active special pull event right now.');
            await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
            await release();
            return;
          }
          consumeLabelKey = String(grant.label);
          specialDrawToken = String(grant.displayLabel ?? grant.label);
          resolvedGrant = grant;

          try {
            loadingEmbed.setFooter({ text: `Active special: ${grant.displayLabel ?? grant.label}` });
            loadingEmbed.setColor(0x87CEFA);
            await interaction.editReply({ embeds: [loadingEmbed] }).catch(() => null);
          } catch {}
        } catch (err) {
          console.error('failed to resolve active special grant:', err);
          inFlightInteractions.delete(interaction.id);
          const elapsed = Date.now() - gifShownAt;
          if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
          await interaction.editReply({ content: 'Failed to check special pulls. Please try again later.', components: [] }).catch(() => null);
          await release();
          return;
        }
      }

      // --- Boss-channel detection (non-fatal) ---
      let bossChannelBias = null;
      try {
        bossChannelBias = await getBossChannelDrawToken(interaction);
        if (bossChannelBias && bossChannelBias.biased && bossChannelBias.drawToken) {
          // If this is a special attempt in a boss channel, block it per requirement
          if (useSpecial) {
            inFlightInteractions.delete(interaction.id);
            const elapsed = Date.now() - gifShownAt;
            if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
            const embed = new EmbedBuilder()
              .setTitle('Special pulls are not allowed here')
              .setColor(0xFF5555)
              .setDescription('Special pulls are not allowed in this channel.');
            await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
            await release();
            return;
          }
          // Cosmetic hint on loading embed when boss bias applies
          try {
            loadingEmbed.setFooter({ text: `The algorithm has found: ${bossChannelBias.drawToken}!` });
            loadingEmbed.setColor(0xFFD700);
            await interaction.editReply({ embeds: [loadingEmbed] }).catch(() => null);
          } catch {}
        }
      } catch (e) {
        console.warn('[pull] boss-channel bias check failed', e);
        bossChannelBias = { drawToken: null, biased: false };
      }

      // --- Authoritative: consume pulls BEFORE drawing ---
      let consumeResult;
      try {
        const consumeLabel = consumeLabelKey ?? null;
        consumeResult = await consumePulls(discordUserId, amount, allowEvent, consumeLabel);
      } catch (err) {
        console.error('consumePulls error (pre-draw):', err);
        inFlightInteractions.delete(interaction.id);
        const elapsed = Date.now() - gifShownAt;
        if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
        await interaction.editReply({ content: 'Failed to consume pulls. Please try again later.', components: [] }).catch(() => null);
        await release();
        return;
      }

      if (!consumeResult.success) {
        let nextRefillText = 'Refill scheduled';
        if (typeof consumeResult.nextRefillInMs === 'number' && consumeResult.nextRefillInMs > 0) {
          nextRefillText = `<t:${Math.floor((Date.now() + consumeResult.nextRefillInMs) / 1000)}:R>`;
        } else if (consumeResult.nextRefillInMs === 0) {
          nextRefillText = 'Ready';
        }

        if (consumeLabelKey) {
          const embed = new EmbedBuilder()
            .setTitle('Not enough special pulls available')
            .setColor(0x87CEFA)
            .addFields(
              { name: 'Special pulls remaining', value: `${consumeResult.remainingSpecial ?? 0}`, inline: true },
              { name: 'Next timed pull', value: nextRefillText, inline: true }
            );
          inFlightInteractions.delete(interaction.id);
          const elapsed = Date.now() - gifShownAt;
          if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
          await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
          await release();
          return;
        }

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
        if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
        await release();
        return;
      }
      // Ensure user exists before reading pity
await User.updateOne(
  { id: discordUserId },
  { $setOnInsert: { id: discordUserId, cards: [], points: 0, pullsSinceLastSEC: 0 } },
  { upsert: true }
);

// --- SEC pity counter (read before draw) ---
let pullsSinceLastSEC = 0;
let forceSEC = false;

if (!pityExempt) {
  try {
    const u = await User.findOne({ id: discordUserId }, { pullsSinceLastSEC: 1 }).lean();
    pullsSinceLastSEC = Number(u?.pullsSinceLastSEC ?? 0);
    forceSEC = pullsSinceLastSEC >= 1999; // next pull is the 2000th -> guarantee SEC
  } catch (e) {
    console.error('[pity] failed to read pullsSinceLastSEC:', e);
    pullsSinceLastSEC = 0;
    forceSEC = false;
  }
} else {
  // Exempt users: no pity tracking and no force
  pullsSinceLastSEC = 0;
  forceSEC = false;
}


      // --- Draw pack ---
      let pack;
      try {
        if (!useSpecial && bossChannelBias && bossChannelBias.biased && bossChannelBias.drawToken) {
          pack = await drawPackBoss(discordUserId, bossChannelBias.drawToken, { forceSEC });
        } else if (useSpecial && drawPackSpecial && specialDrawToken) {
          pack = await drawPackSpecial(discordUserId, specialDrawToken, { forceSEC });
        } else {
          pack = await drawPack(discordUserId, null, { forceSEC });
        }
      } catch (err) {
        console.error('drawPack error after consume:', err);
        // Refund on failure
        try {
          const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
          if (doc) {
            const inc = {};
            if (consumeResult.consumedFromEvent) inc.eventPulls = consumeResult.consumedFromEvent;
            if (consumeResult.consumedFromTimed) inc.pulls = consumeResult.consumedFromTimed;
            if (consumeResult.consumedFromSpecial && resolvedGrant) {
              inc[`specialPulls.${resolvedGrant.label ?? resolvedGrant.displayLabel}`] = consumeResult.consumedFromSpecial;
            }
            if (Object.keys(inc).length > 0) {
              await PullQuotaModel.updateOne({ userId: discordUserId }, { $inc: inc }).catch(() => null);
              if (!PullQuotaModel) {
                if (consumeResult.consumedFromEvent) doc.eventPulls = (doc.eventPulls ?? 0) + consumeResult.consumedFromEvent;
                if (consumeResult.consumedFromTimed) doc.pulls = (doc.pulls ?? 0) + consumeResult.consumedFromTimed;
                if (consumeResult.consumedFromSpecial && resolvedGrant) {
                  doc.specialPulls = doc.specialPulls ?? {};
                  doc.specialPulls[resolvedGrant.label ?? resolvedGrant.displayLabel] =
                    (doc.specialPulls[resolvedGrant.label ?? resolvedGrant.displayLabel] ?? 0) + consumeResult.consumedFromSpecial;
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
        if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
        await interaction.editReply({ content: 'An error occurred while drawing the pack. Your pull has been refunded. Please try again.', components: [] }).catch(() => null);
        await release();
        return;
      }

      // --- Persist cards + build page items ---
      const pageItems = [];
      const allNames = [];
      const now = new Date();

      try {
        await User.updateOne({ id: discordUserId }, { $setOnInsert: { id: discordUserId, pulls: 0, cards: [] } }, { upsert: true });
        for (const item of pack) {
          const { rarity, file } = item;
          const base = path.basename(file);
          const ext = path.extname(base);
          const raw = base.slice(0, base.length - ext.length);
          const displayName = raw.replace(/[_-\s]+/g, ' ').trim();
          const key = displayName.replace(/[_\s\-]+/g, ' ').replace(/\s+/g, ' ').trim();
          const nameRegex = new RegExp(`^${escapeRegex(key)}$`, 'i');

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
                cards: { $elemMatch: { name: { $regex: nameRegex }, rarity: rarity } }
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
              currentCount = (agg && agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
            }
          } else {
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

            const readDoc = await User.findOne(
              {
                id: discordUserId,
                cards: { $elemMatch: { name: { $regex: nameRegex }, rarity: rarity } }
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
              currentCount = (agg && agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
            }
          }

          const encodedUrl = `${IMAGE_BASE.replace(/\/$/, '')}/${rarity}/${encodeURIComponent(raw)}.png`;
          const visiblePrefix = `[${rarity}] - `;
          const titleBody = `${displayName}`;
          const titleCount = ` - #${currentCount}`;
          const titleLine = `${visiblePrefix}${titleBody}`;
          pageItems.push({ rarity, rawName: raw, displayName, titleLine, imageUrl: encodedUrl });

          // Keep your description assembly (escaped links) if desired:
          allNames.push(`${visiblePrefix}[${escapeLinkText(titleBody)}](${encodedUrl})${titleCount}`);
        }
      } catch (err) {
        console.error('atomic update error after consume:', err);
        // refund because we consumed earlier but failed to persist cards
        try {
          const { doc } = await PullQuota.getUpdatedQuota(discordUserId);
          if (doc) {
            const inc = {};
            if (consumeResult.consumedFromEvent) inc.eventPulls = consumeResult.consumedFromEvent;
            if (consumeResult.consumedFromTimed) inc.pulls = consumeResult.consumedFromTimed;
            if (consumeResult.consumedFromSpecial && resolvedGrant) {
              inc[`specialPulls.${resolvedGrant.label ?? resolvedGrant.displayLabel}`] = consumeResult.consumedFromSpecial;
            }
            if (Object.keys(inc).length > 0) {
              await PullQuotaModel.updateOne({ userId: discordUserId }, { $inc: inc }).catch(() => null);
              if (!PullQuotaModel) {
                if (consumeResult.consumedFromEvent) doc.eventPulls = (doc.eventPulls ?? 0) + consumeResult.consumedFromEvent;
                if (consumeResult.consumedFromTimed) doc.pulls = (doc.pulls ?? 0) + consumeResult.consumedFromTimed;
                if (consumeResult.consumedFromSpecial && resolvedGrant) {
                  doc.specialPulls = doc.specialPulls ?? {};
                  doc.specialPulls[resolvedGrant.label ?? resolvedGrant.displayLabel] =
                    (doc.specialPulls[resolvedGrant.label ?? resolvedGrant.displayLabel] ?? 0) + consumeResult.consumedFromSpecial;
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
        if (elapsed < ANIM_MS) await sleep(ANIM_MS - elapsed);
        await interaction.editReply({ content: 'An error occurred while saving your pull. Your pull has been refunded. Please try again.', components: [] }).catch(() => null);
        await release();
        return;
      }

      // --- Build description and show results ---
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
      if (elapsedSinceGif < ANIM_MS) await sleep(ANIM_MS - elapsedSinceGif);

      // SEC reveal (also respects queued fast mode)
      const hasSEC = pageItems.some(it => String(it.rarity ?? '').toUpperCase() === 'SEC');
      if (hasSEC) {
        const specialGifUrl = 'https://media.discordapp.net/attachments/1046811248647475302/1437428522577821828/Ran_chan_drop_kick.gif';
        try {
          const secEmbed = new EmbedBuilder().setTitle('**!?!?!?!?!?!?!?!?!?!?!?!?**').setColor(0xFFD700).setImage(specialGifUrl);
          await interaction.editReply({ embeds: [secEmbed], components: [] }).catch(() => null);
          if (ANIM_MS > 0) await sleep(ANIM_MS);
        } catch (err) {
          console.warn('failed to show SEC reveal gif:', err);
        }
      }

      // increment user's pulls once (informational)
// --- Update pull stats + pity counter ---
let nextSinceSEC = 0;

if (!pityExempt) {
  // Fail-safe: only reset on actual SEC.
  // If forceSEC was expected but no SEC occurred, keep at 1999 so next pull forces again.
  nextSinceSEC = hasSEC ? 0 : (forceSEC ? 1999 : pullsSinceLastSEC + 1);
}

try {
  const update = {
    $setOnInsert: { id: discordUserId, cards: [], points: 0 },
    $inc: { pulls: 1 },
  };

  if (!pityExempt) {
    update.$set = { pullsSinceLastSEC: nextSinceSEC };
  }

  await User.updateOne({ id: discordUserId }, update, { upsert: true });
} catch (e) {
  console.error('[pull] Failed to update pulls/pity:', e);
}

      function makeEmbed(idx) {
        const it = pageItems[idx];
        if (useSpecial) {
          return new EmbedBuilder()
            .setTitle(`Card: ${idx + 1} **[${it.rarity}]** - ${it.displayName}`)
            .setDescription(descriptionAll)
            .setColor(0x87CEFA)
            .addFields({ name: 'Special pulls remaining', value: `${consumeResult.remainingSpecial ?? 0}`, inline: true })
            .setImage(it.imageUrl)
            .setURL(it.imageUrl)
            .setFooter({ text: `Card: ${idx + 1} / ${pageItems.length} \nPull by: ${interaction.user.username}` });
        }
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
          .setFooter({ text: `Card: ${idx + 1} / ${pageItems.length} \nPull by: ${interaction.user.username}` });
      }

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
          try { await message.edit({ components: [disableRow] }); } catch {}
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
        try { await message.edit({ components: [disableRow] }); } catch {}
        inFlightInteractions.delete(interaction.id);
        // Lock will be released in finally below.
      });

    } catch (outerErr) {
      console.error('unhandled error in /pull:', outerErr);
      try { await releasePullLock(interaction.user.id, interaction.id); } catch {}
      throw outerErr;
    } finally {
      await release();
    }
  },
};