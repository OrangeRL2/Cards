// models/PullLock.js
const { Schema, model } = require('mongoose');

const pullLockSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    owner:  { type: String, required: true },              // interaction.id
    until:  { type: Date,   required: true },              // lock expiry (TTL index defined below)
  },
  { timestamps: false }
);

// TTL cleanup when 'until' is in the past
pullLockSchema.index({ until: 1 }, { expireAfterSeconds: 0 });

module.exports = model('PullLock', pullLockSchema, 'pull_locks');