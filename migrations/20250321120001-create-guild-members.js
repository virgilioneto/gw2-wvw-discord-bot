'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
/** @param {typeof import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('guild_members', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      account_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      discord_user: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      guild_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      wvw_member: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      joined_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      roles: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      recruitment_message_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      recruitment_channel_id: {
        type: Sequelize.STRING,
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

    await queryInterface.addConstraint('guild_members', {
      fields: ['guild_id', 'account_id'],
      type: 'unique',
      name: 'guild_members_guild_id_account_id_unique',
    });

    await queryInterface.addIndex('guild_members', ['guild_id'], {
      name: 'guild_members_guild_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('guild_members');
  },
};
