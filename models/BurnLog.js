// models/BurnLog.js
const { Schema, model } = require('mongoose');

const BurnLogSchema = new Schema({
  userId: { type: String, required: true },
  oshiId: { type: String, required: true },
  burned: [{ name: String, rarity: String, count: Number, xp: Number }],
  totalXp: { type: Number, required: true },
  timestamp: { type: Date, default: () => new Date() },
}, { timestamps: true });

module.exports = model('BurnLog', BurnLogSchema);
