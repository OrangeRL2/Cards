// models/LevelMilestone.js
const { Schema, model } = require('mongoose');

const LevelMilestoneSchema = new Schema({
  level:        { type: Number, required: true },
  oshiId:       { type: String, default: null }, // null = global
  awardType:    { type: String, required: true }, // 'eventPulls' | 'card'
  awardValue:   { type: Schema.Types.Mixed, required: true }, // number or { poolFolder, count, rarityFilter }
  repeatEvery:  { type: Number, default: 0 }, // 0 = one-off
  oneTime:      { type: Boolean, default: true },
  enabled:      { type: Boolean, default: true },
  priority:     { type: Number, default: 0 },
  meta:         { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = model('LevelMilestone', LevelMilestoneSchema);
