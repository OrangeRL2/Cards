#!/usr/bin/env node
/**
 * simulate-eggchange.js
 *
 * Shows EAS hits from:
 * 1) Normal pulls (extra slot -> EAS)
 * 2) Eggchange rewards (EAS cards, including Stream Ticket)
 *
 * No dependencies. Node 18+ recommended.
 */

// ------------------------
// Config defaults
// ------------------------

const DEFAULT_EXTRA_CHANCE = 0.20;

const DEFAULT_EAS_WEIGHTS = {
  "White Egg": 13.33,
  "Green Egg": 13.33,
  "Red Egg": 13.33,
  "Blue Egg": 13.33,
  "Purple Egg": 13.33,
  "Yellow Egg": 13.33,

  "Bijou 001": 5.00375,   // purple
  "Koyori 001": 5.00375,  // white
  "Miko 001": 5.00375,    // red
  "Pekora 001": 5.00375,  // green
  "Kanade 001": 5.00375,  // yellow
  "Ao 001": 5.00375,      // blue

  "Easter X": 0.005,
  "Easter Y": 0.005,
};

const DEFAULT_REWARD_WEIGHTS = {
  card: 59.95,
  fans: 35.00,
  eventpull: 5.00,
  stream_ticket: 0.05, // Stream Ticket is awarded as EAS card
};

// NOTE: Your earlier message had "Kande 001" here; make it match "Kanade 001" if desired.
const DEFAULT_COLOR_CARD_POOLS = {
  White:  { "Koyori 001": 5.00375, "Easter X": 0.005, "Easter Y": 0.005 },
  Green:  { "Pekora 001": 5.00375, "Easter X": 0.005, "Easter Y": 0.005 },
  Red:    { "Miko 001": 5.00375, "Easter X": 0.005, "Easter Y": 0.005 },
  Blue:   { "Ao 001": 5.00375, "Easter X": 0.005, "Easter Y": 0.005 },
  Purple: { "Bijou 001": 5.00375, "Easter X": 0.005, "Easter Y": 0.005 },
  Yellow: { "Kanade 001": 5.00375, "Easter X": 0.005, "Easter Y": 0.005 },
};

const EGG_TO_COLOR = {
  "White Egg": "White",
  "Green Egg": "Green",
  "Red Egg": "Red",
  "Blue Egg": "Blue",
  "Purple Egg": "Purple",
  "Yellow Egg": "Yellow",
};

// ------------------------
// Small utilities
// ------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith("--")) {
      args[key] = val;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

// Fast deterministic RNG (mulberry32)
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sumWeights(map) {
  let s = 0;
  for (const k in map) s += Number(map[k] || 0);
  return s;
}

function buildCdf(weightMap) {
  const entries = Object.entries(weightMap)
    .map(([k, w]) => [k, Number(w)])
    .filter(([, w]) => Number.isFinite(w) && w > 0);

  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  if (total <= 0) throw new Error("Weight map total <= 0");

  let cum = 0;
  const cdf = entries.map(([k, w]) => {
    cum += w / total;
    return [k, cum];
  });

  cdf[cdf.length - 1][1] = 1;
  return cdf;
}

