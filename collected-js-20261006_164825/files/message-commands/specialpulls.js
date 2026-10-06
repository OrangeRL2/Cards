const SpecialPullGrant = require('../models/SpecialPullGrant');
const PullQuota = require('../models/PullQuota');

const OWNER_IDS = new Set([
  '153551890976735232',
  '409717160995192832',
  '272129129841688577',
  '399012422805094410'
]);

const BATCH = 500;

// parse flags: --pulls=12 --target="suisei" --users="123,456" --usernames="suisei,subaru" [--init]
function parseFlags(content) {
  const m = content.match(/--pulls=(\d+)(?:\s+|$).*--target=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  if (!m) return null;
  const pulls = Math.max(0, Number(m[1]));
  const rawTarget = (m[2] || m[3] || m[4] || '').trim();

  // capture --users and --usernames (optional)
  const usersMatch = content.match(/--users=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  const usernamesMatch = content.match(/--usernames=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);

  const rawUsers = usersMatch ? (usersMatch[1] || usersMatch[2] || usersMatch[3] || '') : '';
  const rawUsernames = usernamesMatch ? (usernamesMatch[1] || usernamesMatch[2] || usernamesMatch[3] || '') : '';

  const init = /--init\b/i.test(content);
  return { pulls, rawTarget, rawUsers: rawUsers.trim(), rawUsernames: rawUsernames.trim(), init };
}

module.exports = {
  name: 'specialpulls',
  description: 'Owner-only: create 24h special pulls for a target oshi. Can target specific users by ID or username.',
  async execute(message) {
    try {
      console.log('[specialpulls] invoked by', message.author?.id, 'content:', message.content);

      if (!OWNER_IDS.has(message.author.id)) {
        console.log('[specialpulls] denied owner check', message.author.id);
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const parsed = parseFlags(message.content);
      if (!parsed) {
        return message.reply({ content: 'Usage: !specialpulls --pulls=12 --target="suisei" [--users="id1,id2"] [--usernames="name1,name2"] [--init]' }).catch(() => {});
      }

      const { pulls, rawTarget, rawUsers, rawUsernames, init } = parsed;
      if (!rawTarget || pulls <= 0) {
        return message.reply({ content: 'Invalid target or pulls value.' }).catch(() => {});
      }

      const label = String(rawTarget).trim();
      const displayLabel = String(rawTarget).trim();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // ============================================================
      // Resolve targeted users to IDs if provided
      // ============================================================
      let targetUserIds = [];

      // parse explicit IDs
      if (rawUsers) {
        const ids = rawUsers.split(',').map(s => s.trim()).filter(Boolean);
        targetUserIds.push(...ids);
      }

      // resolve usernames/display names to IDs using guild members
      if (rawUsernames && message.guild) {
        const names = rawUsernames.split(',').map(s => s.trim()).filter(Boolean);
        for (const name of names) {
          // try cache first (match username or displayName case-insensitive)
          let member = message.guild.members.cache.find(m =>
            m.user.username.toLowerCase() === name.toLowerCase() ||
            (m.displayName && m.displayName.toLowerCase() === name.toLowerCase())
          );

          // if not in cache, attempt a fetch by query (may return multiple; pick best match)
          if (!member) {
            try {
              const fetched = await message.guild.members.fetch({ query: name, limit: 5 });
              if (fetched && fetched.size) {
                // prefer exact username/displayName match
                member = fetched.find(m =>
                  m.user.username.toLowerCase() === name.toLowerCase() ||
                  (m.displayName && m.displayName.toLowerCase() === name.toLowerCase())
                ) || fetched.first();
              }
            } catch (e) {
              console.warn('[specialpulls] guild.members.fetch failed for', name, e);
            }
          }

          if (member) {
            targetUserIds.push(member.user.id);
          } else {
            console.warn('[specialpulls] could not resolve username', name);
          }
        }
      }

      // dedupe IDs
      targetUserIds = Array.from(new Set(targetUserIds));

      console.log('[specialpulls] targetUserIds resolved', targetUserIds);

      // ============================================================
      // HARD CLEAR: delete ALL previous special grants + wipe quotas
      // ============================================================

      // 1) Delete all existing grants (hard delete)
      const deleted = await SpecialPullGrant.deleteMany({});
      console.log('[specialpulls] hard-cleared SpecialPullGrant docs:', { deleted: deleted.deletedCount ?? 0 });

      // 2) Wipe specialPulls in PullQuota for all users (removes old label keys)
      //    This prevents old specialPulls.<label> values from lingering forever.
      const wipe = await PullQuota.updateMany({}, { $set: { specialPulls: {} } }).exec();
      console.log('[specialpulls] wiped PullQuota.specialPulls for all users:', {
        matched: wipe.matchedCount ?? wipe.n ?? 0,
        modified: wipe.modifiedCount ?? wipe.nModified ?? 0,
      });

      // ============================================================
      // Create the new grant (the only one now)
      // ============================================================
      const grant = await SpecialPullGrant.create({
        label,
        displayLabel,
        pullsPerUser: pulls,
        createdBy: message.author.id,
        createdAt: new Date(),
        expiresAt,
        active: true,
        targetUserIds // empty array means applies to everyone
      });

      console.log('[specialpulls] created grant', {
        id: grant._id,
        label,
        pulls,
        expiresAt: expiresAt.toISOString(),
        targetCount: targetUserIds.length
      });

      // Build reply message
      let replyMsg = `Created special grant "${displayLabel}" — ${pulls} pulls per user until <t:${Math.floor(expiresAt.getTime() / 1000)}:R>.`;
      if (targetUserIds.length) {
        replyMsg += ` Targeted to ${targetUserIds.length} user(s).`;
      } else {
        replyMsg += ' Applies to all users.';
      }
      replyMsg += ' (Previous specials deleted)';

      await message.reply({ content: replyMsg }).catch(() => {});

      // Optional: bulk initialize PullQuota docs with the new label for targeted users only
      if (init) {
        await message.channel.send('Initializing PullQuota docs in batches. This may take a while...');

        let total = 0;
        let ops = [];

        if (targetUserIds.length) {
          // initialize only for the targeted user IDs
          for (const uid of targetUserIds) {
            ops.push({
              updateOne: {
                filter: { userId: uid },
                update: { $set: { [`specialPulls.${label}`]: pulls } },
                upsert: true
              }
            });

            if (ops.length >= BATCH) {
              await PullQuota.bulkWrite(ops, { ordered: false }).catch(e =>
                console.error('[specialpulls] bulkWrite err', e)
              );
              total += ops.length;
              ops = [];
            }
          }

          if (ops.length) {
            await PullQuota.bulkWrite(ops, { ordered: false }).catch(e =>
              console.error('[specialpulls] bulkWrite err', e)
            );
            total += ops.length;
          }

          await message.channel.send(`Initialization attempted for ${total} targeted documents (values set to ${pulls}).`);
        } else {
          // no specific targets, initialize for all users (existing behavior)
          const cursor = PullQuota.find().cursor();

          for await (const doc of cursor) {
            ops.push({
              updateOne: {
                filter: { userId: doc.userId },
                update: { $set: { [`specialPulls.${label}`]: pulls } }
              }
            });

            if (ops.length >= BATCH) {
              await PullQuota.bulkWrite(ops, { ordered: false }).catch(e =>
                console.error('[specialpulls] bulkWrite err', e)
              );
              total += ops.length;
              ops = [];
            }
          }

          if (ops.length) {
            await PullQuota.bulkWrite(ops, { ordered: false }).catch(e =>
              console.error('[specialpulls] bulkWrite err', e)
            );
            total += ops.length;
          }

          await message.channel.send(`Initialization attempted for ${total} documents (values set to ${pulls}).`);
        }
      }
    } catch (err) {
      console.error('[specialpulls] unexpected error', err);
      try {
        await message.reply({ content: 'Unexpected error running specialpulls. Check logs.' });
      } catch {}
    }
  }
};
