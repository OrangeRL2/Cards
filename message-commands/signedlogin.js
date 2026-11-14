'use strict';
// Owner-only global login reward on one specific JST calendar day.
// Usage: !signedlogin [--today | --tomorrow | --date=2026-12-15 | --status | --cancel --date=2026-12-15]
const SignedLoginDay = require('../models/SignedLoginDay');
const {
  jstDateString, nextJstDateString, validJstDate,
  scheduleJstDate, cancelJstDate,
} = require('../utils/signedLoginDay');
const { hasSignedFiveStarHolodoriArtwork } = require('../utils/holodoriLoginReward');

const OWNER_IDS = new Set(['153551890976735232']);

module.exports = {
  name: 'signedlogin',
  description: 'Owner only: guarantee signed HOLODORI five-star daily login rewards on a scheduled JST day.',
  async execute(message, args = []) {
    if (message.author?.bot || !OWNER_IDS.has(String(message.author?.id))) return;

    const tokens = Array.isArray(args) ? args : [];
    const status = tokens.includes('--status');
    const cancel = tokens.includes('--cancel');
    const dateFlag = tokens.find(arg => /^--date=/i.test(arg));
    const todayJST = jstDateString();
    const isToday = tokens.includes('--today');
    const isTomorrow = tokens.includes('--tomorrow');
    const dayJST = isToday ? todayJST : (dateFlag ? dateFlag.slice('--date='.length) : nextJstDateString());

    if (tokens.some(arg => !['--today', '--tomorrow', '--status', '--cancel'].includes(arg) && !/^--date=/i.test(arg)) ||
        (Number(isToday) + Number(isTomorrow) + Number(Boolean(dateFlag)) > 1) ||
        (status && cancel) ||
        (status && (isToday || isTomorrow || Boolean(dateFlag))) ||
        (cancel && isTomorrow)) {
      return message.reply('Usage: `!signedlogin --today` (same-day testing), `!signedlogin` (tomorrow JST), `!signedlogin --date=2026-12-15`, `!signedlogin --status`, or `!signedlogin --cancel --date=2026-12-15`.');
    }

    try {
      if (status) {
        const days = await SignedLoginDay.find({ dayJST: { $gte: todayJST } })
          .sort({ dayJST: 1 }).select('dayJST').lean().exec();
        const list = days.map(day => day.dayJST);
        return message.reply(list.length
          ? `Scheduled SIGNED HOLODORI 5★ login days (JST): **${list.join(', ')}**.`
          : 'No upcoming signed HOLODORI 5★ login days are scheduled.');
      }
      if (!validJstDate(dayJST)) {
        return message.reply('Invalid date. Use an actual JST calendar date in `YYYY-MM-DD` format.');
      }
      if (cancel) {
        const removed = await cancelJstDate(dayJST);
        return message.reply(removed
          ? `Cancelled the signed HOLODORI 5★ login bonus for **${dayJST} JST**.`
          : `There was no signed HOLODORI 5★ login bonus on **${dayJST} JST**.`);
      }
      // --today is an intentional owner-only test override. Explicit --date
      // retains the original future-only protection.
      if (dayJST < todayJST || (dayJST === todayJST && !isToday)) {
        return message.reply('The bonus must be scheduled for a future JST calendar day. For same-day testing, use `!signedlogin --today`.');
      }
      if (!hasSignedFiveStarHolodoriArtwork()) {
        return message.reply('Cannot schedule: no signed HOLODORI 5★ PNGs found in `assets/images/HOLODORI/★★★★★/`.');
      }
      await scheduleJstDate(dayJST, message.author.id);
      return message.reply(`Scheduled: Every user who successfully logs in on **${dayJST} JST** receives a random **SIGNED HOLODORI 5★** in place of the usual daily HOLODORI card. This will not carry over to later days. Pending member-specific overrides remain queued.${isToday ? " WARNING: This reward applies to ALL users who log in again before midnight JST; use `!signedlogin --cancel --date=" + dayJST + "` to end the test." : ""}`);
    } catch (err) {
      console.error('[signedlogin] error:', err);
      return message.reply('Could not update the scheduled login bonus. Check bot logs.');
    }
  },
};
