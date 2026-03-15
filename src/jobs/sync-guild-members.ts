/**
 * Job: Sincroniza os membros de todas as guilds com a API do Guild Wars 2.
 * Conecta no MongoDB, lista as guilds, consulta a API de membros de cada uma
 * e faz upsert na collection guild_members (mesmo processo do /setup e /sync).
 * Quando um membro passa a CONFIRMED, reage com :white_check_mark: na mensagem de recrutamento.
 *
 * Uso: npm run job:sync-members
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Client, GatewayIntentBits } from 'discord.js';
import { Guild } from '../models/Guild';
import { syncMembersForGuild } from '../services/syncGuildMembers';
import { reactRecruitmentMessageConfirmed } from '../utils/recruitmentMessage';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gw2-wvw-bot';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

async function run(): Promise<void> {
  console.log('Conectando ao MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Conectado.\n');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  if (DISCORD_TOKEN) {
    await client.login(DISCORD_TOKEN);
    await new Promise<void>((resolve, reject) => {
      client.once('ready', () => resolve());
      client.once('error', reject);
    });
  } else {
    console.warn('DISCORD_TOKEN não definido: mensagens de recrutamento não serão marcadas com ✅.\n');
  }

  const guilds = await Guild.find({}).exec();
  console.log(`Encontrada(s) ${guilds.length} guilda(s) para sincronizar.\n`);

  let pendingGuildDataCount = 0;
  let pendingDiscordDataCount = 0;
  let confirmedCount = 0;
  const errors: { name: string; error: string }[] = [];

  for (const guild of guilds) {
    process.stdout.write(`[${guild.name}] Consultando API... `);
    const result = await syncMembersForGuild(guild.guild_id, guild.api_key);
    if (result.ok) {
      console.log(`${result.pendingGuildDataCount} membro(s) com dados da Guilda pendentes.`);
      console.log(`${result.pendingDiscordDataCount} membro(s) com dados do Discord pendentes.`);
      console.log(`${result.confirmedCount} membro(s) confirmados.`);
      pendingGuildDataCount += result.pendingGuildDataCount;
      pendingDiscordDataCount += result.pendingDiscordDataCount;
      confirmedCount += result.confirmedCount;

      if (client.isReady() && result.recruitmentMessagesToConfirm?.length) {
        const discordGuild = await client.guilds.fetch(guild.discord_server_id).catch(() => null);
        if (discordGuild) {
          for (const { channelId, messageId } of result.recruitmentMessagesToConfirm) {
            await reactRecruitmentMessageConfirmed(discordGuild, channelId, messageId);
          }
        }
      }
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

  client.destroy().catch(() => {});
  await mongoose.disconnect();
  console.log('\nConexão encerrada.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
