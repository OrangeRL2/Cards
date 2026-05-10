// commands/login.js
// Slash command: /login
// Grants daily random fans.
// Resets at midnight Japan time (JST).
// Frozen users also get +86 pulls on login.
//
// Login card event:
// - configurable start/end JST dates
// - configurable card pool
// - streak resets if user misses a day
// - day N gives N random cards from the pool
// - exact-day bonus rewards are separate/additional
// - reward cards are shown with pull-style pagination

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const User = require('../../models/User');
const { addPulls } = require('../../utils/pullQuota');
const { isFrozen } = require('../../utils/freeze');

let resolveCardColor = null;
let getAttributeEmoji = null;

try {
  const colorConfig = require('../../config/holomemColor');
  resolveCardColor = colorConfig.resolveCardColor;
  getAttributeEmoji = colorConfig.getAttributeEmoji;
} catch (err) {
  console.warn('[cmd:login] holomemColor helpers unavailable; using default embed color.');
}

// ----------------- Configuration -----------------

const DEFAULT_RANGE = { min: 50, max: 100 };

const SPECIAL_USER_RANGES = {
  // MOOMOO min1
  '875533483051712543': { min: 50, max: 80 },
  '647219814011502607': { min: 50, max: 80 },
  '91103688415776768': { min: 50, max: 100 },

  // char
  '879614865956827197': { min: 50, max: 100 },

  // aerestria
  '953552994232852490': { min: 50, max: 50 },
  '1188023588926795827': { min: 50, max: 50 },
  '1300468334474690583': { min: 50, max: 50 },

  // blacky
  '1416081468794339479': { min: 50, max: 50 },

  // MAINS
  '1334914199968677941': { min: 50, max: 53 },
};

const SPECIAL_ROLE_RANGES = {
  // '987654321098765432': { min: 1, max: 25 },
};

const LOGIN_CARD_EVENT = {
  enabled: true,

  // Inclusive JST dates.
  startJST: '2026-05-10',
  endJST: '2026-05-18',

  // Change this for each new event.
  eventKey: 'may-2026-login-card-event',

  resetOnMissedDay: true,

  cards: [
    { rarity: 'EV', name: 'La+ 103' },
    { rarity: 'EV', name: 'Lui 104' },
    { rarity: 'EV', name: 'Koyori 105' },
    { rarity: 'EV', name: 'Iroha 106' },
  ],

  // Additional rewards. These do NOT replace random cards.
  // Day 7 = 7 random cards + this bonus card.
  exactDayBonusRewards: {
    7: [
    { rarity: 'EV', name: 'La+ 103' },
    { rarity: 'EV', name: 'Lui 104' },
    { rarity: 'EV', name: 'Koyori 105' },
    { rarity: 'EV', name: 'Iroha 106' },
    ],
  },

  pageTimeoutMs: 2 * 60 * 1000,
};

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';

// --------------------------------------------------

function randIntInclusive(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// =====================
// JST helpers
// =====================

const TOKYO_TZ = 'Asia/Tokyo';

function getTokyoParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

function jstDateStringFor(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const { year, month, day } = getTokyoParts(date);
  return `${year}-${month}-${day}`;
}

function nextJstMidnightUnix(now = new Date()) {
  const { year, month, day } = getTokyoParts(now);
  const y = Number(year);
  const m = Number(month) - 1;
  const d = Number(day);

  // 00:00 JST next day == 15:00 UTC of the current JST date.
  const nextJstMidnightUtcMs = Date.UTC(y, m, d, 15, 0, 0);
  return Math.floor(nextJstMidnightUtcMs / 1000);
}

function isValidJstDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isJstDateWithinRange(todayJST, startJST, endJST) {
  if (!isValidJstDateString(todayJST)) return false;
  if (!isValidJstDateString(startJST)) return false;
  if (!isValidJstDateString(endJST)) return false;

  return todayJST >= startJST && todayJST <= endJST;
}

function previousJstDateString(todayJST) {
  const [year, month, day] = String(todayJST).split('-').map(Number);

  const todayJstMidnightUtcMs = Date.UTC(year, month - 1, day - 1, 15, 0, 0);
  const previousJstMidnightUtcMs = todayJstMidnightUtcMs - 24 * 60 * 60 * 1000;

  return jstDateStringFor(new Date(previousJstMidnightUtcMs));
}

// =====================
// Models
// =====================

const loginRecordSchema = new Schema(
  {
    userId: { type: String, required: true, index: true, unique: true },
    lastLoginJST: { type: String, required: true },
  },
  { timestamps: true }
);

let LoginRecord;
try {
  LoginRecord = mongoose.model('LoginRecord');
} catch (e) {
  LoginRecord = mongoose.model('LoginRecord', loginRecordSchema);
}

const loginCardEventRecordSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    eventKey: { type: String, required: true, index: true },
    lastLoginJST: { type: String, default: null },
    streak: { type: Number, default: 0 },
  },
  { timestamps: true }
);

