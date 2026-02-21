// message-commands/results-lives.js
// Prefix command for claiming live results and (optionally) resending finished lives.
// Usage:
//   !results-lives
//   !results-lives --resend
//   !results-lives --resend Rin
//   !results-lives --resend --name="Rin"
//   !results-lives --resend --multi
//   !results-lives --resend --multi: true --name="Yoi"
//
// Semantics:
//   --resend            : Perform resend only if at least one live was claimed this run,
//                        and if the "button would have existed" (eligible stages).
//   --name=<text>       : Name hint for any:false stages (free text after flags also works).
//   --multi[=: true]    : Require saved options for a stage to have multi=true;
//                         otherwise that stage is skipped (no card is sent).
//
// Authorization:
//   - Only users in ALLOWED_USER_IDS or members with ALLOWED_ROLE_IDS may use this command.
//   - Configure via env or replace the arrays below.
//
// Env (optional):
// RESULTS_LIVES_ALLOWED_USER_IDS=153551890976735232,409717160995192832
// RESULTS_LIVES_ALLOWED_ROLE_IDS=987654321098765432

const { EmbedBuilder, Colors } = require('discord.js');
const User = require('../models/User');

const {
  resolveAttemptAtomic,
  getDurationForStage,
  getStageName,
  normalizeCardName,
  startAttemptAtomic
} = require('../utils/liveAsync');

// ---------- Constants ----------
const PREFIX = '!';
const COMMAND_ALIASES = ['results-lives', 'resultlives', 'results', 'result-lives'];
const STAGE_LIST = [1, 2, 3, 4, 5];
const MAX_PROCESS = 25;

/** ---------------- Authorization ---------------- */

