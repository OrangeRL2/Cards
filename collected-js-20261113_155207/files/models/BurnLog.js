// models/BurnLog.js
const { Schema, model } = require('mongoose');

const BurnLogSchema = new Schema({
  userId: { type: String, required: true },
  oshiId: { type: String, required: true },
  burned: [{ name: String, rarity: String, count: Number, xp: Number }],
  totalXp: { type: Number, required: true },

  timestamp: { type: Date, default: () => new Date() },
}, { timestamps: true });

// ✅ Auto-delete after 24 hours (86400 seconds)
BurnLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = model('BurnLog', BurnLogSchema);