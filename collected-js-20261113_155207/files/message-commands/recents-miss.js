// message-commands/recents-miss.js
// Prefix command: !recents-miss
//
// Shows which oshi labels from config/oshis.js have NOT been pulled
// (SR+ ONLY) by you (or your team) within the last N JST days.
//
// Usage:
//   !recents-miss
//   !recents-miss --days=7
//   !recents-miss --team
//   !recents-miss --team=Nyanko --days 3
//
// Notes:
// - "Pulled" is determined by cards in User.cards with lastAcquiredAt inside the JST window,
//   AND rarity in SR+ set (same as your recents command).
// - Matches card names like "Suisei 001" to oshi label "Suisei" (first token).
// - Restricts usage to IDs listed in TEAM_MAP (same style as your recents command).

const User = require('../models/User');
const PREFIX = '!';
const COMMAND_NAME = 'recents-miss';

// Your oshi list lives in config/oshis.js and contains objects with "label". [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/oshis.js)
const OSHIS = require('../config/oshis');

const DEFAULT_DAYS = 1;
const MAX_DAYS = 365;

// ✅ SR+ rarity list copied from your recents command. [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/pullresults.js)
const SR_AND_ABOVE = new Set(['SR', 'OSR', 'VAL', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'SEC', 'ORI']);

// Same team system as your current recents command. [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/pullresults.js)
const TEAM_MAP = {
  ChillingRain: [
    '1311652316973240380',
    '399631405228752897'
  ],
  ORI: [
    '409717160995192832',
    '153551890976735232'
  ],
  AkumaTenshi: [
    '701960122251083807',
    '409724952091295745'
  ],
  OK: [
    '402522309606375434',
    '443047182619377676'
  ],
  AhWell: [
    '443061305721618432',
    '1312674257104539761'
  ],
  Nyanko: [
    '399012422805094410',
    '409720567588061184'
  ],
  Baba: [
    '409728788117848074',
    '370081368274894849',
    '511182422340272128',
    '272129129841688577',
    '581483331548348416'
  ],
  // add more teams as needed
};

// Utility: split long output into chunks that fit Discord limits (same pattern as recents). [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/pullresults.js)
function chunkLines(lines, maxLen = 1900) {
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    const candidate = cur ? `${cur}\n${line}` : line;
    if (candidate.length > maxLen) {
      if (cur) {
        chunks.push(cur);
        cur = line;
      } else {
        chunks.push(line.slice(0, maxLen - 3) + '...');
        cur = '';
      }
    } else {
      cur = candidate;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Build a JST window covering "last N days including today".
 * Based on your existing JST-day logic. [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/pullresults.js)
 */
function getJstWindowLastNDays(days) {
  const d = Math.max(1, Math.min(MAX_DAYS, Number(days) || DEFAULT_DAYS));

  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const now = Date.now();
  const nowJstMs = now + JST_OFFSET_MS;
  const nowJst = new Date(nowJstMs);

  const year = nowJst.getUTCFullYear();
  const month = nowJst.getUTCMonth();
  const day = nowJst.getUTCDate();

  // JST midnight in UTC ms:
  const jstMidnightUtcMs = Date.UTC(year, month, day, 0, 0, 0) - JST_OFFSET_MS;

  // Start at midnight (days-1) days ago
  const start = new Date(jstMidnightUtcMs - (d - 1) * 24 * 60 * 60 * 1000);
  // End at next midnight (tomorrow)
  const end = new Date(jstMidnightUtcMs + 24 * 60 * 60 * 1000);

  const endJstDateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { start, end, days: d, endJstDateString };
}

/**
 * Parse flags:
 *   --team
 *   --team=NAME
 *   --team NAME
 *   --days=7
 *   --days 7
 *
 * Team parsing mirrors your existing command behavior. [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/pullresults.js)
 */
function parseFlags(tokens) {
  const flags = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith('--')) continue;

    const [flag, rawVal] = t.split('=', 2);

    if (flag === '--team') {
      if (typeof rawVal !== 'undefined') {
        flags.team = rawVal;
      } else {
        const next = tokens[i + 1];
        if (next && !next.startsWith('--')) {
          flags.team = next;
          i++;
        } else {
          flags.team = true; // use my team
        }
      }
    }

    if (flag === '--days') {
      if (typeof rawVal !== 'undefined') {
        flags.days = rawVal;
      } else {
        const next = tokens[i + 1];
        if (next && !next.startsWith('--')) {
          flags.days = next;
          i++;
        }
      }
    }
  }
  return flags;
}

/**
 * Extract oshi label from a card name like "Suisei 001".
 * We take the first token before whitespace.
 */
