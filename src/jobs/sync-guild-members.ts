/**
 * Job: Sincroniza os membros de todas as guilds com a API do Guild Wars 2.
 * Conecta no MongoDB, lista as guilds, consulta a API de membros de cada uma
 * e faz upsert na collection guild_members (mesmo processo do /setup).
 *
 * Uso: npm run job:sync-members
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Guild } from '../models/Guild';
import { GuildMember, IGuildMember } from '../models/GuildMember';
import { getGuildMembers, Gw2GuildMember } from '../services/gw2GuildMembers';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gw2-wvw-bot';

async function syncMembersForGuild(guildId: string, apiKey: string, guildName: string): Promise<{ ok: true; pendingGuildDataCount: number; pendingDiscordDataCount: number; confirmedCount: number } | { ok: false; error: string }> {
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
    const joined =  apiMember.joined ? new Date(apiMember.joined) : new Date()
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
          },
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
      })
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
      },
    ).exec();
    pendingGuildDataCount++;
  }

  return { ok: true, pendingGuildDataCount, pendingDiscordDataCount, confirmedCount };
}

async function run(): Promise<void> {
  console.log('Conectando ao MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Conectado.\n');

  const guilds = await Guild.find({}).exec();
  console.log(`Encontrada(s) ${guilds.length} guilda(s) para sincronizar.\n`);

  let pendingGuildDataCount = 0;
  let pendingDiscordDataCount = 0;
  let confirmedCount = 0;
  const errors: { name: string; error: string }[] = [];

  for (const guild of guilds) {
    process.stdout.write(`[${guild.name}] Consultando API... `);
    const result = await syncMembersForGuild(guild.guild_id, guild.api_key, guild.name);
    if (result.ok) {
      console.log(`${result.pendingGuildDataCount} membro(s) com dados da Guilda pendentes.`);
      console.log(`${result.pendingDiscordDataCount} membro(s) com dados do Discord pendentes.`);
      console.log(`${result.confirmedCount} membro(s) confirmados.`);
      pendingGuildDataCount += result.pendingGuildDataCount;
      pendingDiscordDataCount += result.pendingDiscordDataCount;
      confirmedCount += result.confirmedCount;
    } else {
      console.log(`ERRO: ${result.error}`);
      errors.push({ name: guild.name, error: result.error });
    }
  }

  console.log('\n--- Resumo ---');
  console.log(`Guildas processadas: ${guilds.length}`);
  console.log(`Total de membros com dados da Guilda pendentes: ${pendingGuildDataCount}`);
  console.log(`Total de membros com dados do Discord pendentes: ${pendingDiscordDataCount}`);
  console.log(`Total de membros confirmados: ${confirmedCount}`);
  if (errors.length > 0) {
    console.log(`Erros: ${errors.length}`);
    errors.forEach((e) => console.log(`  - ${e.name}: ${e.error}`));
  }

  await mongoose.disconnect();
  console.log('\nConexão encerrada.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
