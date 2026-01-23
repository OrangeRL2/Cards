// models/BossPointLog.js
const { Schema, model } = require('mongoose');

const BossPointLogSchema = new Schema({
  eventId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  oshiId: { type: String, default: null },
  // include reward in the enum
  action: {
    type: String,
    required: true,
    enum: ['like', 'sub', 'superchat', 'member', 'reward'], // <-- added 'reward'
    index: true
  },
  points: { type: Number, default: 0 },
  meta: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: () => new Date() }
});

module.exports = model('BossPointLog', BossPointLogSchema);
