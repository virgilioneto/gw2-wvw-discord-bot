const path = require('path');

const root = path.join(__dirname, '..');

/** Bot principal: reinício em crash; parada explícita (`pm2 stop`) não dispara novo start sozinho. */
module.exports = {
  apps: [
    {
      name: 'gw2-wvw-bot',
      cwd: root,
      script: 'index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 16,
    },
  ],
};
