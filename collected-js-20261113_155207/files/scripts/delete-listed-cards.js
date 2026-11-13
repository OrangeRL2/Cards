// scripts/delete-listed-cards.js
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { mongoUri } = require("../config.json");
const User = require("../models/User");

/**
 * Deletes specific cards from every user's inventory, and logs which user IDs had what removed.
 *
 * Input format (one per line):
 *   [RARITY] Card Name ... :emoji: (count)
 *
 * Example:
 *   [SR] MiKorone 001 :typo: (1)
 *
 * Ignores:
 *   - anything after " :"
 *   - trailing "(...)"
 *   - " :: ..." if present
 *
 * Usage:
 *   node scripts/delete-listed-cards.js
 *
 * Options:
 *   LIST_FILE=./scripts/delete-cards-list.txt node scripts/delete-listed-cards.js
 *   OUT_FILE=./removed-cards-report.json node scripts/delete-listed-cards.js
 *   OUT_TXT=./removed-cards-report.txt node scripts/delete-listed-cards.js
 *   DRY_RUN=1 node scripts/delete-listed-cards.js
 *   ONLY_USER_ID=153551890976735232 node scripts/delete-listed-cards.js
 *   CASE_INSENSITIVE=1 node scripts/delete-listed-cards.js  (slower)
 */

const LIST_FILE = process.env.LIST_FILE || path.join(__dirname, "delete-cards-list.txt");
const OUT_FILE = process.env.OUT_FILE || path.join(process.cwd(), `removed-cards-report.${Date.now()}.json`);
const OUT_TXT = process.env.OUT_TXT || "";
const DRY_RUN = !!process.env.DRY_RUN;
const ONLY_USER_ID = process.env.ONLY_USER_ID || null;
const CASE_INSENSITIVE = !!process.env.CASE_INSENSITIVE;

