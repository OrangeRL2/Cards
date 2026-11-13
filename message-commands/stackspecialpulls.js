// Stack a new 24-hour grant without clearing earlier special grants or quotas.
const specialpulls = require('./specialpulls');
module.exports = {
  name: 'stackspecialpulls',
  description: 'Owner-only: append a special-pull grant to the FIFO queue.',
  execute(message) {
    return specialpulls.execute(message, { stack: true });
  },
};
