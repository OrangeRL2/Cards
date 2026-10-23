const { Schema, model } = require('mongoose');

const StreamUserStateSchema = new Schema({
  userId: { type: String, required: true, index: true },

  // This is the user's personal contribution and is also the amount of
  // Happiness they have added to the stream.
  happiness: { type: Number, default: 0 },
  firstHappinessAt: { type: Date, default: null },

  likeHappiness: { type: Number, default: 0 },

  subCardsGifted: { type: Number, default: 0 },
  subHappiness: { type: Number, default: 0 },

  superchatCount: { type: Number, default: 0 },
  superchatFansSpent: { type: Number, default: 0 },
  superchatYenSpent: { type: Number, default: 0 },
  superchatHappiness: { type: Number, default: 0 },

  // Fractional +10% membership bonus carried between Superchats so users
  // cannot gain extra Happiness by splitting one large Superchat into many
  // small ones.
  superchatBonusRemainder: { type: Number, default: 0 },

  // Auto-membership (matching Oshi) is derived at action time and is not
  // stored here. These fields are only for membership obtained by gifting
  // a matching SEC during this stream.
  memberOshiId: { type: String, default: null },
  memberSince: { type: Date, default: null },
}, { _id: false });

const StreamEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  oshiId: { type: String, required: true, index: true },
  imageUrl: { type: String, default: null },
  spawnAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'ended', 'settling', 'settled'],
    default: 'scheduled',
    index: true,
  },

  // Global stream Happiness. No cap.
  happiness: { type: Number, default: 0 },
  users: { type: [StreamUserStateSchema], default: [] },

  announceMessageId: { type: String, default: null, index: true },
  boostedRarities: { type: [String], default: [] },

  // Optional admin/event reward overrides retained from the old stream system.
  firstPlaceOriCardName: { type: String, default: null },
  firstPlaceRewardCardName: { type: String, default: null },
  rewardOverrides: { type: Schema.Types.Mixed, default: {} },
  rewards: { type: Schema.Types.Mixed, default: {} },

  createdAt: { type: Date, default: () => new Date() },
});

StreamEventSchema.index({ eventId: 1, 'users.userId': 1 });

module.exports = model('StreamEvent', StreamEventSchema);
