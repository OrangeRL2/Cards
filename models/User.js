const { Schema, model } = require('mongoose');

const cardInfoSchema = new Schema({
  name: { type: String, required: true },
  rarity: { type: String, required: true },
  count: { type: Number, default: 0 },
  timestamps: { type: [Date], default: [] },
});

const pendingAttemptSchema = new Schema({
  // allow mongoose to create a stable _id for each attempt subdocument
  id: { type: String, required: true, index: true }, // unique attempt id supplied by code (nanoid)
  name: { type: String, required: true },
  rarity: { type: String, required: true },
  stage: { type: Number, required: true },
  startedAt: { type: Date, required: true },
  readyAt: { type: Date, required: true },
  resolved: { type: Boolean, default: false },
  success: { type: Boolean, default: null },
  effectsApplied: { type: Boolean, default: false },
  effectsTrace: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: false }); // keep subdocument timestamps off

const userSchema = new Schema({
  id: { type: String, required: true, unique: true },
  pulls: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  cards: { type: [cardInfoSchema], default: [] },
  liveCooldowns: {
    stage_1: { type: Date, default: null },
    stage_2: { type: Date, default: null },
    stage_3: { type: Date, default: null },
    stage_4: { type: Date, default: null },
    stage_5: { type: Date, default: null },
  },
  pendingAttempts: { type: [pendingAttemptSchema], default: [] },
}, { timestamps: true });

// Optional: create an index to help find unresolved attempts quickly
// Note: MongoDB doesn't support unique constraints on array subdocuments across documents easily.
// This index helps queries for unresolved attempts per user.
userSchema.index({ id: 1, 'pendingAttempts.id': 1 });

module.exports = model('User', userSchema);
