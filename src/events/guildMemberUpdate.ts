import { GuildMember, PartialGuildMember } from 'discord.js';
import { Guild } from '../models/Guild';
import { pendingGameIdByUser } from '../utils/pendingDm';

/**
 * Envia DM quando o usuário recebe a role base (base_discord_role) do servidor,
 * pedindo o ID de jogo para vincular à guilda.
 */
export async function handleGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): Promise<void> {
  const discordServerId = newMember.guild?.id;
  if (!discordServerId) return;

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc?.base_discord_role) return;

  const baseRoleId = guildDoc.base_discord_role;
  const hasBaseRoleNow = newMember.roles.cache.has(baseRoleId);
  if (!hasBaseRoleNow) return;

  const hadBaseRoleBefore = oldMember.roles?.cache?.has(baseRoleId) ?? false;
  if (hadBaseRoleBefore) return;

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
