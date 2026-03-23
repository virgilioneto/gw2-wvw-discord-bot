/**
 * Job: Sincroniza os membros de todas as guilds com a API do Guild Wars 2.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { Guild } from '../models/Guild';
import { syncMembersForGuild, applyPostSyncActions } from '../services/syncGuildMembers';
import { connectDatabase, disconnectDatabase } from '../database/connection';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('Defina DISCORD_TOKEN no .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

async function main(): Promise<void> {
  await connectDatabase();

  await client.login(DISCORD_TOKEN);
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));

  const guilds = await Guild.findAll();
  let pendingGuildDataCount = 0;
  let totalAbsentUpdated = 0;
  let totalAbsentDeleted = 0;

  for (const guild of guilds) {
    const result = await syncMembersForGuild(guild.guild_id, guild.api_key);
    if (!result.ok) {
      console.error(`[${guild.name}] Erro na API: ${result.error}`);
      continue;
    }
    if (result.pendingGuildDataCount > 0) {
      console.log(`[${guild.name}] ${result.pendingGuildDataCount} membro(s) com dados da Guilda pendentes.`);
    }
    pendingGuildDataCount += result.pendingGuildDataCount;

    const discordGuild = await client.guilds.fetch(guild.discord_server_id).catch(() => null);
    if (discordGuild) {
      const postStats = await applyPostSyncActions(discordGuild, guild, result);
      totalAbsentUpdated += postStats.confirmedAbsentUpdated;
      totalAbsentDeleted += postStats.confirmedAbsentDeleted;
      if (result.confirmedAbsentFromApi.length > 0) {
        console.log(
          `[${guild.name}] Confirmados ausentes na API GW2: ${postStats.confirmedAbsentUpdated} atualizado(s), ` +
            `${postStats.confirmedAbsentDeleted} removido(s) do banco (sem Discord).`
        );
      }
    }
  }

  console.log(`Guildas processadas: ${guilds.length}`);
  console.log(`Total de membros com dados da Guilda pendentes: ${pendingGuildDataCount}`);
  console.log(
    `Confirmados ausentes na API GW2 (todas as guildas): ${totalAbsentUpdated} atualizado(s), ${totalAbsentDeleted} removido(s) do banco.`
  );

  await client.destroy();
  await disconnectDatabase();
}

main()
.then(() => {
  console.log('Sincronização de membros concluída.');
  process.exit(0);
})
.catch((err) => {
  console.error(err);
  process.exit(1);
});
