import type { Guild, GuildMember } from 'discord.js';

/** Membro do servidor (GuildMember) ou dados da API (roles como array de IDs). */
type MemberOrRoleIds = GuildMember | { roles: string[] } | null;

/**
 * Verifica se o membro compartilha pelo menos uma role com o bot no servidor.
 * A role @everyone é ignorada (todos a têm).
 * Retorna false se o servidor, o membro do usuário ou o membro do bot não existir.
 */
export function userSharesRoleWithBot(guild: Guild | null, member: MemberOrRoleIds): boolean {
  if (!guild || !member) return false;
  const botMember = guild.members.me;
  if (!botMember) return false;
  const guildId = guild.id;
  const botRoleIds = new Set(
    Array.from(botMember.roles.cache.keys()).filter((id) => id !== guildId)
  );
  if (botRoleIds.size === 0) return false;
  const userRoleIds = 'cache' in member.roles
    ? Array.from((member as GuildMember).roles.cache.keys())
    : (member as { roles: string[] }).roles;
  for (const roleId of userRoleIds) {
    if (roleId !== guildId && botRoleIds.has(roleId)) return true;
  }
  return false;
}
