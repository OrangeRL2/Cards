// models/BossEvent.js
const { Schema, model } = require('mongoose');

const BossUserStateSchema = new Schema({
  userId: { type: String, required: true, index: true },
  points: { type: Number, default: 0 },
  superchatCount: { type: Number, default: 0 },
  firstPointAt: { type: Date, default: null }
}, { _id: false });

const BossEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  oshiId: { type: String, required: true, index: true },
  imageUrl: { type: String, default: null },
  spawnAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['scheduled','active','ended','settled'], default: 'scheduled', index: true },
  pointsTotal: { type: Number, default: 0 },
  pointsByUser: { type: [BossUserStateSchema], default: [] },
  happiness: { type: Number, default: 0 },
  /** persisted announce message id so the bot can edit the announcement */
  announceMessageId: { type: String, default: null, index: true },
  boostedRarities: { type: [String], default: [] },
  createdAt: { type: Date, default: () => new Date() }
});

module.exports = model('BossEvent', BossEventSchema);
