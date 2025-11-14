// commands/nextBirthdays.js
const { SlashCommandBuilder } = require('discord.js');
const oshis = require('../../config/oshis');
const { jstDateString } = require('../../utils/jst');

/**
 * Helper: produce a Date (UTC-backed) that corresponds to JST midnight for given y,m,d
 * JST midnight = UTC (y, m-1, d, -9:00)
 */
function jstMidnightUtcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 0 - 9, 0, 0, 0));
}

/**
 * Helper: get "now" in JST as a Date object (fields reflect JST)
 */
function jstNowDate() {
  // build from jstDateString to ensure consistency with your helper
  const today = jstDateString(new Date()); // "YYYY-MM-DD"
  const [y, m, d] = today.split('-').map(Number);
  // return the UTC-backed Date that represents JST midnight of "today" (00:00 JST)
  // then add current JST time offset by using actual Date now to preserve time-of-day
  const utcNow = new Date();
  const utcMs = utcNow.getTime() + utcNow.getTimezoneOffset() * 60000;
  const jstMs = utcMs + 9 * 60 * 60000;
  return new Date(jstMs);
}

/**
 * Compute next occurrence (UTC-backed Date representing JST midnight) for given month/day.
 * If this year's occurrence is today or in the past (JST), returns next year's occurrence.
 */
function nextOccurrenceJst(month, day, fromJstDate = null) {
  const from = fromJstDate || jstNowDate();
  const year = from.getFullYear();

  let candidate = jstMidnightUtcDate(year, month, day);

  // convert candidate and 'from' to JST-local dates for comparison
  const candJst = new Date(candidate.getTime() + 9 * 60 * 60000);
  const fromJst = new Date(from.getTime());

  const candKey = `${candJst.getFullYear()}${String(candJst.getMonth()+1).padStart(2,'0')}${String(candJst.getDate()).padStart(2,'0')}`;
  const fromKey = `${fromJst.getFullYear()}${String(fromJst.getMonth()+1).padStart(2,'0')}${String(fromJst.getDate()).padStart(2,'0')}`;

  if (Number(candKey) <= Number(fromKey)) {
    candidate = jstMidnightUtcDate(year + 1, month, day);
  }

  return candidate;
}

function daysBetweenCeil(fromDate, toDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((toDate.getTime() - fromDate.getTime()) / msPerDay);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nextbirthdays')
    .setDescription('Show the next 5 upcoming oshi birthdays (JST).'),
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    try {
      const nowJst = jstNowDate();

      const list = oshis.map(o => {
        const next = nextOccurrenceJst(o.bdayMonth, o.bdayDay, nowJst);
        const nextJst = new Date(next.getTime() + 9 * 60 * 60000); // to display JST fields
        const display = `${nextJst.getFullYear()}/${String(nextJst.getMonth()+1).padStart(2,'0')}/${String(nextJst.getDate()).padStart(2,'0')}`;
        const days = daysBetweenCeil(nowJst, next);
        return { id: o.id, label: o.label, gen: o.gen, image: o.image, nextDate: next, display, days };
      });

      list.sort((a, b) => a.nextDate - b.nextDate);
      const nextFive = list.slice(0, 10);

      const lines = nextFive.map((x, idx) => {
        const dayWord = x.days === 0 ? 'Today' : `${x.days} day${x.days === 1 ? '' : 's'}`;
        const genText = x.gen ? ` • ${x.gen}` : '';
        return `**${idx + 1}. ${x.label}**${genText}\n> Date : ${x.display} • ${dayWord}`;
      });

      const embed = {
        title: 'Upcoming Birthdays',
        description: lines.join('\n\n'),
        color: 0xff99cc,
        timestamp: new Date().toISOString(),
        footer: { text: 'YYYY/MM/DD Format' },
      };

      const primary = nextFive[0];
      if (primary && primary.image) embed.thumbnail = { url: primary.image };

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[nextBirthdays] error', err);
      try { await interaction.editReply({ content: 'Failed to compute upcoming birthdays. Try again later.' }); } catch {}
    }
  },
};
