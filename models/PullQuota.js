const { Schema, model } = require('mongoose');

const PullQuotaSchema = new Schema({
  userId:     { type: String, required: true, unique: true },
  pulls:      { type: Number, required: true, default: 6 },
  lastRefill: { type: Date,   required: true, default: () => new Date() },
  eventPulls: { type: Number, required: true, default: 0 },
  lastBirthdayGivenAt: { type: Date, required: false }, // new: last time birthday bonus was applied
}, { timestamps: true });

module.exports = model('PullQuota', PullQuotaSchema);
