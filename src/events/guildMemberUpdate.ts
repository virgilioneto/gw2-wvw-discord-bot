import { GuildMember, PartialGuildMember } from 'discord.js';
import { Guild } from '../models/Guild';
import { pendingGameIdByUser } from '../utils/pendingDm';
import { findByGuildAndDiscordUser } from '../services/guildMemberService';

/**
 * Envia DM quando o usuário recebe uma das roles configuradas da guilda no servidor,
 * pedindo o ID de jogo para vincular à guilda.
 */
export async function handleGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): Promise<void> {
  const discordServerId = newMember.guild?.id;
  if (!discordServerId) return;

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc) return;

  const guildRoleIds = Array.isArray(guildDoc?.notification_roles) ? guildDoc?.notification_roles : [];
  if (guildRoleIds.length === 0) return;

  const existingDiscordUser = await findByGuildAndDiscordUser(guildDoc.guild_id, newMember.id);
  if (existingDiscordUser) return;

  const gainedRoleId = guildRoleIds.find((roleId) => {
    const hasNow = newMember.roles.cache.has(roleId);
    const hadBefore = oldMember.roles?.cache?.has(roleId) ?? false;
    return hasNow && !hadBefore;
  });
  if (!gainedRoleId) return;

  try {
    const dm = await newMember.createDM();
    await dm.send(
      `Olá ${newMember.displayName}! Para poder jogar com a **${guildDoc?.name}**, informe seu ID de jogo (ex.: SeuNome.1234) por aqui.`
    );
    pendingGameIdByUser.set(newMember.id, {discordServerId, roles: newMember.roles.cache.map((role) => role.id)});
  } catch {
    // User may have DMs disabled - ignore
  }
}
