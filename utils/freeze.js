// utils/freeze.js
// Put Discord user IDs / role IDs here

const FROZEN_USER_IDS = new Set([
   '153551890976735232',
   '409717160995192832'
]);

const FROZEN_ROLE_IDS = new Set([
   '844054364033384470',
]);

/**
 * @param {string} userId
 * @param {import('discord.js').GuildMember | null} member
 */
function isFrozen(userId, member) {
  if (FROZEN_USER_IDS.has(userId)) return true;

  // Roles only exist in guild context
  if (member?.roles?.cache) {
    for (const roleId of FROZEN_ROLE_IDS) {
      if (member.roles.cache.has(roleId)) return true;
    }
  }
  return false;
}

module.exports = { FROZEN_USER_IDS, FROZEN_ROLE_IDS, isFrozen };