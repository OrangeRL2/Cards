module.exports = Object.freeze({
  summer_activity_default: [
    { type: 'shells', amount: 10, weight: 40 },
    { type: 'shells', amount: 20, weight: 28 },
    { type: 'shells', amount: 40, weight: 15 },
    { type: 'sunPulls', amount: 1, weight: 10 },
    { type: 'sunCard', amount: 1, weight: 7 },
  ],

  summer_activity_exception: [
    { type: 'shells', amount: 500, weight: 100 },
  ],
    summer_activity_exception2: [
    { type: 'shells', amount: 100, weight: 100 },
  ],

  // Day 21 Glitched Bingo: 100 guaranteed shells per row.
  // utils/summerActivity.js adds +50 for each correct Bingo call.
  summer_activity_bingo: [
    { type: 'shells', amount: 100, weight: 100 },
  ],
  summer_activity_sunPull_exception: [
    {
      type: 'bundle',
      weight: 100,
      rewards: [
        { type: 'sunPulls', amount: 5 },
        { type: 'shells', amount: 50 },
      ],
    },
  ],
  summer_activity_finale_1000: [
    { type: 'shells', amount: 1000, weight: 100 },
  ],

});