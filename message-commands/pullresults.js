// message-commands/recent-sr.js
// Prefix command: !recent-sr (invoked as !recents in this file)
// Lists SR+ cards the invoking user (or their team) pulled in the current JST day (midnight-to-midnight JST).
// Usage:
//   !recents
//   !recents --team            (use the team that contains your user id)
//   !recents --team=Nyanko     (explicit team name)
// Notes:
//  - Shows each card (rarity + name) and when it was pulled; does NOT display stack counts.
//  - Team groups are defined in TEAM_MAP below.
//  - Only user IDs listed in TEAM_MAP may run this command.

const User = require('../models/User');

const PREFIX = '!';
const COMMAND_NAME = 'recents';

// Rarities considered SR and above
const SR_AND_ABOVE = new Set(['SR', 'OSR', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'SEC', 'ORI']);

// Define teams here. Keys are team names (case-insensitive when matching by explicit name).
// Values are arrays of user ID strings.
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
  Baba:[
   '409728788117848074',
   '370081368274894849',
   '511182422340272128',
    '272129129841688577',
    '581483331548348416',
  ],

  // add more teams as needed
};

// Utility: split long text into chunks that fit within Discord message limits
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
        // single line too long (very unlikely) - force-split
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
 * Compute the JST-day start and end Date objects for "today" in JST.
 * Returns { start: Date, end: Date, jstDateString: 'YYYY-MM-DD' } where start is JST midnight (inclusive)
 * and end is the next JST midnight (exclusive), expressed as JS Date objects (UTC-based).
 */
function getJstDayWindowNow() {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const now = Date.now();
  const nowJstMs = now + JST_OFFSET_MS;
  const nowJst = new Date(nowJstMs);

  const year = nowJst.getUTCFullYear();
  const month = nowJst.getUTCMonth(); // 0-based
  const day = nowJst.getUTCDate();

  // JST midnight in UTC ms is Date.UTC(year, month, day, 0,0,0) - JST_OFFSET_MS
  const jstMidnightUtcMs = Date.UTC(year, month, day, 0, 0, 0) - JST_OFFSET_MS;
  const start = new Date(jstMidnightUtcMs);
  const end = new Date(jstMidnightUtcMs + 24 * 60 * 60 * 1000);

  const jstDateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { start, end, jstDateString };
}

