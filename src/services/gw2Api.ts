import axios from 'axios';
import { gw2Client } from './gw2Client';

const GW2_GUILD_SEARCH = 'https://api.guildwars2.com/v2/guild/search';

export async function searchGuildByName(name: string): Promise<string | null> {
  const url = `${GW2_GUILD_SEARCH}?name=${encodeURIComponent(name)}`;
  try {
    const res = await gw2Client.get<string[]>(url, { validateStatus: () => true });
    if (res.status !== 200) return null;
    const data = res.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0];
  } catch (e) {
    if (axios.isAxiosError(e)) return null;
    throw e;
  }
}
