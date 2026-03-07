const GW2_GUILD_SEARCH = 'https://api.guildwars2.com/v2/guild/search';

export async function searchGuildByName(name: string): Promise<string | null> {
  const url = `${GW2_GUILD_SEARCH}?name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}
