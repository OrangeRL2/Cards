// models/TradeListing.js
const { Schema, model } = require('mongoose');

const wantedItemSchema = new Schema({
  type: { type: String, enum: ['specific', 'any_rarity', 'any_name'], required: true },
  rarity: String, // Required for 'specific' and 'any_rarity'
  name: String,   // Required for 'specific' and 'any_name'
  priority: { type: Number, default: 1 } // 1=highest priority
});

const tradeListingSchema = new Schema({
  userId: { type: String, required: true },
  username: { type: String, required: true },
  offering: [{
    name: { type: String, required: true },
    rarity: { type: String, required: true },
    count: { type: Number, default: 1 }
  }],
  wanted: [wantedItemSchema],
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } // 7 days
});

module.exports = model('TradeListing', tradeListingSchema);
