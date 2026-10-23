#!/usr/bin/env node
'use strict';

/**
 * HAL / BOO collection simulator -- standalone; no bot/database access.
 *
 * Defaults: 14 JST event days, 14 logins, 80 paid pulls per day,
 *          22 tarot cards, 22 collectible BOO cards (plus Halloween X),
 *          40 Candy per BOO exchange, 1 Candy per paid pull,
 *          halBooBonusChance=0.01, 20,000 independent simulated players.
 *
 * Edit SETTINGS below, or override with CLI flags (node boo_collection_simulator.js --help).
 * The bonus chance is represented as a decimal: 0.01 = 1%.
 *
 * Mechanically relevant details:
 *  - Login awards a BOO copy of the drawn tarot, using its weighted tarot rate.
 *  - Fool also awards Halloween X, then rerolls, including another Fool.
 *  - Justice prevents the specified negative tarots on the next login.
 *  - Nerfed-rate players cannot draw The World (optional fraction setting).
 *  - Every paid pull grants precisely one Candy, even during Judgement.
 *  - Death disables BOO bonus-slot drops during its active login day, but not Candy.
 *  - Shop BOO draws / normal bonus-slot BOO draws: 0.03% Halloween X,
 *    otherwise evenly distributed over ALL ordinary BOO collectibles.
 *  - Halloween X is logged separately and is NOT needed to finish the collection.
 *  - All acquired Candy is spent on BOO card exchanges; no HOLODORI purchases.
 *
 * Efficiency: Each paid pull gets a pre-sampled uniform BOO-slot trigger.
 * For each missing collectible, the minimum uniform trigger at which that
 * collectible appears gives its required bonus chance. The maximum of those
 * minima is the exact (for that simulated player) completion threshold.
 * This lets us evaluate every possible bonus rate from one simulation sample,
 * with no costly repeated binary-search reruns or simulation noise per rate.
 */

const fs = require('node:fs');

const SETTINGS = Object.freeze({
  players: 1000,
  pullsPerDay: 80,
  days: 14,                  // Oct 26 to Nov 8 inclusive
  logins: 14,                // Successful daily logins per player during event
  tarotCards: 22,           // Number of tarot-member collectible types (first N below)
  booCards: 37,             // TOTAL ordinary BOO collectible types, including tarot;
                           // extra non-tarot BOO cards = booCards - tarotCards
  booPullCost: 40,          // Candy price for each BOO shop purchase
  booBonusChance: 0.16,     // 16%; corresponds to config.halBooBonusChance
  halloweenXChance: 0.0003,// 0.03% PER collectible BOO draw, separate from Fool
  nerfedPlayerFraction: 0,  // fraction barred from receiving World, 0..1
  dailyPullMode: 'fixed',   // 'fixed' (80 exact), or 'poisson' (80/day on average)
  seed: 20261021,
  completionTargets: [0.5, 0.8, 0.9, 0.95, 0.99],
});

// Canonical tarot #, member, tarot title, daily-login probability weight (%).
// Percentages originally sum to 100 across all 22 cards.
const TAROTS = Object.freeze([
  [0, 'Roboco', 'The Fool', 0.5],
  [1, 'Shion', 'The Magician', 1.75],
  [2, 'Fubuki', 'The High Priestess', 8],
  [3, 'Marine', 'The Empress', 8],
  [4, 'Korone', 'The Emperor', 8],
  [5, 'Mio', 'The Hierophant', 4],
  [6, 'Matsuri', 'The Lovers', 5.5],
  [7, 'Botan', 'The Chariot', 4],
  [8, 'Kanata', 'Strength', 4],
  [9, 'Chloe', 'The Hermit', 5.5],
  [10, 'Pekora', 'Wheel of Fortune', 4],
  [11, 'Noel', 'Justice', 4],
  [12, 'Okayu', 'The Hanged Man', 4],
  [13, 'Calli', 'Death', 0.5],
  [14, 'Iroha', 'Temperance', 8],
  [15, 'Towa', 'The Devil', 8],
  [16, 'Miko', 'The Tower', 4],
  [17, 'Suisei', 'The Star', 1.75],
  [18, 'Luna', 'The Moon', 4],
  [19, 'Subaru', 'The Sun', 8],
  [20, 'Lui', 'Judgement', 4],
  [21, 'Sora', 'The World', 0.5],
]);
const NEGATIVE_TAROTS = new Set([5, 9, 12, 13, 16]);

