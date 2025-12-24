const cron = require('node-cron');
const Oshi = require('../models/Oshi');
const PullQuota = require('../models/PullQuota');
const User = require('../models/User');
const oshis = require('../config/oshis'); // array with id,label,bdayMonth,bdayDay
const { getJstInfo } = require('../utils/birthdayGrant'); // reuse helper
const DailyEvent = require('../models/DailyEvent');
const { pickBdayFile } = require('../utils/loadBdayImages');
const { jstDateString } = require('../utils/jst');

const EVENT_PULLS_AMOUNT = 12;

// Find today's oshi ids in JST
function todaysOshiIds() {
  const { month, day } = getJstInfo();
  return oshis.filter(o => o.bdayMonth === month && o.bdayDay === day).map(o => o.id);
}

// Announce helper: try to send to configured channel via client
async function announceBirthday(client, birthdayChannelId, oshiId, grantsCount) {
  if (!client || !birthdayChannelId) return;
  try {
    const o = oshis.find(x => x.id === oshiId);
    if (!o) return;

    const ch = await client.channels.fetch(birthdayChannelId).catch(() => null);
    if (!ch || !ch.isTextBased?.()) return;

    const embed = {
      title: `🎉 Happy Birthday ${o.label}! 🎉`,
      description: `Everyone who has **${o.label}** as their oshi receives **${EVENT_PULLS_AMOUNT} event pulls** as well as **${o.label}\'s** bday card today!`,
      color: 0xffcc00,
      timestamp: new Date().toISOString(),
      footer: { text: 'Birthday event' },
    };

    if (o.image) {
      embed.image = { url: o.image };
    } else {
      embed.image = { url: 'https://media.discordapp.net/attachments/432383725515309056/864530510276198400/kasumifinal.gif' };
    }

    await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error('[birthdayHandout] announce error', err);
  }
}

async function addBdayCardToUser(userId, oshiLabel) {
  try {
    const file = pickBdayFile(oshiLabel);
    if (!file) return null;

    const base = file.split('/').pop();
    const ext = base.includes('.') ? base.substring(base.lastIndexOf('.')) : '';
    const raw = ext ? base.slice(0, base.length - ext.length) : base;
    const displayName = raw.replace(/[_-]+/g, ' ').trim();

    // Ensure user doc exists
    let userDoc = await User.findOne({ id: userId }).exec();
    if (!userDoc) userDoc = await User.create({ id: userId, cards: [] });

    let card = (userDoc.cards || []).find(c => c.name === displayName && c.rarity === 'BDAY');
    if (!card) {
      card = { name: displayName, rarity: 'BDAY', count: 1, timestamps: [new Date()] };
      userDoc.cards = userDoc.cards || [];
      userDoc.cards.push(card);
    } else {
      card.count = (card.count || 0) + 1;
      card.timestamps = card.timestamps || [];
      card.timestamps.push(new Date());
    }

    await userDoc.save();
    return { file, displayName };
  } catch (err) {
    console.error('[addBdayCardToUser] error', err);
    return null;
  }
}

async function grantBirthdayPulls({ client = null, birthdayChannelId = null } = {}) {
  try {
    const ids = todaysOshiIds();
    if (!ids.length) {
      console.log('[birthdayHandout] no oshis have birthday today (JST).');
      return;
    }

    const jst = getJstInfo();
    const dateKey = `${jst.year}-${String(jst.month).padStart(2, '0')}-${String(jst.day).padStart(2, '0')}`;

    for (const oshiId of ids) {
      const docKey = `${dateKey}:${oshiId}`;

      // Try to create DailyEvent doc. If duplicate-key occurs, another process already handled this oshi/date.
      let claimed = false;
      try {
        await DailyEvent.create({
          key: docKey,
          date: dateKey,
          oshiId,
          grantedAt: new Date(),
          grantsCount: 0,
        });
        claimed = true;
      } catch (err) {
        if (err && err.code === 11000) {
          console.log(`[birthdayHandout] ${oshiId} already processed for ${dateKey}, skipping.`);
          continue;
        }
        console.error('[birthdayHandout] failed to claim DailyEvent for', docKey, err);
        continue;
      }

      if (!claimed) continue;

      const oshiDoc = oshis.find(o => o.id === oshiId);
      if (!oshiDoc) {
        console.warn('[birthdayHandout] config missing oshi for id', oshiId);
        await DailyEvent.updateOne({ key: docKey }, { $set: { grantsCount: 0, grantedAt: new Date() } }).catch(() => {});
        continue;
      }

      const users = await Oshi.find({ oshiId }).lean();
      if (!users || users.length === 0) {
        console.log(`[birthdayHandout] no users chosen ${oshiId} today.`);
        await DailyEvent.updateOne({ key: docKey }, { $set: { grantsCount: 0, grantedAt: new Date() } }).catch(() => {});
        continue;
      }

      let grants = 0;
      for (const u of users) {
        const userId = u.userId;
        try {
          let pq = await PullQuota.findOne({ userId });

          const already = pq && pq.lastBirthdayGivenAt && (getJstInfo(new Date(pq.lastBirthdayGivenAt)).year === jst.year);
          if (already) continue;

          const now = new Date();
          if (!pq) {
            await PullQuota.create({
              userId,
              pulls: 6,
              lastRefill: now,
              eventPulls: EVENT_PULLS_AMOUNT,
              lastBirthdayGivenAt: now,
            });
          } else {
            pq.eventPulls = (pq.eventPulls || 0) + EVENT_PULLS_AMOUNT;
            pq.lastBirthdayGivenAt = now;
            await pq.save();
          }

          // Give birthday card (best-effort). Ignore if missing.
          const bdayCard = await addBdayCardToUser(userId, oshiDoc.label);
          if (!bdayCard) {
            console.warn(`[birthdayHandout] no bday file found for ${oshiDoc.label} when granting to ${userId}`);
          }

          grants++;
          console.log(`[birthdayHandout] granted ${EVENT_PULLS_AMOUNT} to ${userId} for ${oshiId} (bday card ${bdayCard ? 'added' : 'missing'})`);
        } catch (userErr) {
          console.error('[birthdayHandout] error granting to user', userId, userErr);
        }
      }

      // Update DailyEvent grantsCount
      try {
        await DailyEvent.updateOne({ key: docKey }, { $set: { grantsCount: grants, grantedAt: new Date() } });
      } catch (updateErr) {
        console.error('[birthdayHandout] failed to update DailyEvent grantsCount for', docKey, updateErr);
      }

      if (grants > 0) {
        try {
          await announceBirthday(client, birthdayChannelId, oshiId, grants);
        } catch (announceErr) {
          console.error('[birthdayHandout] announce error for', oshiId, announceErr);
        }
      } else {
        console.log(`[birthdayHandout] no new grants applied for ${oshiId} on ${dateKey}; skipping announce.`);
      }
    }

  } catch (err) {
    console.error('[birthdayHandout] error', err);
  }
}

function startScheduler({ client = null, birthdayChannelId = null } = {}) {
  cron.schedule('0 15 * * *', () => {
    console.log('[birthdayHandout] scheduled run (15:00 UTC -> 00:00 JST)');
    grantBirthdayPulls({ client, birthdayChannelId });
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log('[birthdayHandout] scheduler started (will run daily at 00:00 JST).');
}

module.exports = { startScheduler, grantBirthdayPulls };
