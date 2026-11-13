// Compatibility shim for existing pull commands.
// The filename/export stays the same so pull.js / multi-pull.js do not need
// to change immediately, but the active event source is now StreamEvent.
const StreamEvent = require('../models/StreamEvent');
const oshis = require('../config/oshis');
const config = require('../config.json');

async function getBossChannelDrawToken(interaction) {
  try {
    if (!interaction?.channelId) return { drawToken: null, biased: false, note: 'no-interaction' };
    if (!config?.bossChannelPullId) return { drawToken: null, biased: false, note: 'no-boss-channel-config' };
    if (String(interaction.channelId).trim() !== String(config.bossChannelPullId).trim()) {
      return { drawToken: null, biased: false, note: 'not-boss-channel' };
    }

    const now = new Date();
    const ev = await StreamEvent.findOne({
      status: 'active',
      spawnAt: { $lte: now },
      endsAt: { $gt: now },
    }).sort({ spawnAt: -1 }).lean();

    if (!ev?.oshiId) return { drawToken: null, biased: false, note: 'no-active-stream' };
    const cfg = oshis.find(o => o.id === ev.oshiId);
    const drawToken = cfg ? cfg.label : ev.oshiId;
    return { drawToken: String(drawToken), biased: true, note: 'biased-to-active-stream' };
  } catch (err) {
    console.warn('[streamPullBias] error determining stream bias', err);
    return { drawToken: null, biased: false, note: 'error' };
  }
}

module.exports = { getBossChannelDrawToken };
