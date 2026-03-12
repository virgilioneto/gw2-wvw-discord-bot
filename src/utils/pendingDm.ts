/**
 * Map: discord user id -> discord server id (where they joined and we sent the DM).
 * Used to associate a DM reply (game ID) with the correct guild.
 */
export type PendingGameIdByUser = {
  discordServerId: string;
  roles: string[];
}
export const pendingGameIdByUser = new Map<string, PendingGameIdByUser>();
