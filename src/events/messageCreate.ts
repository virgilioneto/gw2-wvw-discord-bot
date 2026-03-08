import { Message } from 'discord.js';
import { Guild } from '../models/Guild';
import { GuildMember } from '../models/GuildMember';
import { pendingGameIdByUser } from '../utils/pendingDm';

/** GW2 account names look like "Name.1234" */
const GAME_ID_REGEX = /^[\w\s.-]+\.\d{4}$/i;

export async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId && message.channel.isDMBased()) {
    const discordServerId = pendingGameIdByUser.get(message.author.id);
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

    let status = 'PENDING_GUILD_DATA'
    if (existingMember) {
      status = existingMember.status === 'PENDING_DISCORD_DATA' ? 'CONFIRMED' : existingMember.status;
    }
    const guildRoleIds = Array.isArray(guildDoc.roles) ? guildDoc.roles : [];
    const memberRoles = guildRoleIds.filter((roleId) => message.member?.roles.cache.has(roleId) ?? false);
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
    await message.reply(`Seu ID de jogo foi registrado com sucesso. Status: **${status}**.`);
  }
}
