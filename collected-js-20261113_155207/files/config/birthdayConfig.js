// config/birthdayConfig.js
// This file is the source of truth for which BDAY cards are active each month.
//
// Selector rules:
//   'Botan*'     -> every BDAY card whose filename starts with Botan
//   'Botan 001'  -> only that exact card basename
//
// To reduce an overcrowded month, simply remove/comment out selectors.
// You can also replace a wildcard with exact card names to choose only some
// birthday cards for that member.

module.exports = {
  // null = real JST date. Example debug value: '2026-10-01'
  debugDate: null,

  cardsByMonth: {
    1: [
      'Pekora*',
      'Polka*',
      'Risu*',
      'Amelia*',
    ],

    2: [
      'Aki*',
      'Choco*',
      'Okayu*',
      'Raden*',
      'Ao*',
      'Moona*',
      'Baelz*',
      'Fuwawa*',
      'Mococo*',
      'Achan*',
      'A-chan*', // filename alias for Achan
    ],

    3: [
      'Miko*',
      'Suisei*',
      'Nene*',
      'Koyori*',
      'Anya*',
      'IRyS*',
      'Kronii*',
      'Fauna*',
    ],

    4: [
      'Flare*',
      'Kanata*',
      'Kanade*',
      'Calli*',
      'Calliope*', // filename alias for Calli
      'Bijou*',
      'Elizabeth*',
    ],

    5: [
      'Sora*',
      'Roboco*',
      'Roboco-san*', // filename alias for Roboco
      'Chloe*',
      'La+*',
      'Laplus*', // filename alias for La+
      'Ririka*',
      'Riona*',
      'Ina*',
      'Inanis*', // filename alias for Ina
      'Shiori*',
      'Raora*',
      'Nodoka*',
    ],

    6: [
      'Watame*',
      'Coco*',
      'Lui*',
      'Iroha*',
      'Hajime*',
      'Su*',
      'Gura*',
      'Sana*',
    ],

    7: [
      'AZKi*',
      'Matsuri*',
      'Subaru*',
      'Marine*',
      'Chihaya*',
      'Niko*',
      'Iofi*',
      'Kiara*',
    ],

    8: [
      'Haato*',
      'Mio*',
      'Towa*',
      'Vivi*',
      'Kaela*',
      'Mumei*',
    ],

    9: [
      'Botan*',
      'Reine*',
    ],

    10: [
      'Fubuki*',
      'Korone*',
      'Luna*',
      'Ollie*',
      'Gigi*',
    ],

    11: [
      'Noel*',
      'Lamy*',
      'Zeta*',
      'Nerissa*',
      'Cecilia*',
    ],

    12: [
      'Aqua*',
      'Shion*',
      'Ayame*',
      'Kobo*',
    ],

  },
};
