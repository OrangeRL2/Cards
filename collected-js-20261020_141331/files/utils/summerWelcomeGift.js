const SummerUser = require('../models/SummerUser');

const WELCOME_SHELLS = 100;

async function grantSummerWelcomeGift(userId) {
  const result = await SummerUser.findOneAndUpdate(
    {
      userId: String(userId),
      island: { $ne: null },
      welcomeShellsClaimed: { $ne: true },
    },
    {
      $set: { welcomeShellsClaimed: true },
      $inc: { summerShells: WELCOME_SHELLS },
    },
    { new: true }
  ).lean().exec();

  return {
    granted: Boolean(result),
    amount: result ? WELCOME_SHELLS : 0,
    summerUser: result || null,
  };
}

module.exports = {
  WELCOME_SHELLS,
  grantSummerWelcomeGift,
};
