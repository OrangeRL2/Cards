const BossEvent = require('../models/BossEvent');
const oshis = require('../config/oshis'); // array of { id, label, ... }
const { nanoid } = require('nanoid');
const seedrandom = require('seedrandom');

function nextDateForWeekday(weekday, hour) {
  // weekday: 0=Sun..6=Sat, hour: 0..23 (JST assumed by server timezone)
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  const delta = (weekday - target.getDay() + 7) % 7;
  if (delta === 0 && target <= now) target.setDate(target.getDate() + 7);
  else target.setDate(target.getDate() + delta);
  return target;
}

function pickRandomFrom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

async function scheduleWeeklyBosses({ seed }) {
  // seed can be ISO week + secret or a provided seed for deterministic picks
  const rng = seedrandom(seed || String(Date.now()));
  const monWed = [1,2,3];
  const friSun = [5,6,0];
  const day1 = pickRandomFrom(monWed, rng);
  const day2 = pickRandomFrom(friSun, rng);
  const hour1 = Math.floor(rng() * 24);
  const hour2 = Math.floor(rng() * 24);
  const oshi1 = pickRandomFrom(oshis, rng).id;
  const oshi2 = pickRandomFrom(oshis, rng).id;
  const spawnAt1 = nextDateForWeekday(day1, hour1);
  const spawnAt2 = nextDateForWeekday(day2, hour2);

  await BossEvent.create([
    { eventId: nanoid(), oshiId: oshi1, spawnAt: spawnAt1, endsAt: new Date(spawnAt1.getTime() + 24*3600*1000) },
    { eventId: nanoid(), oshiId: oshi2, spawnAt: spawnAt2, endsAt: new Date(spawnAt2.getTime() + 24*3600*1000) }
  ]);
}

module.exports = { scheduleWeeklyBosses };
