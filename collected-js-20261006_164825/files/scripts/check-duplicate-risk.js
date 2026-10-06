// scripts/check-duplicate-risk.js
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { mongoUri } = require("../config.json");
const User = require("../models/User");

/**
 * Checks whether applying a rename mapping would CREATE duplicate (rarity,name)
 * entries within a user's cards array.
 *
 * Usage:
 *   node scripts/check-duplicate-risk.js
 *
 * Options:
 *   MAP_FILE=./scripts/card-name-map.txt node scripts/check-duplicate-risk.js
 *   MONGODB_URI=... node scripts/check-duplicate-risk.js
 *   LIMIT_USERS=50 node scripts/check-duplicate-risk.js      # show only first N users in report per rarity
 *   OUT_FILE=./dup-risk-report.json node scripts/check-duplicate-risk.js
 *   CHECK_EXISTING=1 node scripts/check-duplicate-risk.js    # also scan for duplicates that already exist
 */

const MAP_FILE = process.env.MAP_FILE || path.join(__dirname, "card-name-map.txt");
const LIMIT_USERS = parseInt(process.env.LIMIT_USERS || "50", 10);
const OUT_FILE = process.env.OUT_FILE || "";
const CHECK_EXISTING = !!process.env.CHECK_EXISTING;

// Exact rarities you said are in DB (case-sensitive)
const VALID_RARITIES = new Set([
  "BDAY", "C", "COL", "EAS", "HR", "OC", "ORI", "OSR", "OUR",
  "P", "R", "RR", "S", "SEC", "SP", "SR", "SY", "U", "UP", "UR",
  "VAL", "XMAS"
]);

