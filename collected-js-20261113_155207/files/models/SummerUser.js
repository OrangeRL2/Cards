const { Schema, model, models } = require('mongoose');

const SummerUserSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true, trim: true },
  island: { type: String, enum: ['red','yellow','green','blue'], default: null, index: true },
  sunPulls: { type: Number, default: 0, min: 0 },
  summerShells: { type: Number, default: 0, min: 0 },
  welcomeShellsClaimed: { type: Boolean, default: false },
  day31TravelUnlocked: { type: Boolean, default: false },
  holodoriFirstPurchaseClaimed: { type: Boolean, default: false },
  holodoriFirstPurchaseToken: { type: String, default: null },
  activityProgress: { type: Schema.Types.Mixed, default: {} },
  storyFlags: { type: [String], default: [] },
  fusedFullArts: { type: [String], default: [] },
  shopPurchaseIds: { type: [String], default: [] },
  testing: {
    dayOverride: { type: Number, default: null, min: 1, max: 31 },
    unlockAllWindows: { type: Boolean, default: false },
  },
  stats: {
    sunPullsUsed: { type: Number, default: 0, min: 0 },
    sunCardsEarned: { type: Number, default: 0, min: 0 },
    activitiesCompleted: { type: Number, default: 0, min: 0 },
    fullArtsFused: { type: Number, default: 0, min: 0 },
    shopPurchases: { type: Number, default: 0, min: 0 },
    holodoriPacksPurchased: { type: Number, default: 0, min: 0 },
    lastSunPullAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: null },
  },
}, { timestamps: true });

module.exports = models.SummerUser || model('SummerUser', SummerUserSchema);
