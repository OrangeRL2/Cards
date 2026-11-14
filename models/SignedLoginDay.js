'use strict';
// Global date-limited login bonus. A matching JST date is required to apply it.
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  dayJST: { type: String, required: true, unique: true },
  createdBy: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.models.SignedLoginDay ||
  mongoose.model('SignedLoginDay', schema);
