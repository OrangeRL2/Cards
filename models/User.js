const { Schema, model } = require('mongoose');

const cardInfoSchema = new Schema({
  count:  { type: Number, default: 0 },
  rarity: { type: String, required: true },
  timestamps:[{ type: Date, default: Date.now }]
}, { _id: false });

const userSchema = new Schema({
  id:    { type: String, required: true, unique: true },
  pulls: { type: Number, default: 0 },
  cards: {
    type:    Map,
    of:      cardInfoSchema,  // ← must reference the embedded schema
    default: {}
  }
});

module.exports = model('User', userSchema);