// Read allowlists from env (optional)
const ENV_ALLOWED_USERS = (process.env.RESULTS_LIVES_ALLOWED_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ENV_ALLOWED_ROLES = (process.env.RESULTS_LIVES_ALLOWED_ROLE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Replace or append here as needed
const ALLOWED_USER_IDS = new Set([
  '153551890976735232', // e.g., your ID
  '409717160995192832',
  ...ENV_ALLOWED_USERS,
]);

const ALLOWED_ROLE_IDS = new Set([
  '844054364033384470', // e.g., Moderator role
  // '222222222222222222',
  ...ENV_ALLOWED_ROLES,
]);

/** ---------------- Targeting (run command for another user) ----------------
 * Usage:
 *   !results-lives @User [flags...]
 *   !results-lives 123456789012345678 [flags...]
 * Only callers in ALLOWED_TARGETERS may target another user.
 * Env (optional): RESULTS_LIVES_ALLOWED_TARGETERS_USER_IDS=153551890976735232,409717160995192832
 */
const ENV_ALLOWED_TARGETERS = (process.env.RESULTS_LIVES_ALLOWED_TARGETERS_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Replace or append here as needed
const ALLOWED_TARGETERS = new Set([
  '153551890976735232', // e.g., your ID
  ...ENV_ALLOWED_TARGETERS,
]);

function stripMentionToId(token) {
  return String(token || '').replace(/[<@!>]/g, '');
}


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

/** ---------------- Helpers (aligned with /resultlives) ---------------- */

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

// Simple Levenshtein (for fuzzy name matching)
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

// returns a card element or null
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

function pickRandomOwnedCard(cards, rarity, minCount = 1) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const pool = cards.filter(
    c =>
      (!rarity || String(c.rarity).toLowerCase() === String(rarity).toLowerCase()) &&
      c.count >= minCount &&
      !c.locked
  );
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// small flag parser: supports --key=value, --key: value, --flag
function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (const a of args) {
    if (a.startsWith('--')) {
      const pair = a.slice(2).split(/[:=]/); // accept ":" or "="
      const k = pair[0];
      const v = pair.length > 1 ? pair.slice(1).join(':') : undefined; // preserve any ":" in value
      if (v === undefined) {
        flags[k] = true;
      } else {
        const vt = v.toLowerCase().trim();
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

/** ------------------------------------------------------------------------- */

module.exports = {
  name: 'results-lives', // invoked as !results-lives [--resend] [--name="Rin"] [--multi] or free text name after flags
  description: 'Claims ready live attempts and shows stage statuses. Use --resend to auto-resend; add a name for any:false.',
  async execute(message, rawArgs = []) {
    try {
      if (message.author.bot) return;
      if (!message.content?.startsWith(PREFIX)) return;

      // Ensure this is the right command (avoid every file responding to any PREFIX)
      const withoutPrefix = message.content.slice(PREFIX.length).trim();
      const [cmdName, ...providedArgs] = withoutPrefix.split(/\s+/);
      if (!COMMAND_ALIASES.includes(cmdName.toLowerCase())) {
        return; // not our command
      }

      // ----- Access control -----
      if (!isAuthorized(message)) {
        return message.reply({ content: 'You are not permitted to use this command.' }).catch(() => {});
      }

      // Use providedArgs if dispatcher didn't pass rawArgs
      const args = rawArgs.length ? rawArgs : providedArgs;

    // --- Optional: allow privileged callers to run this command for another user (like pull.js) ---
    // If the first token is a mention/ID and the caller is allowed, we treat it as the target user.
    let effectiveUser = message.author;
    const callerId = String(message.author.id);
    const callerCanTarget = ALLOWED_TARGETERS.has(callerId);
    const maybeTargetToken = args[0];

    if (maybeTargetToken && callerCanTarget) {
      const idCandidate = stripMentionToId(maybeTargetToken);
      if (/^\d{17,20}$/.test(idCandidate) && idCandidate !== callerId) {
        try {
          const fetched = await message.client.users.fetch(idCandidate);
          if (fetched) {
            effectiveUser = fetched;
            // Remove the target token so flags/name parsing works normally
            args.shift();
          }
        } catch {
          // ignore invalid target
        }
      }
    }

      const { flags, rest } = parseFlags(args);
      const autoResend = Boolean(flags.resend);

      // Optional override: require multi=true in saved options to resend
      const forceMulti = Boolean(flags.multi);

      // Accept a global name hint either via --name=... or as free text (remaining tokens)
      const globalNameHintRaw =
        typeof flags.name === 'string'
          ? flags.name
          : (rest && rest.length ? rest.join(' ').trim() : '');

      // Only use name hint when --resend is present
      const globalNameHint = autoResend && globalNameHintRaw ? globalNameHintRaw : '';

      const userId = effectiveUser.id;
      const now = Date.now();

      const user = await User.findOne({ id: userId }).lean();
      if (!user) {
        // behave like slash: just report, no resend attempt when nothing was just claimed
        return message.reply({ content: effectiveUser.id === message.author.id ? 'You have no pending live attempts.' : `**${effectiveUser.username}** has no pending live attempts.` }).catch(() => {});
      }

      // ---- Build deterministic stageMap (earliest ready per stage) ----
      const stageMap = {};
      (user.pendingAttempts || []).forEach(a => {
        if (a.resolved) return;
        const s = Number(a.stage);
        const readyAt = new Date(a.readyAt).getTime();
        if (!stageMap[s] || readyAt < new Date(stageMap[s].readyAt).getTime()) {
          stageMap[s] = a;
        }
      });

      const readyAttempts = Object.values(stageMap).filter(a => new Date(a.readyAt).getTime() <= now);

      // ----- If no ready attempts, return status embed only (no resend) -----
      if (!readyAttempts.length) {
        const nextReadyTsEmpty = Object.values(stageMap)
          .map(a => new Date(a.readyAt).getTime())
          .filter(t => t > now);
        const nextReadyTextEmpty = nextReadyTsEmpty.length
          ? `<t:${Math.floor(Math.min(...nextReadyTsEmpty) / 1000)}:R>`
          : 'No pending attempts';

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

        return await message.channel.send({ embeds: [embedEmpty] }).catch(() => null);
      }

      // ----- Process ready attempts (up to MAX_PROCESS) -----
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
                // When 2 appeared:
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
          console.error('[message-commands/results-lives] resolveAttemptAtomic error:', err);
          const stageName = getStageName(att?.stage ?? 'unknown');
          results.push({
            stage: att?.stage,
            stageName,
            rarity: att?.rarity || 'unknown',
            name: att?.name ?? 'unknown',
            ok: false,
            note: 'internal error',
            points: 0
          });
        }
      }

      const moreNotice = readyAttempts.length > MAX_PROCESS
        ? `\n\n(Processed ${MAX_PROCESS} of ${readyAttempts.length} ready attempts — run again to claim the rest.)`
        : '';

      // ---- Re-fetch user to rebuild deterministic post-claim map ----
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
      const nextReadyText = nextReadyTs.length
        ? `<t:${Math.floor(Math.min(...nextReadyTs) / 1000)}:R>`
        : 'No pending attempts';

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

      await message.channel.send({ embeds: [embed] }).catch(() => {});

      // ---------- Resend logic (prefix "acts like button click") ----------
      // Gate by: user asked for --resend, AND we actually claimed something (results.length > 0),
      // AND the "button would exist" per slash logic (eligible stages > 0).
      if (autoResend && results.length > 0) {
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
        const pending = userAfter?.pendingAttempts || [];

        // Eligible stages: processed this run AND have stored options (multi/any) AND not currently occupied
        // If --multi is set, additionally require opt.multi === true.
        const eligibleStages = processedStages.filter(s => {
          const opt = lastOpts?.[`stage_${s}`];
          if (!opt || (typeof opt.any !== 'boolean' && typeof opt.multi !== 'boolean')) return false;
          if (forceMulti && opt.multi !== true) return false; // <-- new rule
          // skip if stage currently occupied (unresolved attempt exists)
          const slot = pending.find(a => !a.resolved && Number(a.stage) === Number(s));
          return !slot;
        });

        // If no eligible stages, behave as if the button didn't exist (do nothing)
        if (eligibleStages.length === 0) {
          return;
        }

        // Otherwise, perform the resend now (like clicking the button once)
        const summary = [];

        for (const s of eligibleStages) {
          const opts = lastOpts?.[`stage_${s}`];
          if (!opts) {
            continue;
          }

          const targetRarity = processedRarityMap?.[s] || null;
          const minCount = opts.multi ? 2 : 1;

          if (opts.any) {
            // random pick flow (no modal in prefix)
            const fresh = await User.findOne({ id: userId }).lean();
            const candidate = pickRandomOwnedCard(fresh?.cards || [], targetRarity, minCount);
            if (!candidate) {
              summary.push(`Stage ${s}: skipped (no matching owned card for random pick${targetRarity ? ` of rarity ${targetRarity}` : ''})`);
              continue;
            }

            let startRes;
            try {
              startRes = await startAttemptAtomic(userId, candidate.name, candidate.rarity);
            } catch (e) {
              console.error('[results-lives] startAttemptAtomic error (autoResend:any)', e);
              startRes = null;
            }

            if (startRes && startRes.success) {
              try {
                await User.updateOne(
                  { id: userId },
                  { $set: { [`lastLiveOptions.stage_${s}`]: opts } }
                ).exec();
              } catch (e) {
                console.warn('[results-lives] failed to persist lastLiveOptions on autoResend:any', e);
              }

              summary.push(`Stage ${s}: resent as [${candidate.rarity}] ${candidate.name}`);
            } else {
              const reason = startRes?.reason || 'unknown';
              summary.push(`Stage ${s}: failed to resend (${reason})`);
            }
            continue;
          }

          // any:false —> need a name hint (no modal available on prefix)
          if (!globalNameHint) {
            summary.push(`Stage ${s}: skipped (saved options require a name; provide one like \`!results-lives --resend --name="Yoi"\`)`);
            continue;
          }

          const fresh2 = await User.findOne({ id: userId }).lean();
          const candidate = findBestCardMatch(fresh2?.cards || [], globalNameHint, targetRarity, minCount);
          if (!candidate) {
            summary.push(`Stage ${s}: no matching owned card for "${globalNameHint}"${targetRarity ? ` (rarity ${targetRarity})` : ''}`);
            continue;
          }

          let startRes2;
          try {
            startRes2 = await startAttemptAtomic(userId, candidate.name, candidate.rarity);
          } catch (err) {
            console.error('[results-lives] startAttemptAtomic error (autoResend:any:false)', err);
            summary.push(`Stage ${s}: failed to resend (internal error)`);
            continue;
          }

          if (startRes2 && startRes2.success) {
            try {
              await User.updateOne(
                { id: userId },
                { $set: { [`lastLiveOptions.stage_${s}`]: opts } }
              ).exec();
            } catch (e) {
              console.warn('[results-lives] failed to persist lastLiveOptions on autoResend:any:false', e);
            }

            summary.push(`Stage ${s}: resent as [${candidate.rarity}] ${candidate.name}`);
          } else {
            const reason = startRes2?.reason || 'unknown';
            summary.push(`Stage ${s}: failed to resend (${reason})`);
          }
        }

        if (summary.length) {
          await message.channel.send({ content: summary.join('\n') }).catch(() => {});
        }
      }

    } catch (err) {
      console.error('[message-commands/results-lives] error', err);
      try { await message.reply({ content: 'An error occurred while claiming lives.' }); } catch {}
    }
  }
};