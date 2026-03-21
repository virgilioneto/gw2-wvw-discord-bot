/**
 * Serviço centralizado para operações na tabela guild_members.
 * Todas as regras de status (PENDING_GUILD_DATA, PENDING_DISCORD_DATA, CONFIRMED)
 * e inserções/atualizações devem passar por aqui.
 */
import type { Guild } from 'discord.js';
import { GuildMember, IGuildMember, type GuildMemberStatus } from '../models/GuildMember';
import type { Gw2GuildMember } from './gw2GuildMembers';

function toPlain(m: GuildMember): IGuildMember {
  return m.toJSON() as IGuildMember;
}

/** Regra única: qual status atribuir ao vincular Discord a um account_id. */
export function computeStatusAfterLinkDiscord(existingMember: IGuildMember | null): GuildMemberStatus {
  if (!existingMember) return 'PENDING_GUILD_DATA';
  if (existingMember.status === 'PENDING_DISCORD_DATA') return 'CONFIRMED';
  return existingMember.status as GuildMemberStatus;
}

export type LinkDiscordParams = {
  guildId: string;
  accountId: string;
  discordUserId: string;
  roles: string[];
  recruitment_message_id?: string;
  recruitment_channel_id?: string;
  /**
   * ID da role Discord (Guild.member_role). Se o membro passar de PENDING_DISCORD_DATA → CONFIRMED,
   * esse ID é acrescentado ao array `roles` no registro (sem duplicar) e, se `discordGuild` existir,
   * a role é atribuída no servidor Discord.
   */
  memberRoleIdOnConfirm?: string;
  /** Servidor Discord onde aplicar `memberRoleIdOnConfirm` no membro (opcional). */
  discordGuild?: Guild | null;
};

export type LinkDiscordResult = { updated: IGuildMember; status: GuildMemberStatus };

/**
 * Vincula um usuário Discord a um account_id (game id).
 * Faz upsert e aplica a regra de status via computeStatusAfterLinkDiscord.
 */
export async function linkDiscordToGameId(params: LinkDiscordParams): Promise<LinkDiscordResult> {
  const { guildId, accountId, discordUserId, roles, recruitment_message_id, recruitment_channel_id } = params;
  const existingRow = await GuildMember.findOne({ where: { guild_id: guildId, account_id: accountId } });
  const existingMember = existingRow ? toPlain(existingRow) : null;
  const status = computeStatusAfterLinkDiscord(existingMember ?? null);

  const memberRoleToAdd = params.memberRoleIdOnConfirm?.trim();
  const shouldAddMemberRoleToRoles =
    existingMember?.status === 'PENDING_DISCORD_DATA' &&
    status === 'CONFIRMED' &&
    Boolean(memberRoleToAdd);

  let rolesToSet = [...roles];
  if (shouldAddMemberRoleToRoles && memberRoleToAdd && !rolesToSet.includes(memberRoleToAdd)) {
    rolesToSet = [...rolesToSet, memberRoleToAdd];
  }

  const updatePayload: Partial<IGuildMember> = {
    discord_user: discordUserId,
    status,
    roles: rolesToSet,
  };
  if (recruitment_message_id !== undefined) updatePayload.recruitment_message_id = recruitment_message_id;
  if (recruitment_channel_id !== undefined) updatePayload.recruitment_channel_id = recruitment_channel_id;

  let updated: GuildMember;
  if (existingRow) {
    await existingRow.update(updatePayload);
    updated = existingRow;
  } else {
    updated = await GuildMember.create({
      guild_id: guildId,
      account_id: accountId,
      discord_user: discordUserId,
      status,
      roles: rolesToSet,
      wvw_member: false,
      recruitment_message_id: recruitment_message_id ?? null,
      recruitment_channel_id: recruitment_channel_id ?? null,
    });
  }

  if (shouldAddMemberRoleToRoles && memberRoleToAdd && params.discordGuild) {
    try {
      const member = await params.discordGuild.members.fetch(discordUserId).catch(() => null);
      if (member && !member.roles.cache.has(memberRoleToAdd)) {
        await member.roles.add(memberRoleToAdd).catch(() => {});
      }
    } catch {
      // falha de permissão / hierarquia de roles — banco já foi atualizado
    }
  }

  return { updated: toPlain(updated), status };
}

/**
 * Cria um membro a partir dos dados da API (sync): novo membro na guilda GW2.
 * Status: PENDING_DISCORD_DATA.
 */
export async function createFromApiMember(guildId: string, apiMember: Gw2GuildMember): Promise<IGuildMember> {
  const joined = apiMember.joined ? new Date(apiMember.joined) : new Date();
  const doc = await GuildMember.create({
    account_id: apiMember.name,
    guild_id: guildId,
    wvw_member: apiMember.wvw_member,
    joined_at: joined,
    status: 'PENDING_DISCORD_DATA',
    roles: [],
  });
  return toPlain(doc);
}

