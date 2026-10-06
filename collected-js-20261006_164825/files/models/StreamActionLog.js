const { Schema, model } = require('mongoose');

const StreamActionLogSchema = new Schema({
  eventId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  oshiId: { type: String, default: null },
  action: {
    type: String,
    required: true,
    enum: ['like', 'sub', 'superchat', 'member', 'reward'],
    index: true,
  },
  happiness: { type: Number, default: 0 },
  meta: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: () => new Date() },
});

StreamActionLogSchema.index({ eventId: 1, userId: 1, action: 1 }, { name: 'stream_action_lookup' });

// One Like per user per stream.
StreamActionLogSchema.index(
  { eventId: 1, userId: 1, action: 1 },
  { name: 'stream_unique_like', unique: true, partialFilterExpression: { action: 'like' } }
);

// One manual SEC membership activation per user per stream.
StreamActionLogSchema.index(
  { eventId: 1, userId: 1, action: 1 },
  { name: 'stream_unique_member', unique: true, partialFilterExpression: { action: 'member' } }
);

// Streams last 24 hours; keep logs long enough for settlement/results, then
// let MongoDB clean them automatically.
StreamActionLogSchema.index(
  { createdAt: 1 },
  { name: 'stream_action_ttl', expireAfterSeconds: 60 * 60 * 25 }
);

module.exports = model('StreamActionLog', StreamActionLogSchema);
