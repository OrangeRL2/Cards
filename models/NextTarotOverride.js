'use strict';

// One-time admin-selected tarot for a user's next successful Halloween login.
// Kept separate from HalUser so an ordinary login never exposes this metadata.
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  tarotNumber: { type: Number, required: true, min: 0, max: 21 },
  requestId: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.NextTarotOverride ||
  mongoose.model('NextTarotOverride', schema);
