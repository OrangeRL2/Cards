const { Schema, model } = require('mongoose');

const cardInfoSchema = new Schema({
  name: { type: String, required: true },
  rarity: { type: String, required: true },
  count: { type: Number, default: 0 },
  timestamps: { type: [Date], default: [] },
}, { _id: false });

const pendingAttemptSchema = new Schema({
  id: { type: String, required: true },           // unique id for this attempt (UUID or nanoid)
  name: { type: String, required: true },         // card name sent
  rarity: { type: String, required: true },       // rarity sent
  stage: { type: Number, required: true },        // stage number (1..5)
  startedAt: { type: Date, required: true },
  readyAt: { type: Date, required: true },        // when result is available
  resolved: { type: Boolean, default: false },    // whether result has been collected
  success: { type: Boolean, default: null },      // null until resolved, then true/false
}, { _id: false });

const userSchema = new Schema({
  id: { type: String, required: true, unique: true },
  pulls: { type: Number, default: 0 },
  cards: { type: [cardInfoSchema], default: [] },
  liveCooldowns: {                     // you can keep this if you still want per-stage cooldown metadata
    stage_1: { type: Date, default: null },
    stage_2: { type: Date, default: null },
    stage_3: { type: Date, default: null },
    stage_4: { type: Date, default: null },
    stage_5: { type: Date, default: null },
  },
  pendingAttempts: { type: [pendingAttemptSchema], default: [] },
}, { timestamps: true });

module.exports = model('User', userSchema);
