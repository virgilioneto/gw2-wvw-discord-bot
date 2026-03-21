/**
 * Todas as apps: pm2 start pm2/ecosystem.config.cjs
 * Uma app: pm2 start pm2/bot.config.cjs
 *
 * Requer: npm run build
 */
module.exports = {
  apps: [
    ...require('./bot.config.cjs').apps,
    ...require('./sync-guild-members.config.cjs').apps,
    ...require('./notify-wvw-members.config.cjs').apps,
  ],
};
