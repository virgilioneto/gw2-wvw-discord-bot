/**
 * Job: Notifica membros que têm discord_user preenchido mas wvw_member = false.
 * Se a guilda tiver notify_channel: envia uma mensagem no canal marcando todos os usuários.
 * Caso contrário: envia DM para cada usuário.
 *
 * Executa apenas no sábado e na segunda-feira que antecedem a primeira sexta-feira do mês.
 * Em qualquer outra data, o job termina sem fazer nada.
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

/** Dia do mês (1-31) da primeira sexta-feira do mês. */
function getFirstFridayDayOfMonth(year: number, month: number): Date {
// Create a Date object for the first day of the specified month
    // JavaScript months are 0-indexed (0=Jan, 11=Dec), so 'month' argument is used as is.
    var firstDayOfMonth = new Date(year, month, 1);
    
    // Get the day of the week for the first day of the month (0=Sun, 1=Mon, ..., 6=Sat)
    var dayOfWeek = firstDayOfMonth.getDay();
    
    // Friday is represented by the number 5
    var FRIDAY = 5;
    
    // Calculate how many days to advance from the first of the month to the first Friday
    var daysUntilFirstFriday;
    if (dayOfWeek <= FRIDAY) {
        daysUntilFirstFriday = FRIDAY - dayOfWeek;
    } else {
        // If the first day is after Friday (Sat/Sun), advance to the next week's Friday
        daysUntilFirstFriday = FRIDAY + (7 - dayOfWeek);
    }
    
    // Set the date of the first day to the calculated first Friday
    firstDayOfMonth.setDate(firstDayOfMonth.getDate() + daysUntilFirstFriday);
    
    return firstDayOfMonth;
}

/** Verifica se hoje é sábado ou segunda que antecedem a primeira sexta do mês. */
function shouldRunToday(): boolean {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const dayOfWeek = now.getDay(); // 0=Dom, 6=Sab, 1=Seg

  const firstFriday = getFirstFridayDayOfMonth(year, month);
  const saturdayBefore = firstFriday.getDate() - 6;
  const mondayBefore = firstFriday.getDate() - 4;

  const isSaturdayRun = dayOfWeek === 6 && day === saturdayBefore && saturdayBefore >= 1;
  const isMondayRun = dayOfWeek === 1 && day === mondayBefore && mondayBefore >= 1;

  return isSaturdayRun || isMondayRun;
}

async function run(): Promise<void> {
  if (!shouldRunToday()) {
    const now = new Date();
    console.log(
      `[${now.toISOString().slice(0, 10)}] Job não agendado para hoje. Executa apenas no sábado e na segunda antes da primeira sexta do mês.`
    );
    process.exit(0);
  }

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
      $or: [{ base_discord_role: true }, { wvw_discord_role: true }],
    }).exec();

    if (members.length === 0) {
      console.log(`[${guild.name}] Nenhum membro com wvw_member=false, Discord vinculado e role base ou WvW.`);
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

    if (guild.dm_notify_player) {
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
    } else {
      console.log(`[${guild.name}] ${members.length} membro(s) sem WvW atribuído. DM desativada para esta guilda.`);
    }
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