function decodeEntities(s) {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function normalizeArrowLine(line) {
  return decodeEntities(line)
    .replaceAll(" -&gt; ", " -> ")
    .replaceAll(" &lt;-&gt; ", " <-> ")
    .replaceAll("&lt;-&gt;", "<->")
    .replaceAll("-&gt;", "->")
    .replaceAll("→", "->")
    .replaceAll("↔", "<->")
    .trim();
}

/**
 * Parse mapping file into:
 *  - renamesByRarity: rarity -> array of {from,to}
 *  - swapsByRarity: rarity -> array of {a,b}   (not used for duplicate risk, but parsed)
 *
 * Ignores lines where FROM is exactly "NEW"
 */
function parseMappingFile(text) {
  const lines = text.split(/\r?\n/).map(normalizeArrowLine);

  const renamesByRarity = {};
  const swapsByRarity = {};
  let currentRarity = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (VALID_RARITIES.has(line)) {
      currentRarity = line;
      if (!renamesByRarity[currentRarity]) renamesByRarity[currentRarity] = [];
      if (!swapsByRarity[currentRarity]) swapsByRarity[currentRarity] = [];
      continue;
    }

    if (!currentRarity) continue;

    if (line.includes("<->")) {
      const [a, b] = line.split("<->").map(x => x.trim());
      if (!a || !b) continue;
      // Ignore literal NEW if it ever appears in swaps
      if (a === "NEW" || b === "NEW") continue;
      swapsByRarity[currentRarity].push({ a, b });
      continue;
    }

    if (line.includes("->")) {
      const [from, to] = line.split("->").map(x => x.trim());
      if (!from || !to) continue;

      // ignore literal NEW only (so "AZKi NEW" is NOT ignored)
      if (from === "NEW") continue;

      renamesByRarity[currentRarity].push({ from, to });
      continue;
    }
  }

  return { renamesByRarity, swapsByRarity };
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Build helper structures for risk detection:
 * - per rarity:
 *    - rules: {from,to} list
 *    - directPairs: same list used for "has from and has to"
 *    - toSources: Map(to -> Set(from)) for many-to-one detection
 *    - relevantNames: Set(all from + all to) to limit aggregation
 */
function buildRuleIndex(renamesByRarity) {
  const idx = {};

  for (const [rarity, rules] of Object.entries(renamesByRarity)) {
    if (!rules.length) continue;

    const toSources = new Map();
    const relevantNames = new Set();

    for (const { from, to } of rules) {
      relevantNames.add(from);
      relevantNames.add(to);

      if (!toSources.has(to)) toSources.set(to, new Set());
      toSources.get(to).add(from);
    }

    // Only targets with >1 sources matter for many-to-one collisions
    const manyToOne = new Map();
    for (const [to, sources] of toSources.entries()) {
      if (sources.size > 1) manyToOne.set(to, sources);
    }

    idx[rarity] = {
      rules,
      manyToOne,
      relevantNames
    };
  }

  return idx;
}

async function aggregateUserNamesByRarity(ruleIndex) {
  const rarities = Object.keys(ruleIndex);
  if (!rarities.length) return [];

  // To avoid a huge $in list, we match rarity first, then in JS filter names;
  // but for performance we still include a per-rarity $in name match in a second stage.
  // Since Mongo doesn't allow dynamic per-rarity $in easily, we use a single $in of all relevant names.
  const allRelevantNames = uniq(
    rarities.flatMap(r => Array.from(ruleIndex[r].relevantNames))
  );

  // If allRelevantNames is extremely large, you may need to chunk it.
  // Typical mappings are a few hundred, so it's fine.
  const pipeline = [
    { $unwind: "$cards" },
    {
      $match: {
        "cards.rarity": { $in: rarities },
        "cards.name": { $in: allRelevantNames }
      }
    },
    {
      $group: {
        _id: { userId: "$id", rarity: "$cards.rarity" },
        names: { $addToSet: "$cards.name" }
      }
    }
  ];

  return User.aggregate(pipeline).allowDiskUse(true);
}

function analyzeRisk(groupDocs, ruleIndex) {
  const report = {
    summary: {},
    users: {} // rarity -> array of user collision details (limited)
  };

  // Initialize
  for (const rarity of Object.keys(ruleIndex)) {
    report.summary[rarity] = {
      usersWithAnyRisk: 0,
      directCollisionUsers: 0,
      manyToOneCollisionUsers: 0,
      totalDirectCollisionPairs: 0,
      totalManyToOneTargetsTriggered: 0
    };
    report.users[rarity] = [];
  }

  for (const doc of groupDocs) {
    const userId = doc._id.userId;
    const rarity = doc._id.rarity;
    const idx = ruleIndex[rarity];
    if (!idx) continue;

    const set = new Set(doc.names);

    // 1) Direct collisions: user has both from and to for any rule
    const directHits = [];
    for (const { from, to } of idx.rules) {
      if (from === to) continue;
      if (set.has(from) && set.has(to)) {
        directHits.push({ from, to });
      }
    }

    // 2) Many-to-one collisions: user has >=2 sources mapping into the same target
    const manyToOneHits = [];
    for (const [to, sourcesSet] of idx.manyToOne.entries()) {
      let present = 0;
      const presentSources = [];
      for (const s of sourcesSet) {
        if (set.has(s)) {
          present++;
          presentSources.push(s);
          if (present >= 2) break; // enough to create duplicates
        }
      }
      if (present >= 2) {
        manyToOneHits.push({ to, sources: presentSources });
      }
    }

    const anyRisk = directHits.length > 0 || manyToOneHits.length > 0;
    if (!anyRisk) continue;

    const s = report.summary[rarity];
    s.usersWithAnyRisk += 1;
    if (directHits.length) {
      s.directCollisionUsers += 1;
      s.totalDirectCollisionPairs += directHits.length;
    }
    if (manyToOneHits.length) {
      s.manyToOneCollisionUsers += 1;
      s.totalManyToOneTargetsTriggered += manyToOneHits.length;
    }

    // Keep per-user details but limit output volume
    if (report.users[rarity].length < LIMIT_USERS) {
      report.users[rarity].push({
        userId,
        rarity,
        directHits,
        manyToOneHits
      });
    }
  }

  return report;
}

/**
 * Optional: Scan for duplicates that already exist in DB, meaning a user has more
 * than one array element with the same (rarity,name). This ignores "count" field
 * and checks array element duplication.
 */
async function scanExistingDuplicates() {
  const pipeline = [
    { $unwind: "$cards" },
    {
      $group: {
        _id: { userId: "$id", rarity: "$cards.rarity", name: "$cards.name" },
        entries: { $sum: 1 }
      }
    },
    { $match: { entries: { $gt: 1 } } },
    {
      $group: {
        _id: "$_id.userId",
        dupes: {
          $push: {
            rarity: "$_id.rarity",
            name: "$_id.name",
            entries: "$entries"
          }
        },
        totalDupes: { $sum: 1 }
      }
    },
    { $sort: { totalDupes: -1 } }
  ];

  return User.aggregate(pipeline).allowDiskUse(true);
}

async function main() {
  if (!fs.existsSync(MAP_FILE)) {
    throw new Error(`Mapping file not found: ${MAP_FILE}`);
  }

  const mappingText = fs.readFileSync(MAP_FILE, "utf8");
  const { renamesByRarity } = parseMappingFile(mappingText);

  const ruleIndex = buildRuleIndex(renamesByRarity);
  const raritiesUsed = Object.keys(ruleIndex);

  console.log(`Loaded mapping from: ${MAP_FILE}`);
  console.log(`Rarities in mapping (rename rules only): ${raritiesUsed.length ? raritiesUsed.join(", ") : "(none)"}`);

  let totalRules = 0;
  for (const r of Object.keys(renamesByRarity)) totalRules += renamesByRarity[r].length;
  console.log(`Total rename rules (ignoring literal NEW): ${totalRules}`);

  if (!raritiesUsed.length) {
    console.log("No rename rules found. Exiting.");
    return;
  }

  const mongoURI = process.env.MONGODB_URI || mongoUri;
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");

  try {
    console.log("\nAggregating user name sets (this may take a bit)...");
    const groupDocs = await aggregateUserNamesByRarity(ruleIndex);
    console.log(`Aggregation groups returned: ${groupDocs.length}`);

    console.log("\nAnalyzing duplicate risk...");
    const riskReport = analyzeRisk(groupDocs, ruleIndex);

    // Print summary
    console.log("\n=== Duplicate Risk Summary (if renames applied) ===");
    for (const rarity of raritiesUsed) {
      const s = riskReport.summary[rarity];
      console.log(
        `${rarity}: usersWithAnyRisk=${s.usersWithAnyRisk}, ` +
        `directUsers=${s.directCollisionUsers} (pairs=${s.totalDirectCollisionPairs}), ` +
        `manyToOneUsers=${s.manyToOneCollisionUsers} (targets=${s.totalManyToOneTargetsTriggered})`
      );
    }

    // Optional existing dupes scan
    let existingDupes = null;
    if (CHECK_EXISTING) {
      console.log("\nScanning for duplicates that already exist in DB...");
      existingDupes = await scanExistingDuplicates();
      console.log(`Users with existing duplicate entries: ${existingDupes.length}`);
      if (existingDupes.length) {
        console.log("Top 5 users with existing dupes:");
        console.log(existingDupes.slice(0, 5));
      }
    }

    const finalReport = {
      generatedAt: new Date().toISOString(),
      mapFile: MAP_FILE,
      limitUsersPerRarity: LIMIT_USERS,
      raritiesUsed,
      risk: riskReport,
      existingDuplicates: CHECK_EXISTING ? existingDupes : undefined
    };

    if (OUT_FILE) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(finalReport, null, 2), "utf8");
      console.log(`\nWrote report to: ${OUT_FILE}`);
    } else {
      console.log("\nTip: set OUT_FILE=./dup-risk-report.json to save full report.");
    }
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Duplicate risk check failed:", e);
    process.exit(1);
  });
}