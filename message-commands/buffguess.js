const guessManager = require('../jobs/guessManager');

module.exports = {
  name: 'buffguess',
  description: 'Privately buff the current or next Guess in this channel (owner only).',
  async execute(message, args = []) {
    if (String(message.author?.id) !== '153551890976735232') return;
    const tokens = Array.isArray(args) ? args : String(message.content || '').trim().split(/\s+/).slice(1);
    await guessManager.buffGuess(message, { signed: tokens.includes('--sign') });
  },
};