loginCardEventRecordSchema.index({ userId: 1, eventKey: 1 }, { unique: true });

let LoginCardEventRecord;
try {
  LoginCardEventRecord = mongoose.model('LoginCardEventRecord');
} catch (e) {
  LoginCardEventRecord = mongoose.model('LoginCardEventRecord', loginCardEventRecordSchema);
}

// =====================
// Card helpers
// =====================

function getLoginCardEventKey() {
  if (LOGIN_CARD_EVENT.eventKey) return String(LOGIN_CARD_EVENT.eventKey);
  return `${LOGIN_CARD_EVENT.startJST || 'none'}:${LOGIN_CARD_EVENT.endJST || 'none'}`;
}

function isLoginCardEventActive(todayJST) {
  return (
    LOGIN_CARD_EVENT.enabled === true &&
    Array.isArray(LOGIN_CARD_EVENT.cards) &&
    LOGIN_CARD_EVENT.cards.length > 0 &&
    isJstDateWithinRange(todayJST, LOGIN_CARD_EVENT.startJST, LOGIN_CARD_EVENT.endJST)
  );
}

function normalizeCard(card) {
  const rarity = String(card?.rarity || '').trim().toUpperCase();
  const name = String(card?.name || '').trim();

  if (!rarity || !name) return null;

  return { rarity, name };
}

function pickRandomLoginEventCard() {
  const pool = LOGIN_CARD_EVENT.cards || [];
  if (!pool.length) return null;

  const idx = randIntInclusive(0, pool.length - 1);
  return normalizeCard(pool[idx]);
}

function getExactDayBonusCards(streak) {
  const bonusRewards = LOGIN_CARD_EVENT.exactDayBonusRewards || {};
  const rawBonusCards =
    bonusRewards[String(streak)] ||
    bonusRewards[Number(streak)] ||
    [];

  if (!Array.isArray(rawBonusCards)) return [];

  return rawBonusCards
    .map(normalizeCard)
    .filter(Boolean)
    .map(card => ({
      ...card,
      bonus: true,
    }));
}

function buildLoginEventRewardCardsForStreak(streak) {
  const rewards = [];

  // Day N gives N random cards.
  for (let i = 0; i < streak; i++) {
    const picked = pickRandomLoginEventCard();

    if (picked) {
      rewards.push({
        ...picked,
        bonus: false,
      });
    }
  }

  // Exact-day bonus cards are extra.
  const bonusCards = getExactDayBonusCards(streak);
  for (const card of bonusCards) {
    rewards.push(card);
  }

  return rewards;
}

function summarizeCards(cards) {
  const map = new Map();

  for (const card of cards || []) {
    const rarity = String(card.rarity || '').trim().toUpperCase();
    const name = String(card.name || '').trim();
    if (!rarity || !name) continue;

    const key = `${rarity}||${name}`;
    const current = map.get(key) || {
      rarity,
      name,
      count: 0,
      bonusCount: 0,
    };

    current.count += 1;

    if (card.bonus) {
      current.bonusCount += 1;
    }

    map.set(key, current);
  }

  return Array.from(map.values());
}

