// message-commands/odds.js
// Prefix command to show computed slot odds for a given userId.
//
// Supports:
// - !odds
// - !odds <id or @mention>
// - !odds --id=<id> --mode=normal --slot=rare
// - !odds idException -> show DEFAULT odds (ignore rates/overrides)
// - !odds <id> idException -> show DEFAULT odds for that id
//
// ID Exceptions (always default view):
// - If targetUserId is in DEFAULT_VIEW_USER_IDS, the command shows DEFAULT odds
//   unless you pass --force.
//
// Notes:
// - We send ONE embed per mode to avoid Discord embed field limit (<= 25).
const { EmbedBuilder, Colors } = require('discord.js');
const { getUserProfile, buildSlotOptions, getOverrides } = require('../utils/rates');

// ---------- Optional authorization ----------
// If BOTH allowlists are empty, everyone is allowed (by design).
const ENV_ALLOWED_USERS = (process.env.ODDS_ALLOWED_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ENV_ALLOWED_ROLES = (process.env.ODDS_ALLOWED_ROLE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// If you want hard default access for yourself, add your ID here:
// const ALLOWED_USER_IDS = new Set(['153551890976735232', ...ENV_ALLOWED_USERS]);
const ALLOWED_USER_IDS = new Set([...ENV_ALLOWED_USERS]);
const ALLOWED_ROLE_IDS = new Set([...ENV_ALLOWED_ROLES]);

function isAuthorized(message) {
  try {
    // If both lists are empty, allow everyone
    if (ALLOWED_USER_IDS.size === 0 && ALLOWED_ROLE_IDS.size === 0) return true;

    const callerId = String(message.author.id);
    if (ALLOWED_USER_IDS.has(callerId)) return true;

    // Role checks require guild/member context (not available in DMs)
    const member = message.member;
    if (!member || !message.guild || ALLOWED_ROLE_IDS.size === 0) return false;

    const roleCache = member.roles?.cache;
    if (!roleCache || roleCache.size === 0) return false;

    for (const rid of ALLOWED_ROLE_IDS) {
      if (roleCache.has(rid)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------- ID Exceptions (ALWAYS show default odds in this command) ----------
const DEFAULT_VIEW_USER_IDS = new Set([
  '91098889796481024', // MJ (example: always show as default in !odds)
]);

// ---------- Helpers ----------
const PREFIX = '!';
const COMMAND_ALIASES = ['odds', 'rate', 'rates', 'odds-id'];

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (const a of args) {
    if (a.startsWith('--')) {
      // accept ":" or "="
      const pair = a.slice(2).split(/[:=]/);
      const k = pair[0];
      const v = pair.length > 1 ? pair.slice(1).join(':') : undefined;

      if (v === undefined) {
        flags[k] = true;
      } else {
        const vt = String(v).toLowerCase().trim();
        if (['true', '1', 'yes', 'y'].includes(vt)) flags[k] = true;
        else if (['false', '0', 'no', 'n'].includes(vt)) flags[k] = false;
        else flags[k] = v;
      }
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function fmtNum(n, digits = 3) {
  if (!Number.isFinite(n)) return '0';
  return Number(n).toFixed(digits).replace(/\.?0+$/, '');
}

function fmtPct(n, digits = 2) {
  if (!Number.isFinite(n)) return '0%';
  return `${fmtNum(n, digits)}%`;
}

function normalizeMode(m) {
  const s = String(m || '').toLowerCase().trim();
  if (['normal', 'n'].includes(s)) return 'normal';
  if (['special', 's'].includes(s)) return 'special';
  if (['boss', 'b'].includes(s)) return 'boss';
  if (['all', 'a', 'any'].includes(s)) return 'all';
  return 'all';
}

function normalizeSlot(slot) {
  const s = String(slot || '').toLowerCase().trim();
  const allowed = new Set([
    'common1', 'common2', 'common3', 'common4',
    'uncommon1', 'uncommon2', 'uncommon3',
    'rare', 'extra',
  ]);
  if (!s) return null;
  return allowed.has(s) ? s : null;
}

function parseUserIdFromMentionOrToken(tok) {
  if (!tok) return null;
  const t = String(tok).trim();

  // <@123> or <@!123>
  const m = t.match(/^<@!?(\d+)>$/);
  if (m) return m[1];

  // raw digits
  if (/^\d{5,25}$/.test(t)) return t;

  return null;
}

function buildSlotReport({ baseOptions, rate, overrides, raw }) {
  const finalOptions = buildSlotOptions(baseOptions, rate, overrides);
  const total = finalOptions.reduce((s, o) => s + (o.weight || 0), 0) || 1;

  const lines = finalOptions.map(o => {
    const key = String(o.key);
    const w = Number(o.weight) || 0;
    const pct = (w / total) * 100;

    if (raw) {
      return `• **${key}**: ${fmtNum(w, 4)} (≈ ${fmtPct(pct, 2)} of total ${fmtNum(total, 4)})`;
    }
    return `• **${key}**: ${fmtPct(pct, 2)}`;
  });

  return { lines, total };
}

// ---------- Base slot tables (mirror your pack files) ----------
// Normal & Boss bases (same as your normal/boss pack code).
const NORMAL_BOSS_BASES = {
  common1: [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'BDAY', weight: 0.1 },
  ],
  common2: [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ],
  common3: [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 0.1 },
  ],
  common4: [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
  ],
  uncommon1: [
    { key: 'U', weight: 89.75 },
    { key: 'RR', weight: 10.0 },
    { key: 'SY', weight: 0.25 },
  ],
  uncommon2: [
    { key: 'U', weight: 96.75 },
    { key: 'SR', weight: 3.0 },
    { key: 'SY', weight: 0.25 },
  ],
  uncommon3: [
    { key: 'U', weight: 97.5 },
    { key: 'OSR', weight: 2.0 },
    { key: 'UR', weight: 0.5 },
  ],
  rare: [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ],
};

// Special bases (same as your special pack code).
const SPECIAL_BASES = {
  common1: [
    { key: 'C', weight: 93.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
    { key: 'BDAY', weight: 1.1 },
  ],
  common2: [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ],
  common3: [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 1.1 },
  ],
  common4: [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
  ],
  uncommon1: [
    { key: 'U', weight: 88.75 },
    { key: 'RR', weight: 10.0 },
    { key: 'SY', weight: 1.25 },
  ],
  uncommon2: [
    { key: 'U', weight: 95.75 },
    { key: 'SR', weight: 3.0 },
    { key: 'SY', weight: 1.25 },
  ],
  uncommon3: [
    { key: 'U', weight: 95.5 },
    { key: 'OSR', weight: 3.0 },
    { key: 'UR', weight: 1.5 },
  ],
  rare: [
    { key: 'R', weight: 99.1 },
    { key: 'OUR', weight: 0.9 },
    { key: 'SEC', weight: 0.1 },
  ],
};

// Base extra chance from your normal draw code.
const BASE_EXTRA_CHANCE = 0.02;

function modeConfig(profile, mode) {
  if (mode === 'normal') return { bases: NORMAL_BOSS_BASES, rate: profile.pullRate, overrideMode: 'normal' };
  if (mode === 'boss') return { bases: NORMAL_BOSS_BASES, rate: profile.pullRate, overrideMode: 'boss' };
  return { bases: SPECIAL_BASES, rate: profile.specialPullRate, overrideMode: 'special' };
}

function makeDefaultProfile() {
  return {
    pullRate: 1.0,
    extraSlotRate: 1.0,
    specialPullRate: 1.0,
    overrides: { normal: {}, special: {}, boss: {} },
  };
}

/**
 * IMPORTANT: do NOT leak default-view status by default.
 * showDebugLabel=true will show DEFAULT view header for authorized diagnostics.
 */
function makeEmbedHeader(profile, raw, isDefaultView, showDebugLabel = false) {
  const unclamped = BASE_EXTRA_CHANCE * (profile.extraSlotRate ?? 1);
  const clamped = clamp01(unclamped);

  return [
    (showDebugLabel && isDefaultView)
      ? `**VIEW:** DEFAULT (untouched) — ignoring user rates/overrides`
      : `**VIEW:** USER PROFILE`,
    `**pullRate:** ${fmtNum(profile.pullRate, 3)}  **specialPullRate:** ${fmtNum(profile.specialPullRate, 3)}  **extraSlotRate:** ${fmtNum(profile.extraSlotRate, 3)}`,
    `**extra slot chance:** ${fmtPct(BASE_EXTRA_CHANCE * 100, 2)} × ${fmtNum(profile.extraSlotRate ?? 1, 3)} = ${fmtPct(unclamped * 100, 2)} (clamped → ${fmtPct(clamped * 100, 2)})`,
    raw ? `*(raw: shows weights and % of total)*` : `*(shows % share within each slot)*`,
  ].join('\n');
}

module.exports = {
  name: 'odds',
  description: 'Shows computed odds (after scaling + overrides) for a given userId.',
  async execute(message, rawArgs = []) {
    try {
      if (message.author.bot) return;
      if (!message.content?.startsWith(PREFIX)) return;

      // ensure this command only responds to its aliases
      const withoutPrefix = message.content.slice(PREFIX.length).trim();
      const [cmdName, ...providedArgs] = withoutPrefix.split(/\s+/);
      if (!COMMAND_ALIASES.includes(String(cmdName || '').toLowerCase())) return;

      if (!isAuthorized(message)) {
        return message.reply({ content: 'You are not permitted to use this command.' }).catch(() => {});
      }

      const args = rawArgs.length ? rawArgs : providedArgs;
      const { flags, rest } = parseFlags(args);

      const mode = normalizeMode(flags.mode || flags.m || 'all');
      const slot = normalizeSlot(flags.slot || flags.s || null);
      const raw = Boolean(flags.raw);
      const compact = Boolean(flags.compact);

      // Optional diagnostics (does NOT change the underlying behavior, only labels/footers)
      const debugView = Boolean(flags.debug) || Boolean(flags.why);

      // keyword-based default view
      const restLower = (rest || []).map(s => String(s).toLowerCase());

      const keywordDefaultView =
        Boolean(flags.idException) ||
        Boolean(flags.default) ||
        restLower.includes('idexception') ||
        restLower.includes('default');

      // allow showing real profile even if ID is in DEFAULT_VIEW_USER_IDS
      const forceProfile =
        Boolean(flags.force) ||
        restLower.includes('force');

      // remove keywords so they don't mess with ID parsing
      const cleanedRest = (rest || []).filter(s => {
        const t = String(s).toLowerCase();
        return t !== 'idexception' && t !== 'default' && t !== 'force' && t !== 'debug' && t !== 'why';
      });

      // resolve target user id
      const idFromFlag = parseUserIdFromMentionOrToken(flags.id);
      const idFromRest = parseUserIdFromMentionOrToken(cleanedRest?.[0]);
      const targetUserId = idFromFlag || idFromRest || String(message.author.id);

      // ID-based default view
      const idDefaultView = DEFAULT_VIEW_USER_IDS.has(String(targetUserId));

      // final decision
      const isDefaultView = (keywordDefaultView || idDefaultView) && !forceProfile;

      const profile = isDefaultView ? makeDefaultProfile() : getUserProfile(targetUserId);
      const modesToShow = mode === 'all' ? ['normal', 'special', 'boss'] : [mode];

      // ONE embed per mode to avoid hitting embed field limit (<= 25).
      const embeds = modesToShow.map((m) => {
        const cfg = modeConfig(profile, m);

        const embed = new EmbedBuilder()
          .setTitle(`Odds for ${targetUserId} — ${m.toUpperCase()}`)
          // Same color always so default view is not visually obvious
          .setColor(Colors.Blurple)
          .setDescription(makeEmbedHeader(profile, raw, isDefaultView, debugView));

        const slotsToShow = slot
          ? [slot]
          : ['common1', 'common2', 'common3', 'common4', 'uncommon1', 'uncommon2', 'uncommon3', 'rare'];

        for (const slotName of slotsToShow) {
          if (slotName === 'extra') continue;

          const base = cfg.bases[slotName];
          if (!base) continue;

          // ignore overrides if default view
          const overrides = isDefaultView ? null : getOverrides(profile, cfg.overrideMode, slotName);

          const { lines, total } = buildSlotReport({
            baseOptions: base,
            rate: cfg.rate,
            overrides,
            raw
          });

          const headerBits = [`${slotName}`];

          if (!isDefaultView && overrides && Object.keys(overrides).length) {
            headerBits.push(`(override: ${Object.keys(overrides).join(', ')})`);
          }

          if (raw) headerBits.push(`(total=${fmtNum(total, 4)})`);

          embed.addFields({
            name: headerBits.join(' '),
            value: lines.join('\n').slice(0, 1024),
            inline: compact ? true : false,
          });
        }

        // extra slot appearance info (appearance only)
        if (!slot || slot === 'extra') {
          const unclamped = BASE_EXTRA_CHANCE * (profile.extraSlotRate ?? 1);
          const clamped = clamp01(unclamped);

          embed.addFields({
            name: compact ? `extra` : `extra (appearance only)`,
            value: `${fmtPct(BASE_EXTRA_CHANCE * 100, 2)} × ${fmtNum(profile.extraSlotRate ?? 1, 3)} = ${fmtPct(unclamped * 100, 2)} (clamped → ${fmtPct(clamped * 100, 2)})`,
            inline: compact ? true : false,
          });
        }

        // If debug is requested and we're defaulting, add a diagnostic footer.
        // This is still subtle; the main output stays identical otherwise.
        if (debugView && isDefaultView) {
          embed.setFooter({
            text: 'diagnostic: DEFAULT view in effect (id exception or keyword/default without --force)',
          });
        }

        return embed;
      });

      return message.channel.send({ embeds }).catch(() => null);
    } catch (err) {
      console.error('[message-commands/odds] error', err);
      try {
        return message.reply({ content: 'An error occurred while computing odds.' }).catch(() => {});
      } catch {}
    }
  },
};