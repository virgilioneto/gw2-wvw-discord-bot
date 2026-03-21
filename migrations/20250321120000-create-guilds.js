'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
/** @param {typeof import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('guilds', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      guild_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      discord_server_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      api_key: {
        type: Sequelize.STRING(512),
        allowNull: false,
      },
      recruitment_channel: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '',
      },
      notify_channel: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '',
      },
      notification_roles: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      member_role: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      recruitment_message: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      notification_message: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('guilds');
  },
};
