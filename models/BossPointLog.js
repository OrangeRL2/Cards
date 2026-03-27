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

  // keep this - TTL will use it
  createdAt: { type: Date, default: () => new Date() }
});

// Compound index for the common lookups
BossPointLogSchema.index({ eventId: 1, userId: 1, action: 1 });

// Enforce one like per user per event (no pre-read needed)
BossPointLogSchema.index(
  { eventId: 1, userId: 1, action: 1 },
  { unique: true, partialFilterExpression: { action: 'like' } }
);

// ✅ Always expire after 24 hours
BossPointLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 25 } // 86400
);

module.exports = model('BossPointLog', BossPointLogSchema);