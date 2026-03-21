/**
 * Serviço centralizado para operações na collection guild_members.
 * Todas as regras de status (PENDING_GUILD_DATA, PENDING_DISCORD_DATA, CONFIRMED)
 * e inserções/atualizações devem passar por aqui.
 */
import type { Guild } from 'discord.js';
import { GuildMember, IGuildMember, type GuildMemberStatus } from '../models/GuildMember';
import type { Gw2GuildMember } from './gw2GuildMembers';

/** Regra única: qual status atribuir ao vincular Discord a um account_id. */
export function computeStatusAfterLinkDiscord(existingMember: IGuildMember | null): GuildMemberStatus {
  if (!existingMember) return 'PENDING_GUILD_DATA';
  if (existingMember.status === 'PENDING_DISCORD_DATA') return 'CONFIRMED';
  return existingMember.status;
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
   * esse ID é acrescentado ao array `roles` no documento (sem duplicar) e, se `discordGuild` existir,
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
  const existingMember = await GuildMember.findOne({ guild_id: guildId, account_id: accountId }).lean<IGuildMember>().exec();
  const status = computeStatusAfterLinkDiscord(existingMember ?? null);

  const memberRoleToAdd = params.memberRoleIdOnConfirm?.trim();
  const shouldAddMemberRoleToRoles =
    existingMember?.status === 'PENDING_DISCORD_DATA' &&
    status === 'CONFIRMED' &&
    Boolean(memberRoleToAdd);

  // Não misturar $set.roles e $addToSet.roles no mesmo update — o MongoDB retorna conflito.
  let rolesToSet = [...roles];
  if (shouldAddMemberRoleToRoles && memberRoleToAdd && !rolesToSet.includes(memberRoleToAdd)) {
    rolesToSet = [...rolesToSet, memberRoleToAdd];
  }

  const updatePayload: Record<string, unknown> = {
    discord_user: discordUserId,
    status,
    roles: rolesToSet,
  };
  if (recruitment_message_id !== undefined) updatePayload.recruitment_message_id = recruitment_message_id;
  if (recruitment_channel_id !== undefined) updatePayload.recruitment_channel_id = recruitment_channel_id;

  const updated = await GuildMember.findOneAndUpdate(
    { guild_id: guildId, account_id: accountId },
    { $set: updatePayload },
    { upsert: true, new: true }
  )
    .lean<IGuildMember>()
    .exec();

  if (!updated) throw new Error('GuildMember.findOneAndUpdate returned null');

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

  return { updated, status };
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
  });
  return doc.toObject();
}

/**
 * Marca membro como PENDING_GUILD_DATA (saiu da guilda na API ou ainda não confirmado pela API).
 */
export async function markAsPendingGuildData(guildId: string, accountId: string): Promise<void> {
  await GuildMember.findOneAndUpdate(
    { guild_id: guildId, account_id: accountId },
    { $set: { status: 'PENDING_GUILD_DATA', joined_at: null } }
  ).exec();
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
  const current = await GuildMember.findOne({ guild_id: guildId, account_id: accountId }).lean<IGuildMember>().exec();
  const result: ConfirmFromGuildDataResult = {};
  if (current?.recruitment_channel_id) result.channelId = current.recruitment_channel_id;
  if (current?.recruitment_message_id) result.messageId = current.recruitment_message_id;

  await GuildMember.findOneAndUpdate(
    { guild_id: guildId, account_id: accountId },
    { $set: { status: 'CONFIRMED', joined_at: joinedAt } }
  ).exec();

  return result;
}

/**
 * Upsert usado no /configurar (setup): membros vindos da API na primeira configuração.
 * Se o documento já existe, atualiza dados da API; no insert, status = PENDING_DISCORD_DATA.
 */
export async function upsertFromSetup(guildId: string, apiMember: Gw2GuildMember): Promise<void> {
  const joinedAt = apiMember.joined ? new Date(apiMember.joined) : new Date();
  await GuildMember.findOneAndUpdate(
    { guild_id: guildId, account_id: apiMember.name },
    {
      $set: {
        account_id: apiMember.name,
        guild_id: guildId,
        wvw_member: apiMember.wvw_member,
        joined_at: joinedAt,
      },
      $setOnInsert: { status: 'PENDING_DISCORD_DATA' },
    },
    { upsert: true }
  ).exec();
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
  return GuildMember.find({
    guild_id: guildId,
    status: 'CONFIRMED',
    wvw_member: false,
    roles: { $in: guildRoleIds },
  })
    .lean<IGuildMember[]>()
    .exec();
}

/** Busca por guild_id + account_id. */
export async function findByGuildAndAccount(
  guildId: string,
  accountId: string
): Promise<IGuildMember | null> {
  return GuildMember.findOne({ guild_id: guildId, account_id: accountId }).lean<IGuildMember | null>().exec();
}

/** Busca por guild_id + discord_user. */
export async function findByGuildAndDiscordUser(
  guildId: string,
  discordUserId: string
): Promise<IGuildMember | null> {
  return GuildMember.findOne({ guild_id: guildId, discord_user: discordUserId }).lean<IGuildMember | null>().exec();
}

/** Remove um membro (ex.: substituição de ID de jogo). */
export async function removeMember(guildId: string, accountId: string): Promise<void> {
  await GuildMember.deleteOne({ guild_id: guildId, account_id: accountId }).exec();
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
  await GuildMember.findOneAndUpdate(
    { guild_id: gw2GuildId, discord_user: discordUserId },
    { $addToSet: { roles: discordMemberRoleId } }
  ).exec();
}
