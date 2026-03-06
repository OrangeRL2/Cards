// message-commands/specialpulls.js
const SpecialPullGrant = require('../models/SpecialPullGrant');
const PullQuota = require('../models/PullQuota');

const OWNER_IDS = new Set([
  '153551890976735232',
  '409717160995192832',
  '272129129841688577',
  '399012422805094410'
]);

const BATCH = 500;

// parse flags: --pulls=12 --target="suisei" [--init]
function parseFlags(content) {
  const m = content.match(/--pulls=(\d+)(?:\s+|$).*--target=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  const init = /--init\b/i.test(content);
  if (!m) return null;
  const pulls = Math.max(0, Number(m[1]));
  const rawTarget = (m[2] || m[3] || m[4] || '').trim();
  return { pulls, rawTarget, init };
}

module.exports = {
  name: 'specialpulls',
  description: 'Owner-only: create 24h special pulls for a target oshi (hard clears previous specials)',
  async execute(message) {
    try {
      console.log('[specialpulls] invoked by', message.author?.id, 'content:', message.content);

      if (!OWNER_IDS.has(message.author.id)) {
        console.log('[specialpulls] denied owner check', message.author.id);
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const parsed = parseFlags(message.content);
      if (!parsed) {
        return message.reply({ content: 'Usage: !specialpulls --pulls=12 --target="suisei" [--init]' }).catch(() => {});
      }

      const { pulls, rawTarget, init } = parsed;
      if (!rawTarget || pulls <= 0) {
        return message.reply({ content: 'Invalid target or pulls value.' }).catch(() => {});
      }

      const label = String(rawTarget).trim();
      const displayLabel = String(rawTarget).trim();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

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
        active: true
      });

      console.log('[specialpulls] created grant', {
        id: grant._id,
        label,
        pulls,
        expiresAt: expiresAt.toISOString()
      });

      await message.reply({
        content: `Created special grant "${displayLabel}" — ${pulls} pulls per user until <t:${Math.floor(expiresAt.getTime() / 1000)}:R>. (Previous specials deleted)`
      }).catch(() => {});

      // Optional: bulk initialize PullQuota docs with the new label
      // NOTE: since we wiped specialPulls above, init isn't strictly necessary,
      // but keeping it is fine if you want to prefill everyone.
      if (init) {
        await message.channel.send('Initializing PullQuota docs in batches. This may take a while...');

        const cursor = PullQuota.find().cursor();
        let ops = [];
        let total = 0;

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
    } catch (err) {
      console.error('[specialpulls] unexpected error', err);
      try {
        await message.reply({ content: 'Unexpected error running specialpulls. Check logs.' });
      } catch {}
    }
  }
};