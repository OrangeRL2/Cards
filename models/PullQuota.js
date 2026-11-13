const { Schema, model } = require('mongoose');

const PullQuotaSchema = new Schema({
  userId:     { type: String, required: true, unique: true },
  pulls:      { type: Number, required: true, default: 6 },
  lastRefill: { type: Date,   required: true, default: () => new Date() },
  eventPulls: { type: Number, required: true, default: 0 },
  lastBirthdayGivenAt: { type: Date, required: false }, // new: last time birthday bonus was applied
  specialPulls: { type: Map, of: Number, default: {} }, // legacy; kept for existing consumers
  specialGrantRemaining: { type: Map, of: Number, default: {} }, // grant ID -> individual balance
  lastSpecialGivenAt: { type: Date }, // optional: track when special was first given
  pausedRemainingMs: { type: Number, default: null }
}, { timestamps: true });

module.exports = model('PullQuota', PullQuotaSchema);
