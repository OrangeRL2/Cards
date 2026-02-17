// models/BossPointLog.js
const { Schema, model } = require('mongoose');

const BossPointLogSchema = new Schema({
  eventId:   { type: String, required: true, index: true },
  userId:    { type: String, required: true, index: true },
  oshiId:    { type: String, default: null },
  action:    {
    type: String,
    required: true,
    enum: ['like', 'sub', 'superchat', 'member', 'reward'],
    index: true
  },
  points:    { type: Number, default: 0 },
  meta:      { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: () => new Date() }
});

// Compound index for the common lookups
BossPointLogSchema.index({ eventId: 1, userId: 1, action: 1 });

// Enforce one like per user per event (no pre-read needed)
BossPointLogSchema.index(
  { eventId: 1, userId: 1, action: 1 },
  { unique: true, partialFilterExpression: { action: 'like' } }
);

// Optional: auto-expire old logs if you set BOSS_LOG_TTL_DAYS (e.g., 60)
if (process.env.BOSS_LOG_TTL_DAYS) {
  const days = Math.max(1, Number(process.env.BOSS_LOG_TTL_DAYS) || 2);
  BossPointLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: days * 24 * 3600 });
}

module.exports = model('BossPointLog', BossPointLogSchema);