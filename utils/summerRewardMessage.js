const messageConfig = require('../config/summer-reward-messages.json');

function pickRandom(items, rng = Math.random) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items[Math.floor(rng() * items.length)] || items[0] || '';
}

function getMessageKey(reward = {}) {
  if (reward.type === 'shells') return `shells_${Number(reward.amount || 0)}`;
  if (reward.type === 'sunPulls') return 'sun_pull';
  if (reward.type === 'sunCard') return 'sun_card';
  return 'fallback';
}

function replaceTokens(text, values) {
  return String(text || '').replace(/\{(member|amount|reward|activity|route)\}/g, (_, key) => {
    const value = values[key];
    return value === undefined || value === null || value === '' ? `{${key}}` : String(value);
  });
}

function buildRewardPresentation(reward = {}, context = {}, rng = Math.random) {
  const key = getMessageKey(reward);
  const entry = messageConfig[key] || messageConfig.fallback || {};
  const amount = Number(reward.amount || 1);
  const rewardLabel = reward.type === 'shells'
    ? `${amount} Summer Shells`
    : reward.type === 'sunPulls'
      ? `${amount} SUN Pull${amount === 1 ? '' : 's'}`
      : reward.type === 'sunCard'
        ? `[SUN] ${reward.name || 'Card'}`
        : 'Reward';

  const values = {
    member: reward.name || context.member || '',
    amount,
    reward: rewardLabel,
    activity: context.activity || '',
    route: context.route || '',
  };

  return {
    key,
    title: replaceTokens(entry.title || 'SUCCESS!', values),
    emoji: entry.emoji || '🎁',
    color: Number(entry.color || 0xf4c542),
    message: replaceTokens(pickRandom(entry.messages, rng), values),
    rewardLabel,
  };
}

module.exports = {
  messageConfig,
  getMessageKey,
  buildRewardPresentation,
};
