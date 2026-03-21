const path = require('path');

const root = path.join(__dirname, '..');

/**
 * Job a cada 10 minutos; `autorestart: false` evita novo processo logo após o exit —
 * a próxima execução vem do cron. Se uma rodada durar mais que 10 minutos, avalie lock no job.
 */
module.exports = {
  apps: [
    {
      name: 'sync-guild-members',
      cwd: root,
      script: 'jobs/sync-guild-members.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      cron_restart: '*/10 * * * *',
    },
  ],
};
