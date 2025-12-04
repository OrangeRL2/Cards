// models/Oshi.js
const { Schema, model } = require('mongoose');

const OshiUserSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  oshiId: { type: String, required: true },
  chosenAt: { type: Date, required: true, default: () => new Date() },

  // Leveling fields
  level: { type: Number, required: true, default: 1 },
  xp: { type: Number, required: true, default: 0 },
  xpToNext: { type: Number, required: true, default: 10 }, // will be seeded/migrated
  awards: { type: [String], default: [] }, // milestone ids awarded
  lastLeveledAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = model('Oshi', OshiUserSchema);
