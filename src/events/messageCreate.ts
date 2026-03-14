import { Message } from 'discord.js';
import { Guild } from '../models/Guild';
import { GuildMember, type GuildMemberStatus } from '../models/GuildMember';
import { pendingGameIdByUser } from '../utils/pendingDm';
import { getStatusLabel } from '../constants/statusLabels';

/** GW2 account names look like "Name.1234" */
export const GAME_ID_REGEX = /([\w.-]+\.\d{4})/i;

export async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId && message.channel.isDMBased()) {
    const {discordServerId, roles} = pendingGameIdByUser.get(message.author.id) || {};
    if (!discordServerId) return;

    const gameId = message.content.trim();
    if (!GAME_ID_REGEX.test(gameId)) {
      await message.reply("O ID informado não parece válido. Use o formato: **Nome.1234** (ex.: SeuNome.1234).");
      return;
    }

    const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
    if (!guildDoc) {
      pendingGameIdByUser.delete(message.author.id);
      return;
    }
    const existingMember = await GuildMember.findOne({ guild_id: guildDoc.guild_id, account_id: gameId }).exec();

    let status: GuildMemberStatus = 'PENDING_GUILD_DATA'
    if (existingMember) {
      status = existingMember.status === 'PENDING_DISCORD_DATA' ? 'CONFIRMED' : existingMember.status;
    }
    const guildRoleIds = Array.isArray(guildDoc.roles) ? guildDoc.roles : [];
    const memberRoles = guildRoleIds.filter((roleId) => roles?.includes(roleId) ?? false);
    await GuildMember.findOneAndUpdate(
      { guild_id: guildDoc.guild_id, account_id: gameId },
      {
        $set: {
          discord_user: message.author.id,
          status,
          roles: memberRoles,
        },
      },
      { upsert: true, new: true }
    ).exec();

    pendingGameIdByUser.delete(message.author.id);
    await message.reply(`Seu ID de jogo foi registrado com sucesso. Status: **${getStatusLabel(status)}**.`);
  }
}

/**
 * Handles messages in the guild's recruitment_channel: if the message content
 * matches GAME_ID_REGEX, registers the author using the same logic as the join command.
 */
export async function handleRecruitmentChannelMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const guildDoc = await Guild.findOne({ discord_server_id: message.guildId }).exec();
  if (!guildDoc?.recruitment_channel || guildDoc.recruitment_channel !== message.channelId) return;

  const match = message.content.trim().match(GAME_ID_REGEX);
  if (!match) return;
  const gameId = match[0];

  const member = message.member ?? (await message.guild?.members.fetch(message.author.id).catch(() => null));
  const guildRoleIds = Array.isArray(guildDoc.roles) ? guildDoc.roles : [];
  const memberRoles = member ? guildRoleIds.filter((roleId) => member.roles.cache.has(roleId)) : [];

  const existingDiscordUser = await GuildMember.findOne({
    guild_id: guildDoc.guild_id,
    discord_user: message.author.id,
  }).exec();
  if (existingDiscordUser && existingDiscordUser.account_id !== gameId) {
    await message.reply(`Você já está vinculado a outro ID de jogo (${existingDiscordUser.account_id}).`).catch(() => {});
    return;
  }

  const existingMember = await GuildMember.findOne({ guild_id: guildDoc.guild_id, account_id: gameId }).exec();
  if (existingMember?.discord_user && existingMember.discord_user !== message.author.id) {
    await message.reply('ID do jogo já está vinculado a outro usuário.').catch(() => {});
    return;
  }
  if (existingMember?.status === 'CONFIRMED') {
    await message.reply('ID do jogo já está confirmado.').catch(() => {});
    return;
  }

  let status: GuildMemberStatus = 'PENDING_GUILD_DATA';
  if (existingMember) {
    status = existingMember.status === 'PENDING_DISCORD_DATA' ? 'CONFIRMED' : existingMember.status;
  }
  await GuildMember.findOneAndUpdate(
    { guild_id: guildDoc.guild_id, account_id: gameId },
    {
      $set: {
        discord_user: message.author.id,
        status,
        roles: memberRoles,
      },
    },
    { upsert: true, new: true }
  ).exec();

  await message.reply(`ID de jogo registrado com sucesso. Status: **${getStatusLabel(status)}**.`).catch(() => {});
}
