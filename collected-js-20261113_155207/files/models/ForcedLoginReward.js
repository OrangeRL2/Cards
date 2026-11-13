// Persistent, one-use admin selection for the next successful /login HOLODORI card.
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  member: { type: String, required: true },
  requestId: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.ForcedLoginReward ||
  mongoose.model('ForcedLoginReward', schema);
