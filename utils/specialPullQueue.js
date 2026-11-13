// FIFO special-pull grants. Remaining counts belong to each grant ID, not its
// target label, so duplicate targets and overlapping events stay independent.
const SpecialPullGrant = require('../models/SpecialPullGrant');
const PullQuotaModel = require('../models/PullQuota');
const PullQuota = require('./pullQuota');

function grantId(grant) {
  return String(grant._id);
}

function mapValue(map, key) {
  if (!map) return undefined;
  return typeof map.get === 'function' ? map.get(key) : map[key];
}

async function getActiveSpecialGrants(userId, now = new Date()) {
  return SpecialPullGrant.find({
    active: true,
    expiresAt: { $gt: now },
    $or: [
      { targetUserIds: { $exists: false } },
      { targetUserIds: { $size: 0 } },
      { targetUserIds: String(userId) },
    ],
  }).sort({ createdAt: 1, _id: 1 }).lean();
}

// Pure planner: one selected grant per displayed pack, with the required cost
// charged token-by-token in FIFO order. No partial charge on insufficient quota.
function planSpecialPulls(grants, balances, packCount, costMultiplier = 1) {
  if (!Number.isSafeInteger(packCount) || packCount < 1 ||
      !Number.isSafeInteger(costMultiplier) || costMultiplier < 1) {
    throw new Error('Invalid special pull amount');
  }
  const left = new Map(grants.map(grant => [grantId(grant),
    Math.max(0, Number(mapValue(balances, grantId(grant)) ?? grant.pullsPerUser) || 0)]));
  const debits = {};
  const packGrants = [];
  for (let pack = 0; pack < packCount; pack++) {
    for (let unit = 0; unit < costMultiplier; unit++) {
      const grant = grants.find(g => left.get(grantId(g)) > 0);
      if (!grant) return {
        success: false, packGrants: [], debits: {},
        remainingSpecial: [...left.values()].reduce((sum, n) => sum + n, 0),
      };
      if (unit === 0) packGrants.push(grant);
      const id = grantId(grant);
      left.set(id, left.get(id) - 1);
      debits[id] = (debits[id] || 0) + 1;
    }
  }
  return {
    success: true, packGrants, debits,
    remainingSpecial: [...left.values()].reduce((sum, n) => sum + n, 0),
  };
}

async function consumeSpecialPulls(userId, packCount, costMultiplier = 1, options = {}) {
  const grants = await getActiveSpecialGrants(userId);
  const { doc: initial } = await PullQuota.getUpdatedQuota(userId, options);
  const base = {
    consumedFromEvent: 0, consumedFromTimed: 0, consumedFromSpecial: 0,
    specialDebits: {}, packGrants: [],
    remainingTimed: initial?.pulls ?? 0, remainingEvent: initial?.eventPulls ?? 0,
    nextRefillInMs: null,
  };
  if (!grants.length) return { ...base, success: false, remainingSpecial: 0, reason: 'no_active_special' };
  if (!initial) return { ...base, success: false, remainingSpecial: 0, reason: 'no_quota_doc' };

  // Lazy per-user initialization. Legacy pre-deployment grants copy their old
  // label-based balance once; newly-created grants always receive their own full quota.
  for (const grant of grants) {
    const id = grantId(grant);
    const key = `specialGrantRemaining.${id}`;
    const legacy = grant.queueVersion ? undefined : mapValue(initial.specialPulls, String(grant.label));
    const starting = legacy === undefined ? grant.pullsPerUser : legacy;
    await PullQuotaModel.updateOne(
      { userId, [key]: { $exists: false } },
      { $set: { [key]: Math.max(0, Number(starting) || 0) } }
    ).exec();
  }

  const doc = await PullQuotaModel.findOne({ userId }).exec();
  if (!doc) return { ...base, success: false, remainingSpecial: 0, reason: 'no_quota_doc' };
  const plan = planSpecialPulls(grants, doc.specialGrantRemaining, packCount, costMultiplier);
  if (!plan.success) {
    const total = grants.reduce((sum, grant) => sum +
      Math.max(0, Number(mapValue(doc.specialGrantRemaining, grantId(grant))) || 0), 0);
    return { ...base, success: false, remainingSpecial: total, reason: 'no_special_remaining' };
  }

  const filter = { userId };
  const inc = {};
  for (const [id, count] of Object.entries(plan.debits)) {
    const key = `specialGrantRemaining.${id}`;
    filter[key] = { $gte: count };
    inc[key] = -count;
  }
  const updated = await PullQuotaModel.updateOne(filter, { $inc: inc }).exec();
  if (!updated.matchedCount) {
    return { ...base, success: false, remainingSpecial: null, reason: 'special_consume_conflict' };
  }
  return {
    ...base, success: true,
    consumedFromSpecial: packCount * costMultiplier,
    specialDebits: plan.debits,
    packGrants: plan.packGrants,
    remainingSpecial: plan.remainingSpecial,
    reason: null,
  };
}

async function refundSpecialPulls(userId, result) {
  const entries = Object.entries(result?.specialDebits || {});
  if (!entries.length) return;
  const inc = {};
  for (const [id, count] of entries) inc[`specialGrantRemaining.${id}`] = count;
  const updated = await PullQuotaModel.updateOne({ userId }, { $inc: inc }).exec();
  if (!updated.matchedCount) throw new Error(`Failed to refund special pulls to ${userId}`);
}

module.exports = {
  grantId, getActiveSpecialGrants, planSpecialPulls, consumeSpecialPulls, refundSpecialPulls,
};