function decodeEntities(s) {
  return String(s)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a line like:
 *   [OC] Flare 002 :yellow: (1)
 * into:
 *   { rarity: "OC", name: "Flare 002" }
 */
function parseLine(raw) {
  let line = decodeEntities(raw).trim();
  if (!line) return null;

  // Must start with [RARITY]
  const m = line.match(/^\s*\[([A-Za-z0-9]+)\]\s*(.+?)\s*$/);
  if (!m) return null;

  const rarity = m[1].trim();
  let rest = m[2].trim();

  // Remove " :: ..." if present (you said ignore ::)
  rest = rest.split("::")[0].trim();

  // Remove trailing "(...)" count
  rest = rest.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // Remove emoji segment " :xxx:" and anything after it
  rest = rest.split(" :")[0].trim();

  // Collapse whitespace
  rest = rest.replace(/\s+/g, " ").trim();

  if (!rarity || !rest) return null;
  return { rarity, name: rest };
}

function dedupeTargets(targets) {
  const m = new Map();
  for (const t of targets) m.set(`${t.rarity}||${t.name}`, t);
  return Array.from(m.values());
}

/**
 * Build $or match conditions for aggregation.
 * If CASE_INSENSITIVE=1, uses regex for name match.
 */
function buildOrConditions(targets) {
  if (!CASE_INSENSITIVE) {
    return targets.map(t => ({ "cards.rarity": t.rarity, "cards.name": t.name }));
  }
  return targets.map(t => ({
    "cards.rarity": t.rarity,
    "cards.name": { $regex: new RegExp(`^${escapeRegex(t.name)}$`, "i") }
  }));
}

/**
 * Aggregation that finds exactly what will be removed:
 * - groups by userId + rarity + name
 * - sums count and counts how many entries exist
 */
async function computeRemovalPlan(targets) {
  const orConds = buildOrConditions(targets);
  if (orConds.length === 0) return { byUser: [], totals: { users: 0, uniqueCards: 0, totalEntries: 0, totalCount: 0 } };

  // If $or is huge, chunk it (usually your list is small/medium)
  const CHUNK = 300; // safe chunk size
  const chunks = [];
  for (let i = 0; i < orConds.length; i += CHUNK) chunks.push(orConds.slice(i, i + CHUNK));

  const perChunkResults = [];

  for (const conds of chunks) {
    const pipeline = [
      ...(ONLY_USER_ID ? [{ $match: { id: ONLY_USER_ID } }] : []),
      { $unwind: "$cards" },
      { $match: { $or: conds } },
      {
        $group: {
          _id: { userId: "$id", rarity: "$cards.rarity", name: "$cards.name" },
          entries: { $sum: 1 },
          totalCount: { $sum: { $ifNull: ["$cards.count", 1] } },
          subIds: { $addToSet: "$cards._id" }
        }
      }
    ];

    const rows = await User.aggregate(pipeline).allowDiskUse(true).exec();
    perChunkResults.push(...rows);
  }

  // Merge duplicates across chunks (same key)
  const merged = new Map();
  for (const r of perChunkResults) {
    const key = `${r._id.userId}||${r._id.rarity}||${r._id.name}`;
    if (!merged.has(key)) {
      merged.set(key, {
        userId: r._id.userId,
        rarity: r._id.rarity,
        name: r._id.name,
        entries: r.entries || 0,
        totalCount: r.totalCount || 0,
        subIds: r.subIds || []
      });
    } else {
      const cur = merged.get(key);
      cur.entries += (r.entries || 0);
      cur.totalCount += (r.totalCount || 0);
      cur.subIds = Array.from(new Set([...(cur.subIds || []), ...(r.subIds || [])]));
      merged.set(key, cur);
    }
  }

  // Group by user for report
  const byUserMap = new Map();
  let totalEntries = 0;
  let totalCount = 0;

  for (const item of merged.values()) {
    totalEntries += item.entries;
    totalCount += item.totalCount;

    if (!byUserMap.has(item.userId)) {
      byUserMap.set(item.userId, { userId: item.userId, removedCards: [] });
    }
    byUserMap.get(item.userId).removedCards.push({
      rarity: item.rarity,
      name: item.name,
      entries: item.entries,
      totalCount: item.totalCount,
      subIds: item.subIds
    });
  }

  const byUser = Array.from(byUserMap.values()).sort((a, b) => (b.removedCards.length - a.removedCards.length));

  return {
    byUser,
    totals: {
      users: byUser.length,
      uniqueCards: merged.size,
      totalEntries,
      totalCount
    }
  };
}

async function main() {
  if (!fs.existsSync(LIST_FILE)) {
    throw new Error(`List file not found: ${LIST_FILE}`);
  }

  const rawLines = fs.readFileSync(LIST_FILE, "utf8").split(/\r?\n/);
  const parsed = dedupeTargets(rawLines.map(parseLine).filter(Boolean));

  console.log(`Loaded list file: ${LIST_FILE}`);
  console.log(`Parsed targets: ${parsed.length}`);
  console.log(`Mode: ${DRY_RUN ? "DRY_RUN (no writes)" : "LIVE (will delete)"}`);
  console.log(`Scope: ${ONLY_USER_ID ? `ONLY_USER_ID=${ONLY_USER_ID}` : "ALL USERS"}`);
  console.log(`Matching: ${CASE_INSENSITIVE ? "case-insensitive" : "exact"}`);

  const mongoURI = process.env.MONGODB_URI || mongoUri;
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");

  try {
    console.log("\nComputing removal plan (who has what)...");
    const plan = await computeRemovalPlan(parsed);

    const report = {
      generatedAt: new Date().toISOString(),
      listFile: LIST_FILE,
      dryRun: DRY_RUN,
      onlyUserId: ONLY_USER_ID,
      caseInsensitive: CASE_INSENSITIVE,
      targets: parsed,
      totals: plan.totals,
      results: plan.byUser
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");
    console.log(`Report written: ${OUT_FILE}`);
    console.log(`Will remove from users: ${plan.totals.users}`);
    console.log(`Unique (user,rarity,name) matches: ${plan.totals.uniqueCards}`);
    console.log(`Total matching card entries: ${plan.totals.totalEntries}`);
    console.log(`Total matching count sum: ${plan.totals.totalCount}`);

    if (OUT_TXT) {
      const lines = [];
      lines.push(`generatedAt: ${report.generatedAt}`);
      lines.push(`targets: ${parsed.length}`);
      lines.push(`usersAffected: ${plan.totals.users}`);
      lines.push(`totalEntries: ${plan.totals.totalEntries}`);
      lines.push(`totalCountSum: ${plan.totals.totalCount}`);
      lines.push("");
      for (const u of plan.byUser) {
        lines.push(`User ${u.userId}:`);
        for (const c of u.removedCards) {
          lines.push(`  [${c.rarity}] ${c.name}  entries=${c.entries}  countSum=${c.totalCount}`);
        }
        lines.push("");
      }
      fs.writeFileSync(OUT_TXT, lines.join("\n"), "utf8");
      console.log(`TXT summary written: ${OUT_TXT}`);
    }

    if (DRY_RUN) {
      console.log("\nDRY_RUN: no deletion performed.");
      return;
    }

    console.log("\nDeleting cards...");
    const ops = [];

    for (const { rarity, name } of parsed) {
      const filter = {
        cards: { $elemMatch: { rarity } }
      };
      if (ONLY_USER_ID) filter.id = ONLY_USER_ID;

      let pullCond;
      if (CASE_INSENSITIVE) {
        const rx = new RegExp(`^${escapeRegex(name)}$`, "i");
        filter.cards.$elemMatch.name = { $regex: rx };
        pullCond = { rarity, name: { $regex: rx } };
      } else {
        filter.cards.$elemMatch.name = name;
        pullCond = { rarity, name };
      }

      ops.push({
        updateMany: {
          filter,
          update: { $pull: { cards: pullCond } }
        }
      });
    }

    const res = await User.bulkWrite(ops, { ordered: false });
    console.log("\n=== Delete Completed ===");
    console.log({
      matchedCount: res.matchedCount,
      modifiedCount: res.modifiedCount
    });

    console.log(`\nDone. See report: ${OUT_FILE}`);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error("Delete script failed:", err);
    process.exit(1);
  });
}