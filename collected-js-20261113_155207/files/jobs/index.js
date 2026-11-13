const { scheduleWeeklyBosses } = require('./bossScheduler');
const { activateAndEndEvents } = require('./bossActivator');
const { announceActivatedEvents } = require('./bossAnnouncer');
const { settleEndedEvents } = require('./settleBoss'); // if you created settle job

function startJobs(client) {
  // schedule weekly picks once on startup (seed can be deterministic if desired)
  scheduleWeeklyBosses({ seed: String(Date.now()) }).catch(err => console.error('scheduleWeeklyBosses error', err));

  // periodic activator + announcer
  setInterval(async () => {
    try {
      await activateAndEndEvents();
      await announceActivatedEvents(client);
    } catch (e) { console.error('activator loop error', e); }
  }, 60_000); // every 1 minute

  // periodic settlement
  setInterval(async () => {
    try { await settleEndedEvents(); } catch (e) { console.error('settle loop error', e); }
  }, 60_000); // every 1 minute
}

module.exports = { startJobs };
