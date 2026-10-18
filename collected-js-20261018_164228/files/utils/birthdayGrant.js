const PullQuota = require('../models/PullQuota');
const User = require('../models/User');
const OSHI_LIST = require('../config/oshis');
const { pickBdayFile, normalizeLabel } = require('./loadBdayImages');
const EVENT_PULLS_AMOUNT = 12;

// Users who should still receive the birthday rewards,
// but should NOT trigger a personalized public handout message.
const NO_PERSONALIZED_HANDOUT_MESSAGE_IDS = new Set([
  // '123456789012345678',
]);

function getJstInfo(now = new Date()) {
  const jstOffsetMin = 9 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const jst = new Date(utcMs + jstOffsetMin * 60000);
  const year = jst.getFullYear();
  const month = jst.getMonth() + 1;
  const day = jst.getDate();
  const startOfDayUtc = new Date(Date.UTC(year, jst.getMonth(), day, 0 - 9, 0, 0, 0));
  return { year, month, day, startOfDayUtc };
}

function alreadyGrantedThisJstYear(pq) {
  if (!pq || !pq.lastBirthdayGivenAt) return false;
  const lastYear = getJstInfo(new Date(pq.lastBirthdayGivenAt)).year;
  const thisYear = getJstInfo().year;
  return lastYear === thisYear;
}

async function addBdayCardToUser(userId, oshiLabel) {
  try {
    const file = pickBdayFile(oshiLabel);
    if (!file) return null;

    const base = file.split('/').pop();
    const ext = base.includes('.') ? base.substring(base.lastIndexOf('.')) : '';
    const raw = ext ? base.slice(0, base.length - ext.length) : base;
    const displayName = raw.replace(/[_-]+/g, ' ').trim();

    let userDoc = await User.findOne({ id: userId }).exec();
    if (!userDoc) userDoc = await User.create({ id: userId, cards: [] });

    let card = (userDoc.cards || []).find(
      c => c.name === displayName && c.rarity === 'BDAY'
    );

    const now = new Date();
    if (!card) {
      card = {
        name: displayName,
        rarity: 'BDAY',
        count: 1,
        firstAcquiredAt: now,
        lastAcquiredAt: now,
        locked: false,
      };
      userDoc.cards = userDoc.cards || [];
      userDoc.cards.push(card);
    } else {
      card.count = (card.count || 0) + 1;
      if (!card.firstAcquiredAt) card.firstAcquiredAt = now;
      card.lastAcquiredAt = now;
    }

    await userDoc.save();
    return { file, displayName };
  } catch (err) {
    console.error('[addBdayCardToUser] error', err);
    return null;
  }
}

async function grantOnSelectIfBirthday(
  userId,
  chosenOshiId,
  { client = null, birthdayChannelId = null } = {}
) {
  const oshi = OSHI_LIST.find(o => o.id === chosenOshiId);
  if (!oshi || !oshi.bdayMonth || !oshi.bdayDay) {
    return { granted: false, reason: 'no-bday' };
  }

  const { month, day } = getJstInfo();
  if (oshi.bdayMonth !== month || oshi.bdayDay !== day) {
    return { granted: false, reason: 'not-today' };
  }

  let pq = await PullQuota.findOne({ userId });
  if (pq && alreadyGrantedThisJstYear(pq)) {
    return { granted: false, reason: 'already-given' };
  }

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

  const bdayResult = await addBdayCardToUser(userId, oshi.label);

  // Skip public personalized announcement for certain user IDs
  const skipPersonalizedAnnouncement =
    NO_PERSONALIZED_HANDOUT_MESSAGE_IDS.has(String(userId));

  if (!skipPersonalizedAnnouncement && client && birthdayChannelId) {
    try {
      const ch = await client.channels.fetch(birthdayChannelId).catch(() => null);
      if (ch && ch.isTextBased?.()) {
        const peopleText = `• <@${userId}> just chose **${oshi.label}** as their oshi and received **${EVENT_PULLS_AMOUNT} event pulls**${
          bdayResult ? ` as well as **${oshi.label}'s** birthday card!` : '!'
        }`;

        const celebrationLines = [
          'Make a wish and celebrate!',
          'Cake, confetti, and fanart time!',
          'Show some love in chat with fan edits!',
          'Time to spam those best pics!',
        ];
        const celebration =
          celebrationLines[Math.floor(Math.random() * celebrationLines.length)];

        const embed = {
          title: `🎉 Happy Birthday ${oshi.label}! 🎉`,
          description: `${peopleText}\n\n${celebration}`,
          color: 0xffcc00,
          timestamp: new Date().toISOString(),
          footer: { text: 'Birthday event' },
          fields: [
            { name: 'Generation', value: oshi.gen || 'Uncategorized', inline: true },
            {
              name: 'Birthday',
              value: `${String(oshi.bdayMonth).padStart(2, '0')}-${String(
                oshi.bdayDay
              ).padStart(2, '0')}`,
              inline: true,
            },
          ],
        };

        if (oshi.image) {
          embed.image = { url: oshi.image };
          embed.thumbnail = { url: oshi.image };
        } else {
          embed.image = {
            url: 'https://media.discordapp.net/attachments/432383725515309056/864530510276198400/kasumifinal.gif',
          };
        }

        await ch.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('[birthdayGrant] announce error', err);
    }
  }

  return {
    granted: true,
    method: 'selection',
    gaveCard: Boolean(bdayResult),
    personalizedAnnouncementSkipped: skipPersonalizedAnnouncement,
  };
}

module.exports = {
  getJstInfo,
  alreadyGrantedThisJstYear,
  grantOnSelectIfBirthday,
};