function pickFromCdf(cdf, rnd) {
  const r = rnd();
  for (let i = 0; i < cdf.length; i++) {
    if (r <= cdf[i][1]) return cdf[i][0];
  }
  return cdf[cdf.length - 1][0];
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function sortObjDesc(obj) {
  return Object.entries(obj).sort((a, b) => (b[1] || 0) - (a[1] || 0));
}

function sumCounts(obj) {
  let s = 0;
  for (const k in obj) s += Number(obj[k] || 0);
  return s;
}

function addCounts(into, from) {
  for (const [k, v] of Object.entries(from || {})) {
    into[k] = (into[k] || 0) + (v || 0);
  }
  return into;
}

// ------------------------
// Core simulation
// ------------------------

function simulateOneRun({
  pulls,
  extraChance,
  easCdf,
  rewardCdf,
  colorPoolCdfs,
  seed,
}) {
  const rnd = mulberry32(seed);

  // Counts of EAS results FROM NORMAL PULLS (extra slot)
  const easCounts = Object.create(null);
  let easHits = 0;

  // Step 1: simulate packs -> extra slot -> EAS -> weighted card
  for (let i = 0; i < pulls; i++) {
    if (rnd() < extraChance) {
      easHits++;
      const picked = pickFromCdf(easCdf, rnd);
      easCounts[picked] = (easCounts[picked] || 0) + 1;
    }
  }

  // Step 2: count eggs per color
  const eggsByColor = {
    White: 0, Green: 0, Red: 0, Blue: 0, Purple: 0, Yellow: 0,
  };
  for (const eggName in EGG_TO_COLOR) {
    const color = EGG_TO_COLOR[eggName];
    eggsByColor[color] = easCounts[eggName] || 0;
  }

  // Step 3: eggchanges per color (5 eggs each)
  const eggchangesByColor = {};
  let totalEggchanges = 0;
  for (const color of Object.keys(eggsByColor)) {
    const ex = Math.floor(eggsByColor[color] / 5);
    eggchangesByColor[color] = ex;
    totalEggchanges += ex;
  }

  // Step 4: simulate eggchange outcomes
  const outcomes = { card: 0, fans: 0, eventpull: 0, stream_ticket: 0 };
  let fansTotal = 0;

  // EAS card hits FROM EGGCHANGE
  // (includes normal card reward cards + Stream Ticket)
  const eggchangeEasCounts = Object.create(null);

  for (const color of Object.keys(eggchangesByColor)) {
    const n = eggchangesByColor[color];
    const cardCdf = colorPoolCdfs[color];

    for (let j = 0; j < n; j++) {
      const reward = pickFromCdf(rewardCdf, rnd);

      if (reward === "fans") {
        outcomes.fans++;
        fansTotal += 25;

      } else if (reward === "eventpull") {
        outcomes.eventpull++;

      } else if (reward === "stream_ticket") {
        outcomes.stream_ticket++;
        // Stream Ticket is an EAS card
        eggchangeEasCounts["Stream Ticket"] = (eggchangeEasCounts["Stream Ticket"] || 0) + 1;

      } else {
        outcomes.card++;
        const card = pickFromCdf(cardCdf, rnd);
        // Treat as EAS card hit from eggchange
        eggchangeEasCounts[card] = (eggchangeEasCounts[card] || 0) + 1;
      }
    }
  }

  return {
    easHits,
    easCounts,               // EAS from normal pulls
    eggchangeEasCounts,      // EAS from eggchange
    eggsByColor,
    eggchangesByColor,
    totalEggchanges,
    outcomes,
    fansTotal,
  };
}

function runMonteCarlo({
  pulls,
  trials,
  extraChance,
  easWeights,
  rewardWeights,
  colorCardPools,
  seed,
  printExample,
}) {
  const easCdf = buildCdf(easWeights);
  const rewardCdf = buildCdf(rewardWeights);

  const colorPoolCdfs = {};
  for (const color of Object.keys(colorCardPools)) {
    colorPoolCdfs[color] = buildCdf(colorCardPools[color]);
  }

  // Track totals across trials
  const easPullItemSums = {};       // EAS items from normal pulls
  const easEggchangeItemSums = {};  // EAS items from eggchange

  const easHitsArr = [];
  const eggchangesArr = [];
  const streamArr = [];
  const eventArr = [];
  const fansRollArr = [];
  const cardRollArr = [];

  const eggsByColorArr = {
    White: [], Green: [], Red: [], Blue: [], Purple: [], Yellow: [],
  };

  let example = null;

  for (let t = 0; t < trials; t++) {
    const run = simulateOneRun({
      pulls,
      extraChance,
      easCdf,
      rewardCdf,
      colorPoolCdfs,
      seed: (seed + t) >>> 0,
    });

    if (printExample && t === 0) example = run;

    easHitsArr.push(run.easHits);
    eggchangesArr.push(run.totalEggchanges);
    streamArr.push(run.outcomes.stream_ticket);
    eventArr.push(run.outcomes.eventpull);
    fansRollArr.push(run.outcomes.fans);
    cardRollArr.push(run.outcomes.card);

    for (const c of Object.keys(eggsByColorArr)) {
      eggsByColorArr[c].push(run.eggsByColor[c] || 0);
    }

    // accumulate EAS item hits from normal pulls
    addCounts(easPullItemSums, run.easCounts);

    // accumulate EAS item hits from eggchange
    addCounts(easEggchangeItemSums, run.eggchangeEasCounts);
  }

  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  function stats(arr) {
    return { mean: mean(arr) };
  }

  // Average per trial (so it's “per 10k pulls” if pulls=10000)
  const easPullItemAvgs = {};
  for (const [k, total] of Object.entries(easPullItemSums)) {
    easPullItemAvgs[k] = total / trials;
  }

  const easEggchangeItemAvgs = {};
  for (const [k, total] of Object.entries(easEggchangeItemSums)) {
    easEggchangeItemAvgs[k] = total / trials;
  }

  const result = {
    pulls,
    trials,
    extraChance,
    easWeightTotal: sumWeights(easWeights),
    rewardWeightTotal: sumWeights(rewardWeights),

    easHits: stats(easHitsArr),
    totalEggchanges: stats(eggchangesArr),
    streamTickets: stats(streamArr),
    eventPulls: stats(eventArr),
    fansRolls: stats(fansRollArr),
    cardRolls: stats(cardRollArr),
    eggsByColor: Object.fromEntries(
      Object.keys(eggsByColorArr).map((c) => [c, stats(eggsByColorArr[c])])
    ),

    // NEW outputs
    easPullItemAvgs,        // EAS hits from normal pulls
    easEggchangeItemAvgs,   // EAS hits from eggchange
    easPullTotalAvg: sumCounts(easPullItemAvgs),
    easEggchangeTotalAvg: sumCounts(easEggchangeItemAvgs),
    easCombinedTotalAvg: sumCounts(easPullItemAvgs) + sumCounts(easEggchangeItemAvgs),

    example,
  };

  return result;
}

// ------------------------
// Pretty printing
// ------------------------

function printSummary(res) {
  console.log("=== Simulation Summary ===");
  console.log(`Pulls (packs): ${res.pulls}`);
  console.log(`Trials:        ${res.trials}`);
  console.log(`Extra chance:  ${(res.extraChance * 100).toFixed(2)}%`);
  console.log(`EAS weight sum:     ${fmt(res.easWeightTotal, 5)}`);
  console.log(`Reward weight sum:  ${fmt(res.rewardWeightTotal, 5)}`);
  console.log("");
const s = (x) => `Average=${fmt(x.mean)}`;
  console.log(`EAS hits (NORMAL pulls): ${s(res.easHits)}`);
  console.log(`Total eggchanges:        ${s(res.totalEggchanges)}`);
  

  // NEW: breakdown normal pulls EAS
  console.log("\n=== EAS Breakdown from NORMAL pulls (Average per trial) ===");
  console.log("Eggs:");
  for (const eggName of Object.keys(EGG_TO_COLOR)) {
    console.log(`  ${eggName}: ${fmt(res.easPullItemAvgs[eggName] || 0)}`);
  }

  console.log("\nNamed cards / other:");
  const normalOther = {};
  for (const [name, avg] of Object.entries(res.easPullItemAvgs || {})) {
    if (!(name in EGG_TO_COLOR)) normalOther[name] = avg;
  }
  for (const [name, avg] of sortObjDesc(normalOther)) {
    console.log(`  ${name}: ${fmt(avg)}`);
  }

  console.log("");

  console.log(`Eggchange rolls -> cards:         ${s(res.cardRolls)}`);
  console.log(`Eggchange rolls -> fans:          ${s(res.fansRolls)}  (fans gained = rolls*25)`);
  console.log(`Eggchange rolls -> event pulls:   ${s(res.eventPulls)}`);
  console.log(`Eggchange rolls -> stream ticket: ${s(res.streamTickets)}`);
  console.log("");

  // NEW: totals
  console.log("\n=== EAS Totals (Average per trial) ===");
  console.log(`EAS from normal pulls (all EAS items):   ${fmt(res.easPullTotalAvg)}`);
  console.log(`EAS from eggchange (EAS cards only):     ${fmt(res.easEggchangeTotalAvg)}`);
  console.log(`EAS combined total (normal + eggchange): ${fmt(res.easCombinedTotalAvg)}`);

  console.log("");
  // NEW: breakdown eggchange EAS
  console.log("\n=== EAS Breakdown from EGGCHANGE (Average per trial) ===");
  const eggchangeSorted = sortObjDesc(res.easEggchangeItemAvgs || {});
  if (eggchangeSorted.length === 0) {
    console.log("  (none)");
  } else {
    for (const [name, avg] of eggchangeSorted) {
      console.log(`  ${name}: ${fmt(avg)}`);
    }
  }
}

function printExampleRun(example) {
  if (!example) return;

  console.log("\n=== Example Run (trial 1) ===");
  console.log(`EAS hits (normal pulls): ${example.easHits}`);
  console.log("Eggs by color:", example.eggsByColor);
  console.log("Eggchanges by color:", example.eggchangesByColor);
  console.log(`Total eggchanges: ${example.totalEggchanges}`);
  console.log("Eggchange outcomes:", example.outcomes);
  console.log(`Fans gained: ${example.fansTotal}`);

  console.log("\nEAS item hits from NORMAL pulls (example run):");
  for (const [name, count] of sortObjDesc(example.easCounts)) {
    console.log(`  ${name}: ${count}`);
  }

  console.log("\nEAS card hits from EGGCHANGE (example run):");
  const eggchange = sortObjDesc(example.eggchangeEasCounts);
  if (eggchange.length === 0) console.log("  (none)");
  for (const [name, count] of eggchange) {
    console.log(`  ${name}: ${count}`);
  }

  console.log("\nTotals (example run):");
  console.log(`  EAS from normal pulls: ${sumCounts(example.easCounts)}`);
  console.log(`  EAS from eggchange:    ${sumCounts(example.eggchangeEasCounts)}`);
  console.log(`  EAS combined:          ${sumCounts(example.easCounts) + sumCounts(example.eggchangeEasCounts)}`);
}

// ------------------------
// Main
// ------------------------

(function main() {
  const args = parseArgs(process.argv);

  const pulls = Number(args.pulls || 10000);
  const trials = Number(args.trials || 50);
  const extraChance = Number(args.extraChance || DEFAULT_EXTRA_CHANCE);
  const seed = Number(args.seed || 12345);

  let easWeights = DEFAULT_EAS_WEIGHTS;
  let rewardWeights = DEFAULT_REWARD_WEIGHTS;
  let colorPools = DEFAULT_COLOR_CARD_POOLS;

  if (args.config) {
    const fs = require("fs");
    const path = require("path");
    const p = path.resolve(String(args.config));
    const json = JSON.parse(fs.readFileSync(p, "utf8"));

    if (json.easWeights) easWeights = json.easWeights;
    if (json.rewardWeights) rewardWeights = json.rewardWeights;
    if (json.colorCardPools) colorPools = json.colorCardPools;
  }

  const printExample = Boolean(args.example);

  const res = runMonteCarlo({
    pulls,
    trials,
    extraChance,
    easWeights,
    rewardWeights,
    colorCardPools: colorPools,
    seed,
    printExample,
  });

  printSummary(res);
  if (printExample) printExampleRun(res.example);
})();