// models/SpecialPullGrant.js
const { Schema, model } = require('mongoose');

const specialPullGrantSchema = new Schema({
  label: { type: String, required: true, index: true }, // normalized key, e.g., "suisei"
  displayLabel: { type: String, required: true },       // human friendly name
  pullsPerUser: { type: Number, required: true },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
  expiresAt: { type: Date, required: true },
  active: { type: Boolean, default: true }
}, { timestamps: false });

specialPullGrantSchema.index({ label: 1, expiresAt: 1 });

module.exports = model('SpecialPullGrant', specialPullGrantSchema);