async function addCardsToUser(userId, cards) {
  const summary = summarizeCards(cards);
  if (!summary.length) return;

  let user = await User.findOneAndUpdate(
    { id: userId },
    { $setOnInsert: { id: userId } },
    { upsert: true, new: true }
  ).exec();

  for (const item of summary) {
    user = await User.findOne({ id: userId }).exec();

    const cardsArray = Array.isArray(user.cards) ? user.cards : [];
    const idx = cardsArray.findIndex(
      c => String(c.name) === item.name && String(c.rarity).toUpperCase() === item.rarity
    );

    if (idx !== -1) {
      const update = {};
      update[`cards.${idx}.count`] = (cardsArray[idx].count || 0) + item.count;
      update[`cards.${idx}.lastAcquiredAt`] = new Date();

      await User.updateOne(
        { id: userId },
        { $set: update }
      ).exec();
    } else {
      await User.updateOne(
        { id: userId },
        {
          $push: {
            cards: {
              name: item.name,
              rarity: item.rarity,
              count: item.count,
              firstAcquiredAt: new Date(),
              lastAcquiredAt: new Date(),
            },
          },
        }
      ).exec();
    }
  }
}

function buildCardImageUrl(card) {
  const rarity = String(card.rarity || '').trim().toUpperCase();
  const name = String(card.name || '').trim();

  return `${IMAGE_BASE.replace(/\/$/, '')}/${encodeURIComponent(rarity)}/${encodeURIComponent(name)}.png`;
}

function getCardColor(rarity, name) {
  let color = 0x5AB3F4;

  try {
    if (typeof resolveCardColor === 'function') {
      color = resolveCardColor(rarity, name) || color;
    }
  } catch (_) {}

  return color;
}

function getCardAttributeEmoji(name) {
  try {
    if (typeof getAttributeEmoji === 'function') {
      return getAttributeEmoji(name) || '';
    }
  } catch (_) {}

  return '';
}

