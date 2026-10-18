// utils/milestones.js
const LevelMilestone = require('../models/LevelMilestone');

/**
 * Load all enabled milestones. This is simple and safe; you can add caching later.
 */
async function getAllEnabledMilestones() {
  return LevelMilestone.find({ enabled: true }).lean().exec();
}

/**
 * Determine which milestones should be granted for a given oshi and level.
 * - allMilestones: array from DB
 * - oshiId: string
 * - level: integer (the new level reached)
 * - oshiAwards: array of milestone ids already awarded (strings)
 */
function milestonesForLevel(allMilestones, oshiId, level, oshiAwards = []) {
  const candidates = allMilestones.filter(m => {
    // oshi-specific or global
    if (m.oshiId && m.oshiId !== oshiId) return false;

    // exact level or repeatEvery logic
    if (m.level === level) return true;
    if (m.repeatEvery && m.repeatEvery > 0 && level >= m.level) {
      return ((level - m.level) % m.repeatEvery) === 0;
    }
    return false;
  });

  // filter out oneTime already awarded
  return candidates.filter(m => !(m.oneTime && (oshiAwards || []).includes(String(m._id))));
}

module.exports = { getAllEnabledMilestones, milestonesForLevel };
