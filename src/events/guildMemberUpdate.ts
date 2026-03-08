import { GuildMember, PartialGuildMember } from 'discord.js';
import { Guild } from '../models/Guild';
import { pendingGameIdByUser } from '../utils/pendingDm';

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
  const guildRoleIds = Array.isArray(guildDoc?.roles) ? guildDoc?.roles : [];
  if (guildRoleIds.length === 0) return;

  const gainedRoleId = guildRoleIds.find((roleId) => {
    const hasNow = newMember.roles.cache.has(roleId);
    const hadBefore = oldMember.roles?.cache?.has(roleId) ?? false;
    return hasNow && !hadBefore;
  });
  if (!gainedRoleId) return;

  try {
    const dm = await newMember.createDM();
    await dm.send(
      "**Esgoto do WvW** — Olá! Este servidor está vinculado a uma guilda do Guild Wars 2. Por favor, informe seu **ID de jogo** (ex.: SeuNome.1234) por aqui para que possamos te reconhecer."
    );
    pendingGameIdByUser.set(newMember.id, discordServerId);
  } catch {
    // User may have DMs disabled - ignore
  }
}
