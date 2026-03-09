/**
 * Serviço compartilhado: sincroniza membros de uma guilda GW2 com a collection guild_members.
 * Usado pelo job sync-guild-members e pelo comando /sync.
 */
import { GuildMember, IGuildMember } from '../models/GuildMember';
import { getGuildMembers, Gw2GuildMember } from './gw2GuildMembers';

export type SyncMembersResult =
  | { ok: true; pendingGuildDataCount: number; pendingDiscordDataCount: number; confirmedCount: number }
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

  const dbMembers = await GuildMember.find({ guild_id: guildId }).lean<IGuildMember[]>();
  const dbMembersMap = new Map<string, IGuildMember>(dbMembers.map((m) => [m.account_id, m]));

  const apiMembers = result.members;
  const apiMembersMap = new Map<string, Gw2GuildMember>(apiMembers.map((m) => [m.name, m]));

  for (const [accountId, apiMember] of apiMembersMap.entries()) {
    const joined = apiMember.joined ? new Date(apiMember.joined) : new Date();
    if (dbMembersMap.has(accountId)) {
      const dbMember = dbMembersMap.get(accountId);

      if (dbMember?.status === 'PENDING_GUILD_DATA') {
        await GuildMember.findOneAndUpdate(
          { guild_id: guildId, account_id: accountId },
          {
            $set: {
              status: 'CONFIRMED',
              joined_at: joined,
            },
          }
        ).exec();
        confirmedCount++;
      }

      dbMembersMap.delete(accountId);
    } else {
      await GuildMember.create({
        account_id: apiMember.name,
        guild_id: guildId,
        wvw_member: apiMember.wvw_member,
        joined_at: joined,
        status: 'PENDING_DISCORD_DATA',
      });
      pendingDiscordDataCount++;
    }
  }

  for (const [accountId] of dbMembersMap.entries()) {
    await GuildMember.findOneAndUpdate(
      { guild_id: guildId, account_id: accountId },
      {
        $set: {
          status: 'PENDING_GUILD_DATA',
          joined_at: null,
        },
      }
    ).exec();
    pendingGuildDataCount++;
  }

  return { ok: true, pendingGuildDataCount, pendingDiscordDataCount, confirmedCount };
}
