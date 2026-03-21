const path = require('path');

const root = path.join(__dirname, '..');

/** Uma vez por dia ao meio-dia (fuso do servidor; ajuste TZ no env se precisar). */
module.exports = {
  apps: [
    {
      name: 'notify-wvw-members',
      cwd: root,
      script: 'jobs/notify-wvw-members.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      cron_restart: '0 12 * * *',
      env: {
        // TZ: 'America/Sao_Paulo',
      },
    },
  ],
};
