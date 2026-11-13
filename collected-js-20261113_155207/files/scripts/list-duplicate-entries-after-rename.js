// scripts/list-duplicate-entries-after-rename.js
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { mongoUri } = require("../config.json");
const User = require("../models/User");

/**
 * Lists EXACTLY which user + rarity + final card name would become a duplicate entry
 * after applying the rename mapping (simulated, no DB writes).
 *
 * Usage:
 *   node scripts/list-duplicate-entries-after-rename.js
 *
 * Options:
 *   MAP_FILE=./scripts/card-name-map.txt node scripts/list-duplicate-entries-after-rename.js
 *   OUT_FILE=./dupes-after-rename.json node scripts/list-duplicate-entries-after-rename.js
 *   LIMIT_USERS=200 node scripts/list-duplicate-entries-after-rename.js    # limit output rows (0 = no limit)
 *   LIMIT_PER_USER=200 node scripts/list-duplicate-entries-after-rename.js # limit dup groups per user (0 = no limit)
 */

const MAP_FILE = process.env.MAP_FILE || path.join(__dirname, "card-name-map.txt");
const OUT_FILE = process.env.OUT_FILE || "";
const LIMIT_USERS = parseInt(process.env.LIMIT_USERS || "0", 10);
const LIMIT_PER_USER = parseInt(process.env.LIMIT_PER_USER || "0", 10);

// Keep this list if you want strict rarity header matching.
// Your mapping file currently uses SR/U/C/S/P/VAL/COL etc. [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
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

function normalizeLine(raw) {
  return decodeEntities(raw)
    .replace(/\u00A0/g, " ")   // NBSP -> space
    .replace(/\u200B/g, "")    // zero-width -> removed
    .trim();
}

