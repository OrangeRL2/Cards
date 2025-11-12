// models/Trade.js
const { Schema, model } = require('mongoose');

const tradeItemSchema = new Schema({
  name:   { type: String, required: true },
  rarity: { type: String, required: true },
  count:  { type: Number, required: true, min: 1 },
}, { _id: false });

const tradeSchema = new Schema({
  from:      { type: String, required: true },      // Discord ID
  to:        { type: String, required: true },      // Discord ID
  offered:   { type: [tradeItemSchema], default: [] },
  requested: { type: [tradeItemSchema], default: [] },
  status: {
    type: String,
    enum: ['pending','accepted','rejected'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = model('Trade', tradeSchema);