// Pull-style card embed:
// - card-focused title
// - short description
// - image centered
// - rarity color
// - footer has page/streak info
// - no bulky info fields
function buildLoginEventCardEmbed({ user, streak, card, index, total }) {
  const rarity = String(card.rarity || '').trim().toUpperCase();
  const name = String(card.name || '').trim();
  const attrEmoji = getCardAttributeEmoji(name);
  const color = getCardColor(rarity, name);
  const imageUrl = buildCardImageUrl(card);

  const title = card.bonus
    ? `🌟 ${rarity} Bonus Reward`
    : `${rarity} Reward`;

  const description =
    `${attrEmoji ? `${attrEmoji} ` : ''}**${name}**`;

  const footerParts = [
    `Reward ${index}/${total}`,
    `Login Streak: Day ${streak}`,
  ];

  if (card.bonus) {
    footerParts.push('Bonus Streak Reward');
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setImage(imageUrl)
    .setFooter({
      text: footerParts.join(' • '),
      iconURL: user?.displayAvatarURL?.() || undefined,
    });

  return embed;
}

// =====================
// Pagination
// =====================

function buildLoginRewardPaginationRow({
  paginationId,
  page,
  total,
  disabled = false,
}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`loginreward:${paginationId}:prev`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || total <= 1),

    new ButtonBuilder()
      .setCustomId(`loginreward:${paginationId}:page`)
      .setLabel(`${page + 1}/${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),

    new ButtonBuilder()
      .setCustomId(`loginreward:${paginationId}:next`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || total <= 1)
  );
}

async function sendPaginatedLoginRewardReply({
  interaction,
  content,
  cards,
  streak,
}) {
  const rewardCards = Array.isArray(cards) ? cards : [];

  if (!rewardCards.length) {
    await interaction.editReply({
      content,
      embeds: [],
      components: [],
    });
    return;
  }

  let page = 0;
  const total = rewardCards.length;
  const paginationId = interaction.id;
  const timeoutMs = Number(LOGIN_CARD_EVENT.pageTimeoutMs || 2 * 60 * 1000);

  function buildPayload({ disabled = false } = {}) {
    const embed = buildLoginEventCardEmbed({
      user: interaction.user,
      streak,
      card: rewardCards[page],
      index: page + 1,
      total,
    });

    const components =
      total > 1
        ? [
            buildLoginRewardPaginationRow({
              paginationId,
              page,
              total,
              disabled,
            }),
          ]
        : [];

    return {
      content,
      embeds: [embed],
      components,
    };
  }

  await interaction.editReply(buildPayload());

  if (total <= 1) return;

  const replyMessage = await interaction.fetchReply().catch(() => null);
  if (!replyMessage) return;

  const collector = replyMessage.createMessageComponentCollector({
    time: timeoutMs,
  });

  collector.on('collect', async buttonInteraction => {
    try {
      const parts = String(buttonInteraction.customId || '').split(':');

      const isThisPaginator =
        parts[0] === 'loginreward' &&
        parts[1] === paginationId;

      if (!isThisPaginator) return;

      if (buttonInteraction.user.id !== interaction.user.id) {
        await buttonInteraction.reply({
          content: 'These login reward buttons are not for you.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }

      const action = parts[2];

      if (action === 'prev') {
        // Loop backwards:
        // page 0 -> last page
        page = (page - 1 + total) % total;
      } else if (action === 'next') {
        // Loop forwards:
        // last page -> page 0
        page = (page + 1) % total;
      } else {
        await buttonInteraction.deferUpdate().catch(() => {});
        return;
      }

      // Reset timeout whenever the owner uses a valid button.
      collector.resetTimer();

      await buttonInteraction.update(buildPayload());
    } catch (err) {
      console.error('[cmd:login] pagination collect error', err);

      try {
        if (!buttonInteraction.replied && !buttonInteraction.deferred) {
          await buttonInteraction.reply({
            content: 'Something went wrong while changing pages.',
            ephemeral: true,
          });
        }
      } catch (_) {}
    }
  });

  collector.on('end', async () => {
    try {
      await interaction.editReply(buildPayload({ disabled: true }));
    } catch (_) {}
  });
}

// =====================
// Reply content
// =====================

function buildLoginReplyContent({ fans, frozen, pullsGranted, eventCardsAwarded, eventStreak }) {
  const lines = [
    `You logged in for the day and earned **${fans}** fans 🎉`,
  ];

  if (frozen) {
    lines.push(`Frozen bonus: **+${pullsGranted} pulls** 🎟️`);
  }

  if (eventCardsAwarded.length > 0) {
    const summary = summarizeCards(eventCardsAwarded);

    lines.push('');
    lines.push(`**Login Card Event: Day ${eventStreak} streak!**`);
    lines.push(
      `You received **${eventCardsAwarded.length}** card${eventCardsAwarded.length === 1 ? '' : 's'}:`
    );

    for (const item of summary) {
      const bonusText = item.bonusCount > 0
        ? ` 🌟 bonus x${item.bonusCount}`
        : '';

      lines.push(`- **${item.rarity} ${item.name}** x${item.count}${bonusText}`);
    }
  }

  let content = lines.join('\n');

  // Keep Discord content safely under 2000 chars for long streaks.
  if (content.length > 1900) {
    content = content.slice(0, 1850) + '\n...summary truncated because the streak reward list is long.';
  }

  return content;
}

// =====================
// Command
// =====================

module.exports = {
  data: new SlashCommandBuilder()
    .setName('login')
    .setDescription('Claim your daily login fans and event rewards, if active.'),

  /**
   * @param {import('discord.js').CommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply();

    try {
      const userId = interaction.user.id;

      // -----------------------------
      // Frozen check
      // -----------------------------
      const guild = interaction.guild;
      let member = interaction.member;

      if (guild && (!member || !member.roles?.cache)) {
        member = await guild.members.fetch(userId).catch(() => null);
      }

      const frozen = isFrozen(userId, member);

      // -----------------------------
      // Daily JST login check
      // -----------------------------
      const todayJST = jstDateStringFor();

      const rec = await LoginRecord.findOne({ userId }).exec();

      if (rec && rec.lastLoginJST === todayJST) {
        const nextResetUnix = nextJstMidnightUnix();

        await interaction.editReply({
          content: `You already logged in today. Come back after midnight (<t:${nextResetUnix}:R>).`,
          embeds: [],
          components: [],
        });
        return;
      }

      // -----------------------------
      // Determine fans range
      // -----------------------------
      let range = DEFAULT_RANGE;

      if (SPECIAL_USER_RANGES[userId]) {
        range = SPECIAL_USER_RANGES[userId];
      } else if (member && member.roles && member.roles.cache) {
        for (const [roleId, r] of Object.entries(SPECIAL_ROLE_RANGES)) {
          if (member.roles.cache.has(roleId)) {
            range = r;
            break;
          }
        }
      }

      const min = Number(range.min) || 0;
      const max = Number(range.max) || min;
      const fans = randIntInclusive(min, max);

      // -----------------------------
      // Login card event logic
      // -----------------------------
      let eventCardsAwarded = [];
      let eventStreak = 0;

      const eventActive = isLoginCardEventActive(todayJST);

      if (eventActive) {
        const eventKey = getLoginCardEventKey();
        const yesterdayJST = previousJstDateString(todayJST);

        const eventRec = await LoginCardEventRecord.findOne({
          userId,
          eventKey,
        }).exec();

        let continued = false;

        if (eventRec) {
          if (LOGIN_CARD_EVENT.resetOnMissedDay === false) {
            continued = Boolean(eventRec.lastLoginJST);
          } else {
            continued = eventRec.lastLoginJST === yesterdayJST;
          }
        }

        eventStreak = continued
          ? Math.max(0, Number(eventRec.streak || 0)) + 1
          : 1;

        await LoginCardEventRecord.findOneAndUpdate(
          { userId, eventKey },
          {
            $set: {
              lastLoginJST: todayJST,
              streak: eventStreak,
            },
            $setOnInsert: {
              userId,
              eventKey,
            },
          },
          { upsert: true, new: true }
        ).exec();

        eventCardsAwarded = buildLoginEventRewardCardsForStreak(eventStreak);
      }

      // -----------------------------
      // Persist normal daily login record
      // -----------------------------
      await LoginRecord.findOneAndUpdate(
        { userId },
        {
          $set: {
            lastLoginJST: todayJST,
          },
          $setOnInsert: {
            userId,
          },
        },
        { upsert: true, new: true }
      ).exec();

      // -----------------------------
      // Add fans
      // -----------------------------
      await User.findOneAndUpdate(
        { id: userId },
        {
          $inc: { points: fans },
          $setOnInsert: { id: userId },
        },
        { upsert: true, new: true }
      ).exec();

      // -----------------------------
      // Add event cards
      // -----------------------------
      if (eventCardsAwarded.length > 0) {
        await addCardsToUser(userId, eventCardsAwarded);
      }

      // -----------------------------
      // Frozen bonus
      // -----------------------------
      let pullsGranted = 0;

      if (frozen) {
        pullsGranted = 86;
        await addPulls(userId, pullsGranted);
      }

      // -----------------------------
      // Reply
      // -----------------------------
      const content = buildLoginReplyContent({
        fans,
        frozen,
        pullsGranted,
        eventCardsAwarded,
        eventStreak,
      });

      if (eventCardsAwarded.length > 0) {
        await sendPaginatedLoginRewardReply({
          interaction,
          content,
          cards: eventCardsAwarded,
          streak: eventStreak,
        });
      } else {
        await interaction.editReply({
          content,
          embeds: [],
          components: [],
        });
      }
    } catch (err) {
      console.error('[cmd:login] error', err);

      try {
        await interaction.editReply({
          content: 'An error occurred while processing your login. Please try again later.',
          embeds: [],
          components: [],
        });
      } catch (_) {}
    }
  },
};