/**
 * Marca membro como PENDING_GUILD_DATA (saiu da guilda na API ou ainda não confirmado pela API).
 */
export async function markAsPendingGuildData(guildId: string, accountId: string): Promise<void> {
  await GuildMember.update(
    { status: 'PENDING_GUILD_DATA', joined_at: null },
    { where: { guild_id: guildId, account_id: accountId } }
  );
}

export type ConfirmFromGuildDataResult = {
  channelId?: string;
  messageId?: string;
};

/**
 * Atualiza PENDING_GUILD_DATA → CONFIRMED quando a API confirma o membro na guilda.
 * Retorna recruitment_message_id/channel se existirem (para reação no canal).
 */
export async function confirmFromGuildData(
  guildId: string,
  accountId: string,
  joinedAt: Date
): Promise<ConfirmFromGuildDataResult> {
  const current = await GuildMember.findOne({ where: { guild_id: guildId, account_id: accountId } });
  const result: ConfirmFromGuildDataResult = {};
  if (current?.recruitment_channel_id) result.channelId = current.recruitment_channel_id;
  if (current?.recruitment_message_id) result.messageId = current.recruitment_message_id;

  await GuildMember.update(
    { status: 'CONFIRMED', joined_at: joinedAt },
    { where: { guild_id: guildId, account_id: accountId } }
  );

  return result;
}

/**
 * Upsert usado no /configurar (setup): membros vindos da API na primeira configuração.
 * Se o registro já existe, atualiza dados da API; no insert, status = PENDING_DISCORD_DATA.
 */
export async function upsertFromSetup(guildId: string, apiMember: Gw2GuildMember): Promise<void> {
  const joinedAt = apiMember.joined ? new Date(apiMember.joined) : new Date();
  const [row, created] = await GuildMember.findOrCreate({
    where: { guild_id: guildId, account_id: apiMember.name },
    defaults: {
      guild_id: guildId,
      account_id: apiMember.name,
      wvw_member: apiMember.wvw_member,
      joined_at: joinedAt,
      status: 'PENDING_DISCORD_DATA',
      roles: [],
    },
  });
  if (!created) {
    await row.update({
      wvw_member: apiMember.wvw_member,
      joined_at: joinedAt,
    });
  }
}

/**
 * Lista membros confirmados, sem WvW atribuído, que tenham pelo menos uma das roles da guilda.
 * Usado por /jogadores-pendente e pelo job notify-wvw-members.
 */
export async function findPendingWvwMembers(
  guildId: string,
  guildRoleIds: string[]
): Promise<IGuildMember[]> {
  if (guildRoleIds.length === 0) return [];
  const rows = await GuildMember.findAll({
    where: {
      guild_id: guildId,
      status: 'CONFIRMED',
      wvw_member: false,
    },
  });
  const roleSet = new Set(guildRoleIds);
  return rows
    .filter((r) => {
      const roles = (r.roles as string[]) ?? [];
      return roles.some((id) => roleSet.has(id));
    })
    .map((r) => toPlain(r));
}

/** Busca por guild_id + account_id. */
export async function findByGuildAndAccount(
  guildId: string,
  accountId: string
): Promise<IGuildMember | null> {
  const row = await GuildMember.findOne({ where: { guild_id: guildId, account_id: accountId } });
  return row ? toPlain(row) : null;
}

/** Busca por guild_id + discord_user. */
export async function findByGuildAndDiscordUser(
  guildId: string,
  discordUserId: string
): Promise<IGuildMember | null> {
  const row = await GuildMember.findOne({ where: { guild_id: guildId, discord_user: discordUserId } });
  return row ? toPlain(row) : null;
}

/** Remove um membro (ex.: substituição de ID de jogo). */
export async function removeMember(guildId: string, accountId: string): Promise<void> {
  await GuildMember.destroy({ where: { guild_id: guildId, account_id: accountId } });
}

/**
 * Adiciona ao array `roles` do guild_member o ID da role Discord de membro (Guild.member_role)
 * quando essa role é atribuída ao usuário no Discord (sem duplicar).
 */
export async function addMemberRoleToGuildMemberRoles(
  gw2GuildId: string,
  discordUserId: string,
  discordMemberRoleId: string
): Promise<void> {
  const row = await GuildMember.findOne({ where: { guild_id: gw2GuildId, discord_user: discordUserId } });
  if (!row) return;
  const roles = [...((row.roles as string[]) ?? [])];
  if (!roles.includes(discordMemberRoleId)) roles.push(discordMemberRoleId);
  await row.update({ roles });
}
