const { Schema, model } = require('mongoose');

const cardInfoSchema = new Schema({
  name: { type: String, required: true },
  rarity: { type: String, required: true },
  count: { type: Number, default: 0 },
  timestamps: [{ type: Date, default: Date.now }]
}, { _id: false });

const userSchema = new Schema({
  id: { type: String, required: true, unique: true },
  pulls: { type: Number, default: 0 },
  cards: {
    type: [cardInfoSchema], // ✅ Array of card objects
    default: []
  }
});


module.exports = model('User', userSchema);
