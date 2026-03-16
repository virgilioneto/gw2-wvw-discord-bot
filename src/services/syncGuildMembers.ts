/**
 * Serviço compartilhado: sincroniza membros de uma guilda GW2 com a collection guild_members.
 * Usado pelo job sync-guild-members e pelo comando /sync.
 * Delega inserções e regras de status ao guildMemberService.
 */
import { GuildMember, IGuildMember } from '../models/GuildMember';
import { getGuildMembers, Gw2GuildMember } from './gw2GuildMembers';
import {
  createFromApiMember,
  markAsPendingGuildData,
  confirmFromGuildData,
} from './guildMemberService';

export type RecruitmentMessageToConfirm = { channelId: string; messageId: string };

export type SyncMembersResult =
  | {
      ok: true;
      pendingGuildDataCount: number;
      pendingDiscordDataCount: number;
      confirmedCount: number;
      recruitmentMessagesToConfirm: RecruitmentMessageToConfirm[];
    }
  | { ok: false; error: string };

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
        if (confirmResult.channelId && confirmResult.messageId) {
          recruitmentMessagesToConfirm.push({
            channelId: confirmResult.channelId,
            messageId: confirmResult.messageId,
          });
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
  };
}
