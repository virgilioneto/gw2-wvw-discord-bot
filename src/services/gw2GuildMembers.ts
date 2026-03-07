const GW2_GUILD_MEMBERS = 'https://api.guildwars2.com/v2/guild';

export interface Gw2GuildMember {
  name: string;
  rank: string;
  joined: string | null;
  wvw_member: boolean;
}

export type GuildMembersResult =
  | { ok: true; members: Gw2GuildMember[] }
  | { ok: false; error: string };

export async function getGuildMembers(
  guildId: string,
  accessToken: string
): Promise<GuildMembersResult> {
  const url = `${GW2_GUILD_MEMBERS}/${guildId}/members?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const data = (await res.json()) as { text?: string } | Gw2GuildMember[];

  if (data && typeof data === 'object' && !Array.isArray(data) && data.text === 'access restricted to guild leaders') {
    return { ok: false, error: data.text };
  }

  if (!Array.isArray(data)) {
    return { ok: false, error: 'Resposta inválida da API.' };
  }

  return { ok: true, members: data as Gw2GuildMember[] };
}
