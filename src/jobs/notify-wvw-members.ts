/**
 * Job: Notifica membros que têm discord_user preenchido mas wvw_member = false.
 * Se a guilda tiver notify_channel: envia uma mensagem no canal marcando todos os usuários.
 * Caso contrário: envia DM para cada usuário.
 *
 * Uso: npm run job:notify-wvw
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Client, GatewayIntentBits } from 'discord.js';
import { Guild } from '../models/Guild';
import { GuildMember } from '../models/GuildMember';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gw2-wvw-bot';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('Defina DISCORD_TOKEN no .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.Guilds],
});

async function run(): Promise<void> {
  console.log('Conectando ao MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Conectado.\n');

  console.log('Conectando ao Discord...');
  await client.login(DISCORD_TOKEN);
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));
  console.log(`Bot conectado como ${client.user?.tag}\n`);

  const guilds = await Guild.find({}).exec();
  console.log(`Encontrada(s) ${guilds.length} guilda(s).\n`);

  let totalSent = 0;
  let totalSkipped = 0;
  let totalChannelMessages = 0;
  const errors: { guildName: string; userId: string; error: string }[] = [];

  for (const guild of guilds) {
    const members = await GuildMember.find({
      guild_id: guild.guild_id,
      discord_user: { $ne: '' },
      wvw_member: false,
    }).exec();

    if (members.length === 0) {
      console.log(`[${guild.name}] Nenhum membro com wvw_member=false e Discord vinculado.`);
      continue;
    }

    if (guild.notify_channel) {
      try {
        const discordGuild = await client.guilds.fetch(guild.discord_server_id).catch(() => null);
        if (!discordGuild) {
          console.log(`[${guild.name}] Servidor Discord não encontrado.`);
          continue;
        }
        const channel = discordGuild.channels.cache.get(guild.notify_channel) ?? await discordGuild.channels.fetch(guild.notify_channel).catch(() => null);
        if (channel && 'send' in channel) {
          const mentions = members.map((m) => `<@${m.discord_user}>`).join(' ');
          const text = `**Esgoto do WvW** — A guilda **${guild.name}** não foi definida como guilda de WvW por vocês no jogo. Para contar nas escalações, definam-a como sua guilda de WvW em Guild Wars 2.`;
          const fullContent = `${mentions}\n\n${text}`;
          const MAX_LENGTH = 2000;
          if (fullContent.length <= MAX_LENGTH) {
            await channel.send({ content: fullContent });
          } else {
            await channel.send({ content: mentions });
            await channel.send({ content: text });
          }
          totalChannelMessages++;
          console.log(`[${guild.name}] Mensagem enviada no canal de notificações (${members.length} menção(ões)).`);
        } else {
          console.log(`[${guild.name}] Canal de notificações não encontrado (${guild.notify_channel}).`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[${guild.name}] Erro ao enviar no canal: ${msg}`);
      }
    }

    console.log(`[${guild.name}] ${members.length} membro(s) sem WvW atribuído. Enviando DMs...`);

    for (const member of members) {
      try {
        const user = await client.users.fetch(member.discord_user);
        const dm = await user.createDM();
        await dm.send(
          `**Esgoto do WvW** — Você não atribuiu a guilda **${guild.name}** como guilda de WvW no jogo. Para contar nas escalações, defina-a como sua guilda de WvW em Guild Wars 2.`
        );
        totalSent++;
        process.stdout.write('.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        totalSkipped++;
        errors.push({ guildName: guild.name, userId: member.discord_user, error: msg });
        process.stdout.write('x');
      }
    }
    if (members.length > 0) console.log('');
  }

  console.log('\n--- Resumo ---');
  console.log(`Guildas processadas: ${guilds.length}`);
  console.log(`Mensagens em canais (notify_channel): ${totalChannelMessages}`);
  console.log(`DMs enviadas: ${totalSent}`);
  console.log(`Falhas/sem DM aberta: ${totalSkipped}`);
  if (errors.length > 0) {
    console.log('Erros:');
    errors.forEach((e) => console.log(`  - ${e.guildName} / ${e.userId}: ${e.error}`));
  }

  client.destroy();
  await mongoose.disconnect();
  console.log('\nConexões encerradas.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
