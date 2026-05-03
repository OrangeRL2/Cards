// scripts/fix-card-names-by-rarity.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { mongoUri } = require("../config.json");
const User = require("../models/User");

/**
 * Rename card names in user inventories using a mapping file.
 *
 * ✅ Supports arrows in mapping file:
 *   - "A -> B" and "A <-> B"
 *   - "A -&gt; B" and "A &lt;-&gt; B"
 *   - "A -\> B" and "A \<-\> B" (backslash-escaped style) [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
 *
 * ✅ Safe against chain-cascade via 2-phase rename:
 *   Phase 1: FROM -> TEMP
 *   Phase 2: TEMP -> TO
 *
 * ✅ Scope:
 *   - No ONLY_USER_ID  => all users
 *   - ONLY_USER_ID=... => only that user
 *
 * ✅ Duplicate merge:
 *   - Merges duplicate entries with same (rarity + name) after renames
 *   - Skipped in DRY_RUN (by design)
 *
 * Usage:
 *   node scripts/fix-card-names-by-rarity.js
 *
 * Common options:
 *   MAP_FILE=./scripts/card-name-map.txt node scripts/fix-card-names-by-rarity.js
 *   DRY_RUN=1 node scripts/fix-card-names-by-rarity.js
 *   ONLY_USER_ID=153551890976735232 node scripts/fix-card-names-by-rarity.js
 *   BATCH_SIZE=500 node scripts/fix-card-names-by-rarity.js
 *   STRICT_HEADERS=1 node scripts/fix-card-names-by-rarity.js
 *   MERGE_DUPES=0 node scripts/fix-card-names-by-rarity.js
 */

const MAP_FILE = process.env.MAP_FILE || path.join(__dirname, "card-name-map.txt");
const DRY_RUN = !!process.env.DRY_RUN;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "500", 10);
const STRICT_HEADERS = !!process.env.STRICT_HEADERS;
const ONLY_USER_ID = process.env.ONLY_USER_ID || null;
const MERGE_DUPES = process.env.MERGE_DUPES ? process.env.MERGE_DUPES !== "0" : true;

const KNOWN_RARITIES = new Set([
  "BDAY","C","COL","EAS","HR","OC","ORI","OSR","OUR","P","R","RR","S","SEC","SP","SR","SY","U","UP","UR","VAL","XMAS"
]);

