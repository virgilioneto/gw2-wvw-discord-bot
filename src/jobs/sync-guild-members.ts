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
import { GuildMember } from '../models/GuildMember';
import { getGuildMembers } from '../services/gw2GuildMembers';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gw2-wvw-bot';

async function syncMembersForGuild(guildId: string, apiKey: string, guildName: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const result = await getGuildMembers(guildId, apiKey);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  for (const m of result.members) {
    const joinedAt = m.joined ? new Date(m.joined) : new Date();
    await GuildMember.findOneAndUpdate(
      { guild_id: guildId, account_id: m.name },
      {
        $set: {
          account_id: m.name,
          guild_id: guildId,
          wvw_member: m.wvw_member,
          joined_at: joinedAt,
        },
        $setOnInsert: {
          discord_user: '',
        },
      },
      { upsert: true }
    ).exec();
  }

  return { ok: true, count: result.members.length };
}

async function run(): Promise<void> {
  console.log('Conectando ao MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Conectado.\n');

  const guilds = await Guild.find({}).exec();
  console.log(`Encontrada(s) ${guilds.length} guilda(s) para sincronizar.\n`);

  let totalMembers = 0;
  const errors: { name: string; error: string }[] = [];

  for (const guild of guilds) {
    process.stdout.write(`[${guild.name}] Consultando API... `);
    const result = await syncMembersForGuild(guild.guild_id, guild.api_key, guild.name);
    if (result.ok) {
      totalMembers += result.count;
      console.log(`${result.count} membro(s) sincronizado(s).`);
    } else {
      console.log(`ERRO: ${result.error}`);
      errors.push({ name: guild.name, error: result.error });
    }
  }

  console.log('\n--- Resumo ---');
  console.log(`Guildas processadas: ${guilds.length}`);
  console.log(`Total de membros upsertados: ${totalMembers}`);
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
