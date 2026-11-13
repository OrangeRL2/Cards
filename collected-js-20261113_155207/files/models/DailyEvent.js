// models/DailyEvent.js
const { Schema, model } = require('mongoose');

const DailyEventSchema = new Schema({
  key: { type: String, required: true, unique: true }, // e.g. "2025-11-11:pekora"
  date: { type: String, required: true },               // e.g. "2025-11-11" (JST date string)
  oshiId: { type: String, required: true },
  grantedAt: { type: Date, required: true, default: () => new Date() },
  grantsCount: { type: Number, required: true, default: 0 },
}, { timestamps: true });

module.exports = model('DailyEvent', DailyEventSchema);