function decodeEntities(s) {
  // Decode common HTML entities (safe if none exist)
  return String(s)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function normalizeLine(raw) {
  return decodeEntities(raw)
    .replace(/\u00A0/g, " ") // NBSP -> space
    .replace(/\u200B/g, "")  // zero-width -> removed
    .trim();
}

function extractHeader(line) {
  const cleaned = normalizeLine(line).replace(/^#+\s*/, "").trim();
  const m = cleaned.match(/^([A-Z0-9]{1,10})\b/);
  if (!m) return null;
  const token = m[1].toUpperCase();
  if (STRICT_HEADERS) return KNOWN_RARITIES.has(token) ? token : null;
  return token;
}

function normalizeArrowLine(rawLine) {
  // Normalize to canonical "->" and "<->"
  let s = normalizeLine(rawLine);

  // Backslash-escaped style: -\> and \<-\> [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
  s = s
    .replaceAll("\\<\\-\\>", "<->")  // \<-\>
    .replaceAll("<\\-\\>", "<->")    // safety
    .replaceAll("-\\>", "->")        // -\>
    .replaceAll("\\->", "->");       // safety

  // Unicode arrows
  s = s.replaceAll("→", "->").replaceAll("↔", "<->");

  // After decodeEntities(), "-&gt;" becomes "->" and "&lt;-&gt;" becomes "<->" automatically.
  // Normalize whitespace around arrows:
  s = s.replace(/\s*->\s*/g, "->").replace(/\s*<->\s*/g, "<->");

  return s.trim();
}

function makeTempName(rarity, from) {
  const h = crypto.createHash("sha1").update(`${rarity}::${from}`).digest("hex").slice(0, 12);
  return `__MIG__${rarity}__${h}__`;
}

/**
 * Parse mapping file into rules:
 *   rules[rarity] = Array<{from, to}>
 *
 * Rules:
 * - Ignore FROM === "NEW"
 * - Swaps "A <-> B" become two directed rules A->B and B->A
 * - Detect conflict: same FROM mapping to two different TO within same rarity (throws)
 */
function parseMapFile(text) {
  const lines = String(text).split(/\r?\n/).map(normalizeArrowLine);

  const rules = {};
  const seen = new Map(); // key: `${rarity}||${from}` -> to
  let current = null;

  const addRule = (rarity, from, to) => {
    if (!from || !to) return;
    if (from === "NEW") return; // ignore literal NEW as requested previously

    const key = `${rarity}||${from}`;
    if (seen.has(key) && seen.get(key) !== to) {
      throw new Error(
        `Conflicting mapping in rarity "${rarity}": "${from}" maps to BOTH "${seen.get(key)}" and "${to}". Fix the map file.`
      );
    }
    seen.set(key, to);
    rules[rarity].push({ from, to });
  };

  for (const line of lines) {
    if (!line) continue;

    // header line?
    const header = extractHeader(line);
    if (header && !line.includes("->") && !line.includes("<->")) {
      current = header;
      if (!rules[current]) rules[current] = [];
      continue;
    }
    if (!current) continue;

    // ignore lines without arrows (comments)
    if (!line.includes("->") && !line.includes("<->")) continue;

    if (line.includes("<->")) {
      const [a, b] = line.split("<->").map(x => x.trim());
      if (!a || !b) continue;
      if (a === "NEW" || b === "NEW") continue;
      addRule(current, a, b);
      addRule(current, b, a);
      continue;
    }

    if (line.includes("->")) {
      const [from, to] = line.split("->").map(x => x.trim());
      addRule(current, from, to);
      continue;
    }
  }

  return rules;
}

function buildUpdateOp(rarity, from, to) {
  const filter = {
    cards: { $elemMatch: { rarity, name: from } }
  };
  if (ONLY_USER_ID) filter.id = ONLY_USER_ID;

  return {
    updateMany: {
      filter,
      update: { $set: { "cards.$[c].name": to } },
      arrayFilters: [{ "c.rarity": rarity, "c.name": from }]
    }
  };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runBulkBatches(ops) {
  const batches = chunk(ops, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (DRY_RUN) {
      // In DRY_RUN we don't write. This is a rough estimate of how many user docs would match.
      let approx = 0;
      for (const op of batch) {
        approx += await User.countDocuments(op.updateMany.filter);
      }
      console.log(`[DRY_RUN] Batch ${i + 1}/${batches.length}: approx matching user docs = ${approx}`);
      continue;
    }

    const res = await User.bulkWrite(batch, { ordered: false });
    console.log(`Batch ${i + 1}/${batches.length}: matched=${res.matchedCount || 0}, modified=${res.modifiedCount || 0}`);
  }
}

/**
 * Merge duplicates within ONE user:
 * Same (rarity + name) -> single entry:
 * - count = sum
 * - locked = OR
 * - firstAcquiredAt = min
 * - lastAcquiredAt  = max
 * - keeps the first subdoc _id
 */
async function mergeDuplicateCardsForUser(userId) {
  const doc = await User.findOne({ id: userId }).lean();
  if (!doc) throw new Error(`User not found: ${userId}`);

  const cards = Array.isArray(doc.cards) ? doc.cards : [];
  if (cards.length <= 1) return { changed: false, before: cards.length, after: cards.length };

  const byKey = new Map();

  for (const c of cards) {
    const rarity = String(c?.rarity ?? "");
    const name = String(c?.name ?? "");
    const key = `${rarity}||${name}`;

    if (!byKey.has(key)) {
      byKey.set(key, { ...c }); // keep first occurrence (including _id)
      continue;
    }

    const cur = byKey.get(key);

    // merge count
    cur.count = Number(cur.count ?? 0) + Number(c.count ?? 0);

    // merge locked
    cur.locked = Boolean(cur.locked) || Boolean(c.locked);

    // merge timestamps
    const curFirst = cur.firstAcquiredAt ? new Date(cur.firstAcquiredAt).getTime() : null;
    const addFirst = c.firstAcquiredAt ? new Date(c.firstAcquiredAt).getTime() : null;
    if (addFirst !== null && (curFirst === null || addFirst < curFirst)) cur.firstAcquiredAt = c.firstAcquiredAt;

    const curLast = cur.lastAcquiredAt ? new Date(cur.lastAcquiredAt).getTime() : null;
    const addLast = c.lastAcquiredAt ? new Date(c.lastAcquiredAt).getTime() : null;
    if (addLast !== null && (curLast === null || addLast > curLast)) cur.lastAcquiredAt = c.lastAcquiredAt;

    byKey.set(key, cur);
  }

  const merged = Array.from(byKey.values());
  const changed = merged.length !== cards.length;

  if (DRY_RUN) return { changed, before: cards.length, after: merged.length };

  await User.updateOne({ id: userId }, { $set: { cards: merged } }).exec();
  return { changed, before: cards.length, after: merged.length };
}

/**
 * Merge duplicates for all users that currently have duplicates.
 * ✅ Compatible with Mongoose versions where `.cursor()` does NOT have `.exec()`.
 */
async function mergeDuplicatesForAllUsers() {
  console.log("Scanning for users with duplicate (rarity+name) entries...");

  const pipeline = [
    { $unwind: "$cards" },
    {
      $group: {
        _id: { userId: "$id", rarity: "$cards.rarity", name: "$cards.name" },
        entries: { $sum: 1 }
      }
    },
    { $match: { entries: { $gt: 1 } } },
    { $group: { _id: "$_id.userId" } }
  ];

  // Preferred: async iterable cursor
  const agg = User.aggregate(pipeline).allowDiskUse(true);

  let processed = 0;
  let changedUsers = 0;

  // Some Mongoose versions return an async iterable cursor from `.cursor()`
  const maybeCursor = agg.cursor({ batchSize: 200 });

  // If cursor is async-iterable, use it. Otherwise fall back to exec().
  const isAsyncIterable = maybeCursor && typeof maybeCursor[Symbol.asyncIterator] === "function";

  if (isAsyncIterable) {
    for await (const row of maybeCursor) {
      const userId = row._id;
      processed++;
      const res = await mergeDuplicateCardsForUser(userId);
      if (res.changed) changedUsers++;

      if (processed % 100 === 0) {
        console.log(`Merge progress: processed=${processed}, changedUsers=${changedUsers}`);
      }
    }
  } else {
    // Fallback: get list in memory
    const rows = await agg.exec();
    for (const row of rows) {
      const userId = row._id;
      processed++;
      const res = await mergeDuplicateCardsForUser(userId);
      if (res.changed) changedUsers++;

      if (processed % 100 === 0) {
        console.log(`Merge progress: processed=${processed}, changedUsers=${changedUsers}`);
      }
    }
  }

  console.log(`Merge complete: processed=${processed}, changedUsers=${changedUsers}`);
}

async function fixCardNamesByRarity() {
  if (!fs.existsSync(MAP_FILE)) {
    throw new Error(`Mapping file not found: ${MAP_FILE}`);
  }

  const mapText = fs.readFileSync(MAP_FILE, "utf8");
  const rulesByRarity = parseMapFile(mapText);

  const rarities = Object.keys(rulesByRarity).filter(r => rulesByRarity[r]?.length);
  let totalRules = 0;
  for (const r of rarities) totalRules += rulesByRarity[r].length;

  console.log(`Loaded mapping from: ${MAP_FILE}`);
  console.log(`User scope: ${ONLY_USER_ID ? `ONLY_USER_ID=${ONLY_USER_ID}` : "ALL USERS"}`);
  console.log(`Mode: ${DRY_RUN ? "DRY_RUN (no writes)" : "LIVE (will write changes)"}`);
  console.log(`Merge duplicates: ${MERGE_DUPES ? (DRY_RUN ? "SKIPPED (DRY_RUN)" : "ON") : "OFF"}`);
  console.log(`Rarities with rules: ${rarities.length ? rarities.join(", ") : "(none)"}`);
  console.log(`Total parsed rules (ignoring literal NEW): ${totalRules}`);

  if (!rarities.length || totalRules === 0) {
    console.log("No rules found. Exiting.");
    return;
  }

  // Build 2-phase ops: FROM -> TEMP then TEMP -> TO
  const phase1 = [];
  const phase2 = [];

  for (const rarity of rarities) {
    for (const { from, to } of rulesByRarity[rarity]) {
      const temp = makeTempName(rarity, from);
      phase1.push(buildUpdateOp(rarity, from, temp));
      phase2.push(buildUpdateOp(rarity, temp, to));
    }
  }

  const mongoURI = process.env.MONGODB_URI || mongoUri;
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");

  try {
    console.log("\n=== Phase 1: staging (FROM -> TEMP) ===");
    await runBulkBatches(phase1);

    console.log("\n=== Phase 2: finalize (TEMP -> TO) ===");
    await runBulkBatches(phase2);

    // Merge duplicates only in LIVE mode
    if (MERGE_DUPES && !DRY_RUN) {
      console.log("\n=== Merge duplicates (rarity+name) ===");
      if (ONLY_USER_ID) {
        const mergeRes = await mergeDuplicateCardsForUser(ONLY_USER_ID);
        console.log(`Merge result (single user): changed=${mergeRes.changed}, before=${mergeRes.before}, after=${mergeRes.after}`);
      } else {
        await mergeDuplicatesForAllUsers();
      }
    }

    console.log("\n=== Completed ===");
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
}

if (require.main === module) {
  fixCardNamesByRarity().catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
}

module.exports = fixCardNamesByRarity;