function extractRarityHeader(rawLine) {
  const line = normalizeLine(rawLine).replace(/^#+\s*/, "").trim();
  const m = line.match(/^([A-Z0-9]{1,6})\b/);
  if (!m) return null;
  const token = m[1].toUpperCase();
  return VALID_RARITIES.has(token) ? token : null;
}

function normalizeArrowLine(rawLine) {
  // Your file uses escaped arrows like -\> and \<-\> [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
  return normalizeLine(rawLine)
    .replaceAll("\\<\\-\\>", "<->") // \<-\>
    .replaceAll("<\\-\\>", "<->")
    .replaceAll("-\\>", "->")       // -\>
    .replaceAll("\\->", "->")
    .replaceAll("→", "->")
    .replaceAll("↔", "<->")
    .replace(/\s*->\s*/g, "->")
    .replace(/\s*<->\s*/g, "<->")
    .trim();
}

/**
 * Parse map file into:
 * mapping[rarity][fromName] = toName
 * Also returns per-rarity relevant names (from + to).
 *
 * Ignores lines where FROM is exactly "NEW" (as requested). [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
 */
function parseMappingFile(text) {
  const lines = text.split(/\r?\n/).map(normalizeArrowLine);

  const mapping = {};        // rarity -> {from:to}
  const relevant = {};       // rarity -> Set(names)
  let currentRarity = null;

  for (const line of lines) {
    if (!line) continue;

    const header = extractRarityHeader(line);
    if (header) {
      currentRarity = header;
      if (!mapping[currentRarity]) mapping[currentRarity] = {};
      if (!relevant[currentRarity]) relevant[currentRarity] = new Set();
      continue;
    }

    if (!currentRarity) continue;

    // Swap line: A<->B becomes A->B and B->A mapping (simultaneous mapping)
    if (line.includes("<->")) {
      const [a, b] = line.split("<->").map(x => x.trim());
      if (!a || !b) continue;
      if (a === "NEW" || b === "NEW") continue;

      mapping[currentRarity][a] = b;
      mapping[currentRarity][b] = a;
      relevant[currentRarity].add(a);
      relevant[currentRarity].add(b);
      continue;
    }

    if (line.includes("->")) {
      const [from, to] = line.split("->").map(x => x.trim());
      if (!from || !to) continue;
      if (from === "NEW") continue; // ignore literal NEW only

      mapping[currentRarity][from] = to;
      relevant[currentRarity].add(from);
      relevant[currentRarity].add(to);
      continue;
    }
  }

  return { mapping, relevant };
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

/**
 * Simulate final name after migration for a card.
 * Important: this is a "simultaneous" rename simulation:
 * finalName = mapping[rarity][originalName] || originalName
 * (No chaining A->B->C, because your mapping is meant to apply from original state.)
 */
function simulateFinalName(mapping, rarity, originalName) {
  const m = mapping[rarity];
  if (!m) return originalName;
  return m[originalName] || originalName;
}

async function main() {
  if (!fs.existsSync(MAP_FILE)) {
    throw new Error(`Mapping file not found: ${MAP_FILE}`);
  }

  const text = fs.readFileSync(MAP_FILE, "utf8");
  const { mapping, relevant } = parseMappingFile(text);

  const rarities = Object.keys(mapping);
  const allRelevantNames = uniq(
    rarities.flatMap(r => Array.from(relevant[r] || []))
  );

  let totalRules = 0;
  for (const r of rarities) totalRules += Object.keys(mapping[r] || {}).length;

  console.log(`Loaded mapping from: ${MAP_FILE}`);
  console.log(`Rarities with rules: ${rarities.length ? rarities.join(", ") : "(none)"}`);
  console.log(`Total parsed rules (ignoring literal NEW): ${totalRules}`);

  if (!rarities.length || totalRules === 0) {
    console.log("No rules found. Exiting.");
    return;
  }

  const mongoURI = process.env.MONGODB_URI || mongoUri;
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");

  try {
    // Only pull users that have relevant names in relevant rarities (keeps it fast)
    const users = await User.find(
      { cards: { $elemMatch: { rarity: { $in: rarities }, name: { $in: allRelevantNames } } } },
      {
        id: 1,
        cards: 1
      }
    ).lean();

    console.log(`Users scanned (matched by relevant names): ${users.length}`);

    const results = [];
    let usersWithDupes = 0;

    for (const u of users) {
      const groups = new Map(); // key = rarity||finalName -> { rarity, finalName, items: [] }

      // Consider only cards in mapped rarities; we do NOT need other rarities
      for (const c of (u.cards || [])) {
        if (!c || !rarities.includes(c.rarity)) continue;

        const originalName = c.name;
        const finalName = simulateFinalName(mapping, c.rarity, originalName);

        const key = `${c.rarity}||${finalName}`;
        if (!groups.has(key)) {
          groups.set(key, { rarity: c.rarity, finalName, items: [] });
        }
        groups.get(key).items.push({
          originalName,
          finalName,
          count: c.count,
          locked: c.locked,
          cardSubId: c._id
        });
      }

      // Find groups that would have 2+ entries after migration
      const dupGroups = [];
      for (const g of groups.values()) {
        if (g.items.length < 2) continue;

        // Determine if migration is actually responsible (at least one item changes name
        // OR at least one item has a different originalName than another in same finalName group).
        const distinctOriginal = new Set(g.items.map(x => x.originalName));
        const anyChanged = g.items.some(x => x.originalName !== x.finalName);
        const createdOrWorsenedByMigration = anyChanged || distinctOriginal.size > 1;

        if (!createdOrWorsenedByMigration) continue;

        // Helpful rollups
        const totalCount = g.items.reduce((s, x) => s + (Number(x.count) || 0), 0);
        const anyLocked = g.items.some(x => !!x.locked);

        dupGroups.push({
          rarity: g.rarity,
          finalName: g.finalName,
          sources: Array.from(distinctOriginal),
          entries: g.items.length,
          totalCount,
          anyLocked,
          items: g.items
        });
      }

      if (dupGroups.length) {
        usersWithDupes++;
        results.push({
          userId: u.id,
          duplicateGroups: LIMIT_PER_USER > 0 ? dupGroups.slice(0, LIMIT_PER_USER) : dupGroups
        });
      }

      if (LIMIT_USERS > 0 && results.length >= LIMIT_USERS) break;
    }

    console.log(`Users with duplicate entries AFTER rename (simulated): ${usersWithDupes}`);
    console.log(`Result rows written: ${results.length}`);

    // Print a small preview to console
    console.log("\n=== Preview (first 3 users) ===");
    for (const row of results.slice(0, 3)) {
      console.log(`User ${row.userId}:`);
      for (const g of row.duplicateGroups.slice(0, 5)) {
        console.log(`  [${g.rarity}] "${g.finalName}" <- ${g.sources.join(" | ")} (entries=${g.entries}, totalCount=${g.totalCount})`);
      }
    }

    const out = {
      generatedAt: new Date().toISOString(),
      mapFile: MAP_FILE,
      raritiesUsed: rarities,
      totalRules,
      usersMatchedByRelevantNames: users.length,
      usersWithDuplicateGroups: usersWithDupes,
      results
    };

    if (OUT_FILE) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
      console.log(`\nWrote detailed report to: ${OUT_FILE}`);
    } else {
      console.log("\nTip: set OUT_FILE=./dupes-after-rename.json to save the full detailed report.");
    }
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Failed:", e);
    process.exit(1);
  });
}
