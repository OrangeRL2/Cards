// models/Oshi.js
const { Schema, model } = require('mongoose');
const OshiUserSchema = new Schema({
	userId: { type: String, required: true, unique: true },
	oshiId: { type: String, required: true },
	chosenAt: { type: Date, required: true, default: () => new Date() },
});
module.exports = model('Oshi', OshiUserSchema);