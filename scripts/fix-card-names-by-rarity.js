// scripts/fix-card-names-by-rarity.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { mongoUri } = require("../config.json");
const User = require("../models/User");

/**
 * Rename card names in ALL users' inventories based on a mapping file.
 *
 * Safe against chain-cascade issues via 2-phase rename:
 *   Phase 1: FROM -> TEMP
 *   Phase 2: TEMP -> TO
 *
 * Usage:
 *   node scripts/fix-card-names-by-rarity.js
 *
 * Options:
 *   MAP_FILE=./scripts/card-name-map.txt node scripts/fix-card-names-by-rarity.js
 *   DRY_RUN=1 node scripts/fix-card-names-by-rarity.js
 *   BATCH_SIZE=500 node scripts/fix-card-names-by-rarity.js
 *   STRICT_HEADERS=1 node scripts/fix-card-names-by-rarity.js  # only accept known rarity headers
 */

const MAP_FILE = process.env.MAP_FILE || path.join(__dirname, "card-name-map.txt");
const DRY_RUN = !!process.env.DRY_RUN;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "500", 10);
const STRICT_HEADERS = !!process.env.STRICT_HEADERS;

// Your declared rarities (used only if STRICT_HEADERS=1)
const KNOWN_RARITIES = new Set([
  "BDAY","C","COL","EAS","HR","OC","ORI","OSR","OUR","P","R","RR","S","SEC","SP","SR","SY","U","UP","UR","VAL","XMAS"
]);

function decodeEntities(s) {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function normalizeLine(raw) {
  return decodeEntities(raw)
    .replace(/\u00A0/g, " ") // NBSP -> space
    .replace(/\u200B/g, "")  // zero width -> removed
    .trim();
}

function extractHeader(line) {
  const cleaned = normalizeLine(line).replace(/^#+\s*/, "").trim();
  const m = cleaned.match(/^([A-Z0-9]{1,10})\b/);
  if (!m) return null;
  const token = m[1].toUpperCase();

  if (STRICT_HEADERS) return KNOWN_RARITIES.has(token) ? token : null;
  return token; // accept any header token if not strict
}

// Your file uses escaped arrows like "-\>" and "\<-\>" [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
function normalizeArrowLine(rawLine) {
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

function makeTempName(rarity, from) {
  const h = crypto.createHash("sha1").update(`${rarity}::${from}`).digest("hex").slice(0, 12);
  return `__MIG__${rarity}__${h}__`;
}

/**
 * Parse file into mapping:
 *   rules[rarity] = Array<{ from, to }>
 *
 * - Ignores lines where FROM is exactly "NEW" [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
 * - Keeps "AZKi NEW -> ..." because FROM is not exactly "NEW" [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/card-name-map.txt)
 * - Converts swaps A<->B into two rules (A->B, B->A)
 */
function parseMapFile(text) {
  const lines = text.split(/\r?\n/).map(normalizeArrowLine);

  const rules = {};
  let current = null;

  for (const line of lines) {
    if (!line) continue;

    const header = extractHeader(line);
    if (header && !line.includes("->") && !line.includes("<->")) {
      current = header;
      if (!rules[current]) rules[current] = [];
      continue;
    }

    if (!current) continue;

    if (line.includes("<->")) {
      const [a, b] = line.split("<->").map(x => x.trim());
      if (!a || !b) continue;
      if (a === "NEW" || b === "NEW") continue;

      rules[current].push({ from: a, to: b });
      rules[current].push({ from: b, to: a });
      continue;
    }

    if (line.includes("->")) {
      const [from, to] = line.split("->").map(x => x.trim());
      if (!from || !to) continue;
      if (from === "NEW") continue;

      rules[current].push({ from, to });
      continue;
    }
  }

  return rules;
}

function buildUpdateOp(rarity, from, to) {
  return {
    updateMany: {
      filter: {
        cards: { $elemMatch: { rarity, name: from } }
      },
      update: {
        $set: { "cards.$[c].name": to }
      },
      arrayFilters: [
        { "c.rarity": rarity, "c.name": from }
      ]
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
      // In dry-run, just estimate how many user docs each op touches
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
  console.log(`Mode: ${DRY_RUN ? "DRY_RUN (no writes)" : "LIVE (will write changes)"}`);
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