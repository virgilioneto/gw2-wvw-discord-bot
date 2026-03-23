import axios from 'axios';
import { gw2Client } from './gw2Client';

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
  try {
    const res = await gw2Client.get<Gw2GuildMember[] | { text?: string }>(url, {
      validateStatus: () => true,
    });
    const data = res.data;

    if (data && typeof data === 'object' && !Array.isArray(data) && data.text === 'access restricted to guild leaders') {
      return { ok: false, error: data.text };
    }

    if (!Array.isArray(data)) {
      return { ok: false, error: 'Resposta inválida da API.' };
    }

    return { ok: true, members: data as Gw2GuildMember[] };
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const msg =
        e.code === 'ECONNABORTED'
          ? 'Tempo esgotado ao contactar a API do Guild Wars 2.'
          : e.message || 'Erro ao contactar a API.';
      return { ok: false, error: msg };
    }
    throw e;
  }
}