function getBaseName(cardName) {
  if (!cardName || typeof cardName !== 'string') return null;
  const token = cardName.trim().split(/\s+/)[0];
  return token || null;
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Prefix command: recents-miss - show which oshi names have not been pulled (SR+ only) in the last N JST days (optionally by team)',

  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      const parts = message.content.trim().split(/\s+/);
      const invoked = parts[0].slice(PREFIX.length).toLowerCase();
      if (invoked !== COMMAND_NAME) return;

      const tokens = parts.slice(1);
      const flags = parseFlags(tokens);

      // Restrict usage to IDs listed in TEAM_MAP (same as your recents command). [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/pullresults.js)
      const ALL_TEAM_IDS = new Set(Object.values(TEAM_MAP).flat().map(String));
      if (!ALL_TEAM_IDS.has(message.author.id)) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const { start, end, days, endJstDateString } = getJstWindowLastNDays(flags.days);

      // Build oshi label lookup (case-insensitive). oshis.js includes .label fields. [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/oshis.js)
      const labelByLower = new Map();
      for (const o of (OSHIS || [])) {
        if (o?.label) labelByLower.set(String(o.label).toLowerCase(), String(o.label));
      }
      const allLabelsLower = Array.from(labelByLower.keys());

      if (allLabelsLower.length === 0) {
        return message.reply({ content: 'oshis list is empty or failed to load.' }).catch(() => {});
      }

      // Helper: from a user doc, get pulled oshi labels within window (SR+ only).
      function pulledLabelsFromUserDoc(userDoc) {
        const pulled = new Set();
        if (!userDoc || !Array.isArray(userDoc.cards) || userDoc.cards.length === 0) return pulled;

        for (const c of userDoc.cards) {
          if (!c?.name) continue;
          if (!c?.lastAcquiredAt) continue;

          // ✅ SR+ ONLY (same as recents command)
          const rarity = String(c.rarity || '').toUpperCase();
          if (!SR_AND_ABOVE.has(rarity)) continue;

          const t = new Date(c.lastAcquiredAt);
          if (Number.isNaN(t.getTime())) continue;
          if (t.getTime() < start.getTime() || t.getTime() >= end.getTime()) continue;

          const base = getBaseName(c.name);
          if (!base) continue;

          const baseLower = base.toLowerCase();
          if (labelByLower.has(baseLower)) {
            pulled.add(baseLower);
          }
        }
        return pulled;
      }

      // TEAM mode
      if (flags.team) {
        let teamName = null;
        let teamIds = null;

        if (typeof flags.team === 'string' && flags.team !== true) {
          const requested = String(flags.team);
          const foundKey = Object.keys(TEAM_MAP).find(k => k.toLowerCase() === requested.toLowerCase());
          if (!foundKey) {
            return message.reply({
              content: `Team "${requested}" not found. Available teams: ${Object.keys(TEAM_MAP).join(', ')}`
            }).catch(() => {});
          }
          teamName = foundKey;
          teamIds = Array.isArray(TEAM_MAP[foundKey]) ? TEAM_MAP[foundKey].slice() : [];
        } else {
          // --team with no name => find the team that contains caller
          const myId = message.author.id;
          const found = Object.entries(TEAM_MAP).find(([, ids]) => Array.isArray(ids) && ids.includes(myId));
          if (!found) {
            return message.reply({
              content: 'You are not a member of any configured team. Either join a team or use the command without --team.'
            }).catch(() => {});
          }
          teamName = found[0];
          teamIds = Array.isArray(found[1]) ? found[1].slice() : [];
        }

        if (!teamIds || teamIds.length === 0) {
          return message.reply({ content: `Team "${teamName}" has no members configured.` }).catch(() => {});
        }

        const uniqueIds = Array.from(new Set(teamIds.map(String)));
        const userDocs = await Promise.all(uniqueIds.map(id => User.findOne({ id }).lean().exec()));

        const pulledByTeam = new Set();
        for (const uDoc of userDocs) {
          const pulled = pulledLabelsFromUserDoc(uDoc);
          for (const x of pulled) pulledByTeam.add(x);
        }

        const missing = allLabelsLower
          .filter(l => !pulledByTeam.has(l))
          .map(l => labelByLower.get(l))
          .filter(Boolean);

        if (missing.length === 0) {
          return message.reply({
            content: `✅ Team **${teamName}** has pulled every oshi (SR+ only) at least once in the last **${days}** day(s) (up to ${endJstDateString} JST).`
          }).catch(() => {});
        }

        const lines = [
          `❌ Missing oshis for team **${teamName}** (SR+ only) in the last **${days}** day(s) (up to ${endJstDateString} JST):`,
          `Total missing: **${missing.length}**`,
          '',
          ...missing.map(x => `• ${x}`)
        ];

        const chunks = chunkLines(lines, 1900);
        await message.reply({ content: chunks[0] }).catch(() => {});
        for (let i = 1; i < chunks.length; i++) {
          await message.channel.send(`(continued)\n${chunks[i]}`).catch(() => {});
        }
        return;
      }

      // Single-user mode
      const userId = message.author.id;
      const userDoc = await User.findOne({ id: userId }).lean().exec();

      const pulledByUser = pulledLabelsFromUserDoc(userDoc);
      const missing = allLabelsLower
        .filter(l => !pulledByUser.has(l))
        .map(l => labelByLower.get(l))
        .filter(Boolean);

      if (missing.length === 0) {
        return message.reply({
          content: `✅ You have pulled every oshi (SR+ only) at least once in the last **${days}** day(s) (up to ${endJstDateString} JST).`
        }).catch(() => {});
      }

      const lines = [
        `❌ Missing oshis for **you** (SR+ only) in the last **${days}** day(s) (up to ${endJstDateString} JST):`,
        `Total missing: **${missing.length}**`,
        '',
        ...missing.map(x => `• ${x}`)
      ];

      const chunks = chunkLines(lines, 1900);
      await message.reply({ content: chunks[0] }).catch(() => {});
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(`(continued)\n${chunks[i]}`).catch(() => {});
      }
    } catch (err) {
      console.error('[recents-miss] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running recents-miss.' }); } catch {}
    }
  }
};
