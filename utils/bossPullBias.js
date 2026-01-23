// utils/bossPullBias.js
const BossEvent = require('../models/BossEvent');
const oshis = require('../config/oshis');
const config = require('../config.json');

/**
 * Return { drawToken: string|null, biased: boolean, note: string|null }
 * - Only applies when interaction.channelId === config.bossChannelId
 * - Finds most recent active BossEvent (spawnAt <= now < endsAt)
 * - 50% chance to return the oshi label as drawToken
 * - Non-fatal: returns { drawToken: null, biased: false } on error
 */
async function getBossChannelDrawToken(interaction) {
  try {
    if (!interaction || !interaction.channelId) return { drawToken: null, biased: false, note: 'no-interaction' };
    if (!config || !config.bossChannelPullId) return { drawToken: null, biased: false, note: 'no-boss-channel-config' };
    if (String(interaction.channelId).trim() !== String(config.bossChannelPullId).trim()) {
      return { drawToken: null, biased: false, note: 'not-boss-channel' };
    }

    const now = new Date();
    const ev = await BossEvent.findOne({ status: 'active', spawnAt: { $lte: now }, endsAt: { $gt: now } }).sort({ spawnAt: -1 }).lean();
    if (!ev || !ev.oshiId) return { drawToken: null, biased: false, note: 'no-active-boss' };

    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

    const biased = Math.random() < 1.0;
    if (!biased) return { drawToken: null, biased: false, note: 'coin-failed' };

    return { drawToken: String(oshiLabel), biased: true, note: 'biased-to-active-boss' };
  } catch (err) {
    console.warn('[bossPullBias] error determining boss bias', err);
    return { drawToken: null, biased: false, note: 'error' };
  }
}

module.exports = { getBossChannelDrawToken };