/**
 * Parse flags from the message tokens.
 * Supports:
 *   --team           (no value)  => use team that contains the invoking user's id
 *   --team=NAME      => explicit team name
 *   --team NAME      => explicit team name (also supported)
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
        // check next token if it's not another flag
        const next = tokens[i + 1];
        if (next && !next.startsWith('--')) {
          flags.team = next;
          i++;
        } else {
          // explicit presence with no name => signal "use my team"
          flags.team = true;
        }
      }
    }
  }
  return flags;
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Prefix command: recent-sr - list SR+ cards you (or your team) pulled in the current JST day (midnight-to-midnight JST)',
  /**
   * @param {import('discord.js').Message} message
   * @param {string[]} args
   */
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Basic command match: allow "!recents" or "!recents ..." (case-insensitive)
      const tokens = message.content.trim().split(/\s+/).slice(1); // tokens after command
      const invoked = message.content.trim().split(/\s+/)[0].slice(PREFIX.length).toLowerCase();
      if (invoked !== COMMAND_NAME) return;

      // --- restrict usage to IDs listed in TEAM_MAP ---
      const ALL_TEAM_IDS = new Set(Object.values(TEAM_MAP).flat().map(String));
      if (!ALL_TEAM_IDS.has(message.author.id)) {
        return message.reply({
          content: 'You are not allowed to use this command.'
        }).catch(() => {});
      }

      const flags = parseFlags(tokens);

      // JST day window (midnight-to-midnight JST)
      const { start: jstStart, end: jstEnd, jstDateString } = getJstDayWindowNow();

      // Helper to build recent SR+ list for a single userDoc
      function buildRecentFromUserDoc(userDoc) {
        if (!userDoc || !Array.isArray(userDoc.cards) || userDoc.cards.length === 0) return [];
        return userDoc.cards
          .map(c => ({
            name: c.name,
            rarity: String(c.rarity || '').toUpperCase(),
            lastAcquiredAt: c.lastAcquiredAt ? new Date(c.lastAcquiredAt) : null,
            locked: Boolean(c.locked)
          }))
          .filter(c => SR_AND_ABOVE.has(c.rarity) && c.lastAcquiredAt && c.lastAcquiredAt.getTime() >= jstStart.getTime() && c.lastAcquiredAt.getTime() < jstEnd.getTime())
          .sort((a, b) => {
            const ta = a.lastAcquiredAt ? a.lastAcquiredAt.getTime() : 0;
            const tb = b.lastAcquiredAt ? b.lastAcquiredAt.getTime() : 0;
            return tb - ta;
          });
      }

      // If --team flag present, build for team members; otherwise for invoking user only
      if (flags.team) {
        // Determine team members
        let teamName = null;
        let teamIds = null;

        if (typeof flags.team === 'string' && flags.team !== true) {
          // explicit team name provided
          const requested = flags.team;
          // case-insensitive match
          const foundKey = Object.keys(TEAM_MAP).find(k => k.toLowerCase() === String(requested).toLowerCase());
          if (!foundKey) {
            return message.reply({ content: `Team "${requested}" not found. Available teams: ${Object.keys(TEAM_MAP).join(', ')}` }).catch(() => {});
          }
          teamName = foundKey;
          teamIds = Array.isArray(TEAM_MAP[foundKey]) ? TEAM_MAP[foundKey].slice() : [];
        } else {
          // flags.team === true => find the team that contains the invoking user's id
          const myId = message.author.id;
          const found = Object.entries(TEAM_MAP).find(([, ids]) => Array.isArray(ids) && ids.includes(myId));
          if (!found) {
            return message.reply({ content: 'You are not a member of any configured team. Either join a team or use the command without --team.' }).catch(() => {});
          }
          teamName = found[0];
          teamIds = Array.isArray(found[1]) ? found[1].slice() : [];
        }

        if (!teamIds || teamIds.length === 0) {
          return message.reply({ content: `Team "${teamName}" has no members configured.` }).catch(() => {});
        }

        // Fetch user docs and Discord user objects in parallel
        const uniqueIds = Array.from(new Set(teamIds.map(String)));
        const userDocPromises = uniqueIds.map(id => User.findOne({ id }).lean().exec());
        const fetchUserPromises = uniqueIds.map(id => message.client.users.fetch(id).catch(() => null));

        const [userDocs, fetchedUsers] = await Promise.all([
          Promise.all(userDocPromises),
          Promise.all(fetchUserPromises)
        ]);

        // Build per-user lines
        const perUserLines = [];
        let totalFound = 0;

        for (let i = 0; i < uniqueIds.length; i++) {
          const uid = uniqueIds[i];
          const uDoc = userDocs[i];
          const dUser = fetchedUsers[i];

          // Prefer guild displayName (nickname) when available; otherwise show username
          // and omit the "#0" discriminator which Discord uses for some accounts.
          let displayName = uid;
          if (dUser) {
            if (message.guild) {
              try {
                const member = await message.guild.members.fetch(uid).catch(() => null);
                if (member) {
                  displayName = member.displayName;
                } else {
                  displayName = (dUser.discriminator && dUser.discriminator !== '0')
                    ? `${dUser.username}#${dUser.discriminator}`
                    : dUser.username;
                }
              } catch {
                displayName = dUser.username;
              }
            } else {
              displayName = (dUser.discriminator && dUser.discriminator !== '0')
                ? `${dUser.username}#${dUser.discriminator}`
                : dUser.username;
            }
          }

          const recent = buildRecentFromUserDoc(uDoc);
          if (!recent.length) {
            perUserLines.push(`**${displayName}** - no SR+ pulls for day ${jstDateString}`);
            continue;
          }
          totalFound += recent.length;
          perUserLines.push(`**${displayName}** - ${recent.length} item${recent.length === 1 ? '' : 's'}:`);
          for (const c of recent) {
            const ts = Math.floor(c.lastAcquiredAt.getTime() / 1000);
            const lockedText = c.locked ? '' : '';
            perUserLines.push(`  • **[${c.rarity}]** ${c.name}${lockedText} - pulled <t:${ts}:R>`);
          }
        }

        if (totalFound === 0) {
          return message.reply({ content: `No SR+ pulls found for any members of team "${teamName}" on JST day ${jstDateString}.` }).catch(() => {});
        }

        // Chunk and send
        const chunks = chunkLines(perUserLines, 1900);
        const header = `SR+ pulls for team **${teamName}** on day: ${jstDateString} - total ${totalFound} item${totalFound === 1 ? '' : 's'}:\n\n`;
        await message.reply({ content: `${header}${chunks[0]}` }).catch(() => {});
        for (let i = 1; i < chunks.length; i++) {
          await message.channel.send(`(continued) ${chunks[i]}`).catch(() => {});
        }
        return;
      }

      // Non-team flow: single user (invoking user)
      const userId = message.author.id;
      const userDoc = await User.findOne({ id: userId }).lean().exec();
      if (!userDoc || !Array.isArray(userDoc.cards) || userDoc.cards.length === 0) {
        return message.reply({ content: 'You have no cards in your inventory.' }).catch(() => {});
      }

      const recent = buildRecentFromUserDoc(userDoc);
      if (!recent.length) {
        return message.reply({ content: `You have no SR+ pulls in the current day (${jstDateString}).` }).catch(() => {});
      }

      // Build readable lines WITHOUT counts; include rarity, name, and relative time.
      const lines = recent.map(c => {
        const ts = Math.floor(c.lastAcquiredAt.getTime() / 1000);
        const lockedText = c.locked ? '' : '';
        return `**[${c.rarity}]** ${c.name}${lockedText} - pulled <t:${ts}:R>`;
      });

      const chunks = chunkLines(lines, 1900);

      // Send first chunk as reply, rest as channel messages (so they are visible in channel)
      const header = `SR+ pulls for day: ${jstDateString} (JST) - ${recent.length} item${recent.length === 1 ? '' : 's'}:\n\n`;
      await message.reply({ content: `${header}${chunks[0]}` }).catch(() => {});
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(`(continued) ${chunks[i]}`).catch(() => {});
      }
    } catch (err) {
      console.error('[recent-sr] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running recent-sr.' }); } catch {}
    }
  }
};
