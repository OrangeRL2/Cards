// message-commands/specialpulls.js
const SpecialPullGrant = require('../models/SpecialPullGrant');
const PullQuota = require('../models/PullQuota');
const OWNER_IDS = new Set(['153551890976735232','409717160995192832','272129129841688577']);
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
  description: 'Owner-only: create 24h special pulls for a target oshi',
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

      // Use the rawTarget as both label and displayLabel to match settlement matching
      const label = String(rawTarget).trim();
      const displayLabel = String(rawTarget).trim();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Create grant
      const grant = await SpecialPullGrant.create({
        label,
        displayLabel,
        pullsPerUser: pulls,
        createdBy: message.author.id,
        createdAt: new Date(),
        expiresAt,
        active: true
      });

      console.log('[specialpulls] created grant', { id: grant._id, label, pulls, expiresAt: expiresAt.toISOString() });
      await message.reply({ content: `Created special grant "${displayLabel}" — ${pulls} pulls per user until <t:${Math.floor(expiresAt.getTime()/1000)}:R>.` }).catch(() => {});

      // Optional: bulk initialize existing PullQuota docs (careful with large DBs)
      if (init) {
        await message.channel.send('Initializing existing PullQuota docs in batches. This may take a while...');
        const cursor = PullQuota.find().cursor();
        let ops = [];
        let total = 0;
        for await (const doc of cursor) {
          ops.push({
            updateOne: {
              filter: { userId: doc.userId, [`specialPulls.${label}`]: { $exists: false } },
              update: { $set: { [`specialPulls.${label}`]: pulls } }
            }
          });
          if (ops.length >= BATCH) {
            await PullQuota.bulkWrite(ops, { ordered: false }).catch(e => console.error('[specialpulls] bulkWrite err', e));
            total += ops.length;
            ops = [];
          }
        }
        if (ops.length) {
          await PullQuota.bulkWrite(ops, { ordered: false }).catch(e => console.error('[specialpulls] bulkWrite err', e));
          total += ops.length;
        }
        await message.channel.send(`Initialization attempted for ${total} documents (skipped existing keys).`);
      }
    } catch (err) {
      console.error('[specialpulls] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running specialpulls. Check logs.' }); } catch {}
    }
  }
};