function fail(msg) { throw new Error(msg); }
function help() {
  console.log(`HAL / BOO collection completion simulator

Usage:
  node boo_collection_simulator.js [options]

All settings can also be edited at the top of this script.
  --players N           Simulated player count (default 20000)
  --pulls N             Average paid pulls per day (default 80)
  --days N              Event days (default 14)
  --logins N            Logins per player across those days (default 14)
  --tarots N            Number of tarot types, 0..22 (default 22)
  --boo N               Number of ordinary BOO collectible types, excluding X
                        but including the tarot types (default 22)
  --extra-boo N         Additional non-tarot BOO types (sets --boo to --tarots+N)
  --cost N              Candy per shop BOO pull (default 40)
  --chance N            halBooBonusChance as decimal (default 0.01 = 1%)
  --chance-percent N    Chance in percent (example 1 for 1%)
  --x-chance N          Halloween X chance per shop/bonus BOO roll (default 0.0003)
  --nerfed N            Fraction of World-ineligible players (example 0.1 = 10%)
  --pull-mode MODE      fixed or poisson (default fixed)
  --seed N              Reproducible 32-bit random seed
  --csv FILE            Export chance/completion/X-recipient curve to CSV
  --json FILE           Export full report to JSON
  --help                Show this text

Examples:
  node boo_collection_simulator.js
  node boo_collection_simulator.js --players 100000 --pulls 80 --days 14 --logins 14
  node boo_collection_simulator.js --tarots 22 --boo 30 --chance-percent 1
  node boo_collection_simulator.js --extra-boo 8 --csv boo_rates.csv

IMPORTANT: 'boo' includes the tarot-member collectibles; the special
'Halloween X' collectible never counts toward completion.
`);
}
function parseArguments(argv) {
  const conf = { ...SETTINGS };
  let extraBoo;
  const names = {
    players: ['players', 'int'], pulls: ['pullsPerDay', 'float'],
    days: ['days', 'int'], logins: ['logins', 'int'],
    tarots: ['tarotCards', 'int'], boo: ['booCards', 'int'],
    cost: ['booPullCost', 'int'], chance: ['booBonusChance', 'float'],
    'x-chance': ['halloweenXChance', 'float'],
    nerfed: ['nerfedPlayerFraction', 'float'],
    'pull-mode': ['dailyPullMode', 'string'], seed: ['seed', 'int'],
  };
  let booWasSet = false;
  const output = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { help(); process.exit(0); }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) fail(`Unknown argument ${argv[i]}; see --help`);
    const key = m[1];
    const raw = m[2] === undefined ? argv[++i] : m[2];
    if (raw === undefined || raw.startsWith('--')) fail(`Missing value for --${key}`);
    if (key === 'csv' || key === 'json') { output[key] = raw; continue; }
    if (key === 'extra-boo') {
      extraBoo = Number(raw);
      if (!Number.isInteger(extraBoo) || extraBoo < 0) fail('--extra-boo must be a nonnegative integer');
      continue;
    }
    if (key === 'chance-percent') {
      conf.booBonusChance = Number(raw) / 100;
      continue;
    }
    if (!(key in names)) fail(`Unknown option --${key}; see --help`);
    const [name, kind] = names[key];
    let v = kind === 'string' ? raw : Number(raw);
    if (kind !== 'string' && (!Number.isFinite(v) || (kind === 'int' && !Number.isInteger(v)))) fail(`Invalid number for --${key}`);
    conf[name] = v;
    if (key === 'boo') booWasSet = true;
  }
  if (extraBoo !== undefined) {
    if (booWasSet) fail('Use either --boo or --extra-boo, not both');
    conf.booCards = conf.tarotCards + extraBoo;
  }
  validate(conf);
  return { conf, output };
}
function validate(c) {
  if (!Number.isInteger(c.players) || c.players < 1 || c.players > 1000000) fail('players must be 1..1,000,000');
  if (!Number.isFinite(c.pullsPerDay) || c.pullsPerDay < 0 || c.pullsPerDay > 100000) fail('pullsPerDay must be 0..100000');
  if (!Number.isInteger(c.days) || c.days < 1 || c.days > 10000) fail('days must be 1..10000');
  if (!Number.isInteger(c.logins) || c.logins < 0 || c.logins > c.days) fail('logins must be 0..days');
  if (!Number.isInteger(c.tarotCards) || c.tarotCards < 0 || c.tarotCards > TAROTS.length) fail('tarotCards must be 0..22; to add more, first extend TAROTS');
  if (!Number.isInteger(c.booCards) || c.booCards < Math.max(1, c.tarotCards) || c.booCards > 10000) fail('booCards must be at least the tarot count and at least 1');
  if (!Number.isInteger(c.booPullCost) || c.booPullCost < 1) fail('booPullCost must be >=1');
  if (!(c.booBonusChance >= 0 && c.booBonusChance <= 1)) fail('booBonusChance must be decimal 0..1');
  if (!(c.halloweenXChance >= 0 && c.halloweenXChance < 1)) fail('halloweenXChance must be decimal 0..1 (exclusive)');
  if (!(c.nerfedPlayerFraction >= 0 && c.nerfedPlayerFraction <= 1)) fail('nerfedPlayerFraction must be 0..1');
  if (!['fixed','poisson'].includes(c.dailyPullMode)) fail('dailyPullMode must be fixed or poisson');
  if (c.players * c.pullsPerDay * c.days > 180000000) fail('Requested player x pull count is too large; reduce players or pulls to keep runtime reasonable');
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda, rng) {
  let total = 0;
  while (lambda > 0) {
    const chunk = Math.min(lambda, 25);
    const cutoff = Math.exp(-chunk);
    let product = 1;
    let count = -1;
    do { count += 1; product *= rng(); } while (product > cutoff);
    total += count;
    lambda -= chunk;
  }
  return total;
}
function drawPullCount(c, rng) {
  if (c.dailyPullMode === 'poisson') return poisson(c.pullsPerDay, rng);
  const whole = Math.floor(c.pullsPerDay);
  return whole + (rng() < (c.pullsPerDay - whole) ? 1 : 0);
}
function createTarotPicker(c) {
  const list = TAROTS.slice(0, c.tarotCards);
  const cache = new Map();
  for (const restricted of [false,true]) for (const justiceShield of [false,true]) {
    const eligible = list.filter(t => !(restricted && t[0] === 21) && !(justiceShield && NEGATIVE_TAROTS.has(t[0])));
    const sum = eligible.reduce((s,t) => s + t[3], 0);
    const cumulative = [];
    let running = 0;
    for (const t of eligible) { running += t[3]; cumulative.push(running); }
    cache.set(`${+restricted}${+justiceShield}`, {eligible, cumulative, sum});
  }
  return (restricted, shield, rng) => {
    const pool = cache.get(`${+restricted}${+shield}`);
    if (!pool?.eligible.length) return null;
    const u = rng() * pool.sum;
    let lo = 0, hi = pool.cumulative.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (u < pool.cumulative[mid]) hi = mid;
      else lo = mid + 1;
    }
    return pool.eligible[Math.min(lo, pool.eligible.length - 1)];
  };
}
function drawCollectible(c, rng) {
  if (rng() < c.halloweenXChance) return -1; // Halloween X (does not count)
  return Math.floor(rng() * c.booCards);       // all ordinary collectibles equal
}
function simulate(c) {
  const rng = mulberry32(c.seed);
  const drawTarot = createTarotPicker(c);
  const players = [];
  const summary = { totalPulls:0, eligibleBooSlots:0, candyBooPurchases:0, foolAwards:0, deathDays:0 };
  const triggers = Array.from({length:c.days}, (_,d) => Math.floor((d+1)*c.logins/c.days) > Math.floor(d*c.logins/c.days));
  for (let pi = 0; pi < c.players; pi++) {
    const owned = new Uint8Array(c.booCards);
    const bestBonusTrigger = new Float64Array(c.booCards);
    bestBonusTrigger.fill(Infinity);
    let startingUnique = 0, nPulls = 0, shopCount = 0;
    let xFool = 0, xShop = 0;
    const xBonusTriggers = [];
    const restricted = rng() < c.nerfedPlayerFraction;
    let lastEffect = null, activeEffect = null;
    for (let day=0; day<c.days; day++) {
      activeEffect = null; // all login effects expire at JST midnight
      if (triggers[day] && c.tarotCards > 0) {
        const shield = lastEffect === 11;
        let effect = drawTarot(restricted, shield, rng);
        // Fool awards its own card + Halloween X, then rerolls.
        // Repeated Fools each award another Fool card and another X.
        let safety = 0;
        while (effect) {
          if (!owned[effect[0]]) { owned[effect[0]]=1; startingUnique++; }
          if (effect[0] !== 0) break;
          xFool++;
          safety++;
          // If the only available tarot is Fool, no different effect exists
          // to reroll into; count one Fool draw rather than recurse forever.
          if (c.tarotCards === 1) break;
          if (safety >= 100) fail('Too many Fool rerolls; check tarot probabilities.');
          effect = drawTarot(restricted, shield, rng);
        }
        activeEffect = effect ? effect[0] : null;
        lastEffect = activeEffect;
      } // With no login today, today's effect expires, but Justice's
        // protection remains queued until the next successful login.
      const pullsToday = drawPullCount(c, rng);
      nPulls += pullsToday;
      if (activeEffect === 13) summary.deathDays++;
      if (activeEffect !== 13) {
        summary.eligibleBooSlots += pullsToday;
        for (let i=0; i<pullsToday; i++) {
          // Pre-sample a possible bonus card independently of the bonus rate.
          // It appears if trigger < actual halBooBonusChance.
          const trigger = rng();
          const card = drawCollectible(c, rng);
          if (card === -1) xBonusTriggers.push(trigger);
          else if (trigger < bestBonusTrigger[card]) bestBonusTrigger[card] = trigger;
        }
      }
    }
    summary.totalPulls += nPulls;
    shopCount = Math.floor(nPulls / c.booPullCost); // all Candy spent on BOO only
    summary.candyBooPurchases += shopCount;
    for (let j=0;j<shopCount;j++) {
      const card = drawCollectible(c,rng);
      if (card === -1) xShop++;
      else if (!owned[card]) { owned[card]=1; startingUnique++; }
    }
    let threshold = 0;
    for (let j=0;j<c.booCards;j++) {
      if (!owned[j]) threshold = Math.max(threshold, bestBonusTrigger[j]);
    }
    const countUniqueAt = (chance) => {
      let count = startingUnique;
      for (let j=0;j<c.booCards;j++) {
        if (!owned[j] && bestBonusTrigger[j] <= chance) count++;
      }
      return count;
    };
    players.push({threshold, xFool, xShop, xBonusTriggers, startingUnique, countUniqueAt});
    summary.foolAwards += xFool;
  }
  const sortedThresholds = players.map(x=>x.threshold).sort((a,b)=>a-b);
  function rateStats(chance) {
    const p = Math.min(1, Math.max(0, chance));
    let lo=0,hi=sortedThresholds.length;
    while(lo<hi) { const mid=(lo+hi)>>>1; if(sortedThresholds[mid] <=p) lo=mid+1;else hi=mid; }
    let xUsers=0,xFoolUsers=0,xShopUsers=0,xBonusUsers=0,xCopies=0,unique=0;
    for(const user of players) {
      let bonusXCount=0;
      for(const t of user.xBonusTriggers) if(t<=p) bonusXCount++;
      if (user.xFool+user.xShop+bonusXCount>0) xUsers++;
      if (user.xFool>0) xFoolUsers++;
      if (user.xShop>0) xShopUsers++;
      if (bonusXCount>0) xBonusUsers++;
      xCopies+=user.xFool+user.xShop+bonusXCount;
      unique+=user.countUniqueAt(p);
    }
    return {
      chance:p, completed:lo, completionRate:lo/c.players,
      xUsers, xRate:xUsers/c.players, xFoolUsers, xShopUsers, xBonusUsers,
      xCopies, avgUnique:unique/c.players,
    };
  }
  const targets = c.completionTargets.map(target=>{
    const index = Math.max(0,Math.ceil(target*c.players)-1);
    const chance = sortedThresholds[index];
    return {target, chance, reachable:Number.isFinite(chance), stats:Number.isFinite(chance)?rateStats(chance):null};
  });
  const sampleChances = [0,0.005,0.01,0.02,0.03,0.04,0.05,0.075,0.10,0.15,0.20,0.30,0.50,1,c.booBonusChance];
  for(const target of targets) if (target.reachable) sampleChances.push(target.chance);
  const curve = [...new Set(sampleChances.map(p=>p.toFixed(8)))].map(Number).sort((a,b)=>a-b).map(rateStats);
  return {settings:c, sampleSize:c.players, summary, current:rateStats(c.booBonusChance), targets, curve};
}
function pct(p, digits=2) {return `${(p*100).toFixed(digits)}%`;}
function showReport(report) {
  const c=report.settings, {summary, current,targets,curve}=report;
  console.log('\nHAL / BOO COLLECTION SIMULATOR');
  console.log('='.repeat(68));
  console.log(`Players: ${c.players.toLocaleString()} | Days: ${c.days} | Logins/player: ${c.logins} | Paid pulls/day: ${c.pullsPerDay} (${c.dailyPullMode})`);
  console.log(`Tarot BOO cards: ${c.tarotCards} | Additional non-tarot BOO: ${c.booCards-c.tarotCards} | Completion target: ${c.booCards} unique BOO`);
  console.log(`Candy: 1 per paid pull; BOO shop price: ${c.booPullCost} Candy | ALL Candy spent on BOO pulls`);
  console.log(`Halloween X chance: ${pct(c.halloweenXChance,3)} per shop/extra BOO draw, + guaranteed from each Fool`);
  console.log(`Restricted players (cannot get World): ${pct(c.nerfedPlayerFraction,1)}`);
  console.log(`Total simulated pulls: ${summary.totalPulls.toLocaleString()} | BOO-eligible slots: ${summary.eligibleBooSlots.toLocaleString()}`);
  console.log(`Average shop BOO pulls/player: ${(summary.candyBooPurchases/c.players).toFixed(2)} | Fool X awards: ${summary.foolAwards.toLocaleString()}`);
  console.log('\nAT CURRENT halBooBonusChance = '+c.booBonusChance);
  console.log(`  Full BOO collection: ${current.completed.toLocaleString()} / ${c.players.toLocaleString()} players (${pct(current.completionRate)})`);
  console.log(`  Average distinct BOO cards: ${current.avgUnique.toFixed(2)} / ${c.booCards}`);
  console.log(`  Halloween X owners: ${current.xUsers.toLocaleString()} / ${c.players.toLocaleString()} (${pct(current.xRate)})`);
  console.log(`  X by source (recipients can overlap): Fool ${current.xFoolUsers}, shop ${current.xShopUsers}, extra slot ${current.xBonusUsers}`);
  console.log(`  Total Halloween X copies acquired: ${current.xCopies.toLocaleString()}`);
  console.log('\nREQUIRED halBooBonusChance FOR COLLECTION TARGETS');
  for(const t of targets) console.log(`  ${pct(t.target,0).padStart(4)} of players finish -> ${t.reachable ? `${t.chance.toFixed(5)} (${pct(t.chance,2)})` : 'not reachable even at 100%'}`);
  console.log('\nBONUS CHANCE SENSITIVITY (X = owners of at least 1 Halloween X)');
  console.log('  Chance'.padEnd(14)+'Complete'.padStart(12)+'Users complete'.padStart(17)+'X owners'.padStart(14)+'Avg unique'.padStart(13));
  for(const item of curve) {
    if (!(Math.abs(item.chance-c.booBonusChance)<1e-7 || [0,0.005,0.01,0.02,0.03,0.04,0.05,0.075,0.10,0.15,0.20,0.30,0.50,1].some(x=>Math.abs(x-item.chance)<1e-7))) continue;
    const mark=Math.abs(item.chance-c.booBonusChance)<1e-7?' *':'';
    console.log('  '+pct(item.chance,2).padEnd(12)+pct(item.completionRate,2).padStart(12)+String(item.completed).padStart(17)+String(item.xUsers).padStart(14)+item.avgUnique.toFixed(2).padStart(13)+mark);
  }
  console.log('\n* Current configured rate. X never counts toward completion.');
  console.log('Approximate Monte Carlo results, not guarantees for individual players.\n');
}
function exportReport(report, output) {
  if (output.json) {
    fs.writeFileSync(output.json,JSON.stringify(report,(k,v)=>(!Number.isFinite(v) && typeof v==='number') ? null : v,2)+'\n','utf8');
    console.log(`JSON: ${output.json}`);
  }
  if (output.csv) {
    const lines=['halBooBonusChance,bonus_percent,completion_rate,players_complete,halloween_x_owners,x_owner_rate,avg_unique_boo'];
    for(const r of report.curve) lines.push([r.chance,r.chance*100,r.completionRate,r.completed,r.xUsers,r.xRate,r.avgUnique].join(','));
    fs.writeFileSync(output.csv,lines.join('\n')+'\n','utf8');
    console.log(`CSV: ${output.csv}`);
  }
}

if (require.main === module) {
  try { const {conf,output}=parseArguments(process.argv.slice(2));const report=simulate(conf);showReport(report);exportReport(report,output); }
  catch(err) { console.error(`Error: ${err.message}`); process.exitCode=1; }
}
module.exports={SETTINGS,TAROTS,NEGATIVE_TAROTS,simulate,parseArguments,createTarotPicker,drawCollectible};
