const mongoose = require('mongoose');
const { mongoUri } = require('../config.json');

async function migrate() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const users = db.collection('users');

  console.log('Starting card timestamp migration…');

  const result = await users.updateMany(
    { 'cards.timestamps.0': { $exists: true } }, // only cards that have timestamps
    [
      {
        $set: {
          cards: {
            $map: {
              input: '$cards',
              as: 'card',
              in: {
                $mergeObjects: [
                  '$$card',
                  {
                    firstAcquiredAt: {
                      $ifNull: [
                        '$$card.firstAcquiredAt',
                        { $arrayElemAt: ['$$card.timestamps', 0] }
                      ]
                    },
                    lastAcquiredAt: {
                      $ifNull: [
                        '$$card.lastAcquiredAt',
                        {
                          $arrayElemAt: [
                            '$$card.timestamps',
                            { $subtract: [{ $size: '$$card.timestamps' }, 1] }
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      },
      {
        $unset: 'cards.timestamps'
      }
    ]
  );

  console.log(`Matched: ${result.matchedCount}`);
  console.log(`Modified: ${result.modifiedCount}`);
  console.log('Migration complete.');

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
