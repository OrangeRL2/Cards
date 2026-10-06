const { Schema, model } = require('mongoose');

const guessChallengeSchema = new Schema({
  challengeId: { type: String, required: true, unique: true, index: true },
  channelId: { type: String, required: true, index: true },
  guildId: { type: String, required: true },
  messageId: { type: String, default: null },
  mode: { type: String, enum: ['jacket', 'song', 'holomem'], required: true },
  answerId: { type: String, required: true },
  answerName: { type: String, required: true },
  revealUrl: { type: String, default: null },
  active: { type: Boolean, default: true, index: true },
  spawnedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  winnerId: { type: String, default: null },
  reward: {
    rarity: { type: String, default: null },
    name: { type: String, default: null },
    signed: { type: Boolean, default: false },
  },
}, { timestamps: true });

guessChallengeSchema.index({ active: 1, channelId: 1 });
guessChallengeSchema.index({ winnerId: 1, resolvedAt: -1 });

module.exports = model('GuessChallenge', guessChallengeSchema);
