/**
 * Job: Notifica membros que têm discord_user preenchido mas wvw_member = false.
 * Se a guilda tiver notify_channel: envia uma mensagem no canal marcando todos os usuários.
 * Usa guild.notification_message (content/embeds) quando configurada; senão texto padrão sobre Battle Guild.
 * Caso contrário (sem canal): envia DM para cada usuário com a mesma lógica de texto/embeds.
 *
 * Executa apenas no sábado e na segunda-feira que antecedem a primeira sexta-feira do mês.
 * Em qualquer outra data, o job termina sem fazer nada.
 *
 * Uso: npm run job:notify-wvw
 */
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { Guild, type IGuild } from '../models/Guild';
import { findPendingWvwMembers } from '../services/guildMemberService';
import {
  buildEmbedsFromStoredPayload,
  fetchPreparedAttachmentsFromUrls,
  toAttachmentBuilders,
} from '../utils/storedMessagePayload';
import { connectDatabase, disconnectDatabase } from '../database/connection';

const DEFAULT_NOTIFY_TEXT =
  'Vocês ainda não estão com a guilda configurada como Battle Guild.';

const MAX_MESSAGE_LENGTH = 2000;

/** Corpo de texto: conteúdo salvo ou mensagem padrão. */
function getNotificationBodyText(guildDoc: IGuild): string {
  const trimmed = guildDoc.notification_message?.content?.trim();
  return trimmed || DEFAULT_NOTIFY_TEXT;
}

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
  const firstDayOfMonth = new Date(year, month, 1);
  const dayOfWeek = firstDayOfMonth.getDay();
  const FRIDAY = 5;
  let daysUntilFirstFriday;
  if (dayOfWeek <= FRIDAY) {
    daysUntilFirstFriday = FRIDAY - dayOfWeek;
  } else {
    daysUntilFirstFriday = FRIDAY + (7 - dayOfWeek);
  }
  firstDayOfMonth.setDate(firstDayOfMonth.getDate() + daysUntilFirstFriday);
  return firstDayOfMonth;
}

/** Verifica se hoje é sábado ou segunda que antecedem a primeira sexta do mês. */
function shouldRunToday(): boolean {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const dayOfWeek = now.getDay();

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

  console.log('Conectando ao PostgreSQL...');
  await connectDatabase();
  console.log('Conectado.\n');

  console.log('Conectando ao Discord...');
  await client.login(DISCORD_TOKEN);
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));
  console.log(`Bot conectado como ${client.user?.tag}\n`);

  const guilds = await Guild.findAll();
  console.log(`Encontrada(s) ${guilds.length} guilda(s).\n`);

  let totalSent = 0;
  let totalSkipped = 0;
  let totalChannelMessages = 0;
  const errors: { guildName: string; userId: string; error: string }[] = [];

  for (const guild of guilds) {
    const guildRoleIds = Array.isArray(guild.notification_roles) ? guild.notification_roles : [];
    const members = await findPendingWvwMembers(guild.guild_id, guildRoleIds);

    if (members.length === 0) {
      console.log(`[${guild.name}] Nenhum membro com wvw_member=false, Discord vinculado e com alguma das roles da guilda.`);
      continue;
    }

    const nm = guild.notification_message;
    const notifyEmbeds = buildEmbedsFromStoredPayload(nm);
    const notifyPrepared = await fetchPreparedAttachmentsFromUrls(nm?.attachment_urls);

    if (guild.notify_channel) {
      try {
        const discordGuild = await client.guilds.fetch(guild.discord_server_id).catch(() => null);
        if (!discordGuild) {
          console.log(`[${guild.name}] Servidor Discord não encontrado.`);
          continue;
        }
        const channel = discordGuild.channels.cache.get(guild.notify_channel) ?? (await discordGuild.channels.fetch(guild.notify_channel).catch(() => null));
        if (channel && 'send' in channel) {
          const mentions = members.map((m) => `<@${m.discord_user}>`).join(' ');
          const bodyText = getNotificationBodyText(guild);
          const userIds = members.map((m) => m.discord_user).filter((id): id is string => Boolean(id));
          const notifyFiles = notifyPrepared.length ? toAttachmentBuilders(notifyPrepared) : undefined;
          const fullContent = `${mentions}\n\n${bodyText}`;

          if (fullContent.length <= MAX_MESSAGE_LENGTH && !notifyEmbeds?.length && !notifyFiles?.length) {
            await channel.send({
              content: fullContent,
              allowedMentions: { users: userIds },
            });
          } else if (fullContent.length <= MAX_MESSAGE_LENGTH) {
            await channel.send({
              content: fullContent,
              embeds: notifyEmbeds,
              files: notifyFiles,
              allowedMentions: { users: userIds },
            });
          } else {
            await channel.send({
              content: mentions,
              allowedMentions: { users: userIds },
            });
            if (bodyText.length <= MAX_MESSAGE_LENGTH) {
              await channel.send({ content: bodyText, embeds: notifyEmbeds, files: notifyFiles });
            } else {
              await channel.send({ content: bodyText.slice(0, MAX_MESSAGE_LENGTH - 1) + '…' });
              if (notifyEmbeds?.length || notifyFiles?.length) {
                await channel.send({ embeds: notifyEmbeds, files: notifyFiles });
              }
            }
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
      if (!member.discord_user) continue;
      try {
        const user = await client.users.fetch(member.discord_user);
        const dm = await user.createDM();
        const dmText = getNotificationBodyText(guild);
        const dmEmbeds = notifyEmbeds;
        const dmFiles = notifyPrepared.length ? toAttachmentBuilders(notifyPrepared) : undefined;
        await dm.send({
          content: dmText,
          embeds: dmEmbeds,
          files: dmFiles,
        });
        totalSent++;
        process.stdout.write('.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        totalSkipped++;
        errors.push({ guildName: guild.name, userId: member.discord_user ?? '', error: msg });
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
  await disconnectDatabase();
  console.log('\nConexões encerradas.');
}

run()
.then(() => {
  console.log('Notificação de membros concluída.');
  process.exit(0);
})
.catch((err) => {
  console.error(err);
  process.exit(1);
});
