/**
 * Serviço compartilhado: sincroniza membros de uma guilda GW2 com a collection guild_members.
 * Usado pelo job sync-guild-members e pelo comando /sync.
 * Delega inserções e regras de status ao guildMemberService.
 */
import type { Guild, TextChannel } from 'discord.js';
import { GuildMember, IGuildMember } from '../models/GuildMember';
import { getGuildMembers, Gw2GuildMember } from './gw2GuildMembers';
import {
  createFromApiMember,
  markAsPendingGuildData,
  confirmFromGuildData,
} from './guildMemberService';
import { reactRecruitmentMessageConfirmed } from '../utils/recruitmentMessage';

export type RecruitmentMessageToConfirm = { channelId: string; messageId: string };

/** Discord user ids dos membros que passaram a CONFIRMED e têm recruitment_channel_id e recruitment_message_id. */
export type ConfirmedRecruitmentUserId = string;

/** Discord user ids dos membros que passaram a CONFIRMED, têm discord_user preenchido,
 *  mas não possuem recruitment_channel_id/message_id (para envio via DM).
 */
export type ConfirmedWithoutRecruitmentUserId = string;

export type SyncMembersResult =
  | {
      ok: true;
      pendingGuildDataCount: number;
      pendingDiscordDataCount: number;
      confirmedCount: number;
      recruitmentMessagesToConfirm: RecruitmentMessageToConfirm[];
      confirmedRecruitmentDiscordUserIds: ConfirmedRecruitmentUserId[];
      confirmedWithoutRecruitmentDiscordUserIds: ConfirmedWithoutRecruitmentUserId[];
    }
  | { ok: false; error: string };

/** Config da guilda necessária para aplicar ações pós-sync (recrutamento, member_role). */
export type PostSyncGuildConfig = {
  recruitment_message?: { content?: string };
  recruitment_channel?: string;
  notification_roles?: string[];
  member_role?: string;
};

/**
 * Aplica as ações pós-sincronização: reação em mensagens de recrutamento,
 * DM e mensagem no canal para confirmados, atribuição de member_role.
 * Usado pelo comando /atualizar e pelo job sync-guild-members.
 */
export async function applyPostSyncActions(
  discordGuild: Guild,
  guildConfig: PostSyncGuildConfig,
  result: Extract<SyncMembersResult, { ok: true }>
): Promise<void> {
  const { recruitmentMessagesToConfirm, confirmedRecruitmentDiscordUserIds, confirmedWithoutRecruitmentDiscordUserIds } = result;

  for (const { channelId, messageId } of recruitmentMessagesToConfirm ?? []) {
    await reactRecruitmentMessageConfirmed(discordGuild, channelId, messageId);
  }

  const recruitmentDmContent = guildConfig.recruitment_message?.content?.trim();
  if (recruitmentDmContent && confirmedWithoutRecruitmentDiscordUserIds?.length) {
    for (const userId of confirmedWithoutRecruitmentDiscordUserIds) {
      try {
        const user = await discordGuild.client.users.fetch(userId);
        await user.send(recruitmentDmContent).catch(() => {});
      } catch {
        // ignora falha em DM individual
      }
    }
  }

  const recruitmentContent = guildConfig.recruitment_message?.content?.trim();
  if (
    recruitmentContent &&
    confirmedRecruitmentDiscordUserIds?.length > 0 &&
    guildConfig.recruitment_channel
  ) {
    const channel = await discordGuild.channels.fetch(guildConfig.recruitment_channel).catch(() => null);
    if (channel?.isTextBased()) {
      const mentions = confirmedRecruitmentDiscordUserIds.map((id) => `<@${id}>`).join(' ');
      await (channel as TextChannel)
        .send({
          content: `${mentions}\n${recruitmentContent}`,
          allowedMentions: { users: confirmedRecruitmentDiscordUserIds },
        })
        .catch(console.error);
    }
  }

  const memberRoleId = guildConfig.member_role?.trim();
  if (memberRoleId) {
    const notificationRoleIds = Array.isArray(guildConfig.notification_roles) ? guildConfig.notification_roles : [];
    const allConfirmedUserIds = [
      ...(confirmedRecruitmentDiscordUserIds ?? []),
      ...(confirmedWithoutRecruitmentDiscordUserIds ?? []),
    ];
    for (const userId of allConfirmedUserIds) {
      try {
        const member = await discordGuild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        const hasAnyNotificationRole = notificationRoleIds.some((roleId) => member.roles.cache.has(roleId));
        if (!hasAnyNotificationRole && !member.roles.cache.has(memberRoleId)) {
          await member.roles.add(memberRoleId).catch(() => {});
        }
      } catch {
        // ignora falha ao atribuir role individual
      }
    }
  }
}

export async function syncMembersForGuild(
  guildId: string,
  apiKey: string
): Promise<SyncMembersResult> {
  const result = await getGuildMembers(guildId, apiKey);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  let confirmedCount = 0;
  let pendingGuildDataCount = 0;
  let pendingDiscordDataCount = 0;
  const recruitmentMessagesToConfirm: RecruitmentMessageToConfirm[] = [];
  const confirmedRecruitmentDiscordUserIds: ConfirmedRecruitmentUserId[] = [];
  const confirmedWithoutRecruitmentDiscordUserIds: ConfirmedWithoutRecruitmentUserId[] = [];

  const dbMembers = await GuildMember.find({ guild_id: guildId }).lean<IGuildMember[]>();
  const dbMembersMap = new Map<string, IGuildMember>(dbMembers.map((m) => [m.account_id, m]));

  const apiMembers = result.members;
  const apiMembersMap = new Map<string, Gw2GuildMember>(apiMembers.map((m) => [m.name, m]));

  for (const [accountId, apiMember] of apiMembersMap.entries()) {
    const joined = apiMember.joined ? new Date(apiMember.joined) : new Date();
    if (dbMembersMap.has(accountId)) {
      const dbMember = dbMembersMap.get(accountId);

      if (dbMember?.status === 'PENDING_GUILD_DATA') {
        const confirmResult = await confirmFromGuildData(guildId, accountId, joined);
        if (dbMember.discord_user) {
          if (confirmResult.channelId && confirmResult.messageId) {
            recruitmentMessagesToConfirm.push({
              channelId: confirmResult.channelId,
              messageId: confirmResult.messageId,
            });
            confirmedRecruitmentDiscordUserIds.push(dbMember.discord_user);
          } else {
            confirmedWithoutRecruitmentDiscordUserIds.push(dbMember.discord_user);
          }
        }
        confirmedCount++;
      }

      dbMembersMap.delete(accountId);
    } else {
      await createFromApiMember(guildId, apiMember);
      pendingDiscordDataCount++;
    }
  }

  for (const [accountId] of dbMembersMap.entries()) {
    await markAsPendingGuildData(guildId, accountId);
    pendingGuildDataCount++;
  }

  return {
    ok: true,
    pendingGuildDataCount,
    pendingDiscordDataCount,
    confirmedCount,
    recruitmentMessagesToConfirm,
    confirmedRecruitmentDiscordUserIds,
    confirmedWithoutRecruitmentDiscordUserIds,
  };
}
