'use strict';

require('dotenv').config();

module.exports = {
  development: {
    url: process.env.POSTGRES_URI,
    dialect: 'postgres',
    logging: false,
  },
  production: {
    url: process.env.POSTGRES_URI,
    dialect: 'postgres',
    logging: false,
  },
};
