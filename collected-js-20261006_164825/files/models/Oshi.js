const { Schema, model } = require('mongoose');

const CustomImageSchema = new Schema({
  rarity: { type: String, trim: true },
  cardName: { type: String, trim: true }
}, { _id: false });

const OshiUserSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  oshiId: { type: String, required: true },
  chosenAt: { type: Date, required: true, default: () => new Date() },

  // Leveling fields
  level: { type: Number, required: true, default: 0 },
  xp: { type: Number, required: true, default: 0 },
  xpToNext: { type: Number, required: true, default: 100 },
  awards: { type: [String], default: [] },
  lastLeveledAt: { type: Date, default: null },

  // New optional override
  customImage: { type: CustomImageSchema, default: null }
}, { timestamps: true });

module.exports = model('Oshi', OshiUserSchema);
