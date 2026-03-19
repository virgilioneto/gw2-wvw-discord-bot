import {
  Message,
  User,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageComponentInteraction,
} from 'discord.js';
import { Guild, type IGuild, type IRecruitmentMessagePayload } from '../models/Guild';
import { pendingGameIdByUser } from '../utils/pendingDm';
import { getStatusLabel } from '../constants/statusLabels';
import { reactRecruitmentMessageConfirmed } from '../utils/recruitmentMessage';
import { userSharesRoleWithBot } from '../utils/roleCheck';
import { GAME_ID_REGEX } from '../constants/gameId';
import {
  linkDiscordToGameId,
  findByGuildAndAccount,
  findByGuildAndDiscordUser,
  removeMember,
} from '../services/guildMemberService';

/** Serializa uma mensagem para o formato armazenado em recruitment_message (para reenvio futuro). */
function messageToRecruitmentPayload(message: Message): IRecruitmentMessagePayload {
  const embeds =
    message.embeds.length > 0
      ? message.embeds.map((e) => (typeof (e as { toJSON?: () => unknown }).toJSON === 'function' ? (e as { toJSON: () => unknown }).toJSON() : e) as Record<string, unknown>)
      : undefined;
  const components =
    message.components.length > 0
      ? message.components.map((c) => (typeof (c as { toJSON?: () => unknown }).toJSON === 'function' ? (c as { toJSON: () => unknown }).toJSON() : c) as Record<string, unknown>)
      : undefined;
  const attachment_urls =
    message.attachments.size > 0
      ? message.attachments.map((a) => ({ url: a.url, name: a.name ?? undefined }))
      : undefined;
  return {
    ...(message.content?.trim() ? { content: message.content } : {}),
    ...(embeds?.length ? { embeds } : {}),
    ...(components?.length ? { components } : {}),
    ...(attachment_urls?.length ? { attachment_urls } : {}),
  };
}

/** Custom IDs dos botões de escolha do tipo de mensagem (Recrutamento / Notificação). */
export const MSG_TYPE_RECRUITMENT = 'message_type_recruitment';
export const MSG_TYPE_NOTIFICATION = 'message_type_notification';

/** Pendência: escolha Recrutamento vs Notificação keyed by the bot reply message id. */
const pendingMessageTypeByMessageId = new Map<
  string,
  { discordServerId: string; payload: IRecruitmentMessagePayload; userId: string }
>();

/** Pending "replace game ID?" data keyed by the reply message id. */
const pendingReplaceByMessageId = new Map<
  string,
  {
    guildDoc: IGuild;
    newGameId: string;
    memberRoles: string[];
    authorId: string;
    oldAccountId: string;
    recruitmentMessageId: string;
    recruitmentChannelId: string;
  }
>();

const REPLACE_BUTTON_YES = 'replace_game_id_yes';
const REPLACE_BUTTON_NO = 'replace_game_id_no';
const REPLACE_COLLECTOR_TIMEOUT_MS = 60_000;

const DM_FAILED_CHANNEL_MESSAGE =
  'Não foi possível enviar mensagem no privado. Ative as DMs para receber o resultado.';

async function sendRecruitmentDm(
  user: User,
  payload: { content: string; components?: ActionRowBuilder<ButtonBuilder>[] }
): Promise<Message | null> {
  try {
    const dm = await user.createDM();
    return await dm.send(payload);
  } catch {
    return null;
  }
}

export { GAME_ID_REGEX } from '../constants/gameId';

export async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId && message.channel.isDMBased()) {
    const { discordServerId, roles } = pendingGameIdByUser.get(message.author.id) || {};
    if (!discordServerId) return;

    const gameId = message.content.trim();
    if (!GAME_ID_REGEX.test(gameId)) {
      await message.reply("O ID informado não parece válido. Use o formato: **Nome.1234** (ex.: SeuNome.1234).");
      return;
    }

    const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
    if (!guildDoc) {
      pendingGameIdByUser.delete(message.author.id);
      return;
    }
    const guildRoleIds = Array.isArray(guildDoc.notification_roles) ? guildDoc.notification_roles : [];
    const memberRoles = guildRoleIds.filter((roleId) => roles?.includes(roleId) ?? false);
    const { status } = await linkDiscordToGameId({
      guildId: guildDoc.guild_id,
      accountId: gameId,
      discordUserId: message.author.id,
      roles: memberRoles,
    });

    pendingGameIdByUser.delete(message.author.id);
    await message.reply(`Seu ID de jogo foi registrado com sucesso. Status: **${getStatusLabel(status)}**.`);
  }
}

/**
 * Handles messages in the guild's recruitment_channel: if the message content
 * matches GAME_ID_REGEX, registers the author using the same logic as the join command.
 */
export async function handleRecruitmentChannelMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const guildDoc = await Guild.findOne({ discord_server_id: message.guildId }).exec();
  if (!guildDoc?.recruitment_channel || guildDoc.recruitment_channel !== message.channelId) return;

  const match = message.content.trim().match(GAME_ID_REGEX);
  if (!match) return;
  const gameId = match[0];

  const member = message.member ?? (await message.guild?.members.fetch(message.author.id).catch(() => null));
  const guildRoleIds = Array.isArray(guildDoc.notification_roles) ? guildDoc.notification_roles : [];
  const memberRoles = member ? guildRoleIds.filter((roleId) => member.roles.cache.has(roleId)) : [];

  const existingDiscordUser = await findByGuildAndDiscordUser(guildDoc.guild_id, message.author.id);
  if (existingDiscordUser && existingDiscordUser.account_id !== gameId) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(REPLACE_BUTTON_YES)
        .setLabel('Sim')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(REPLACE_BUTTON_NO)
        .setLabel('Não')
        .setStyle(ButtonStyle.Secondary)
    );
    const dmMessage = await sendRecruitmentDm(message.author, {
      content: `Você já está vinculado a outro ID de jogo (**${existingDiscordUser.account_id}**). Deseja substituir pelo novo ID **${gameId}**?`,
      components: [row],
    });
    if (!dmMessage) {
      await message.reply(DM_FAILED_CHANNEL_MESSAGE).catch(() => {});
      return;
    }

    await message.react('☑').catch(() => {});

    pendingReplaceByMessageId.set(dmMessage.id, {
      guildDoc,
      newGameId: gameId,
      memberRoles,
      authorId: message.author.id,
      oldAccountId: existingDiscordUser.account_id,
      recruitmentMessageId: message.id,
      recruitmentChannelId: message.channelId,
    });

    const collector = dmMessage.createMessageComponentCollector({
      filter: (i: MessageComponentInteraction) => i.user.id === message.author.id,
      time: REPLACE_COLLECTOR_TIMEOUT_MS,
      maxComponents: 1,
    });

    collector.on('collect', async (interaction) => {
      const pending = pendingReplaceByMessageId.get(dmMessage.id);
      pendingReplaceByMessageId.delete(dmMessage.id);
      if (!pending || pending.authorId !== interaction.user.id) {
        await interaction.reply({ content: 'Esta confirmação expirou ou não é sua.' }).catch(() => {});
        return;
      }

      await dmMessage.edit({ components: [] }).catch(() => {});

      if (interaction.customId === REPLACE_BUTTON_NO) {
        await interaction.reply({ content: 'Nenhuma alteração feita. Seu vínculo atual foi mantido.' }).catch(() => {});
        return;
      }

      await interaction.deferReply();

      try {
        await removeMember(pending.guildDoc.guild_id, pending.oldAccountId);

        const { status } = await linkDiscordToGameId({
          guildId: pending.guildDoc.guild_id,
          accountId: pending.newGameId,
          discordUserId: pending.authorId,
          roles: pending.memberRoles,
          recruitment_message_id: pending.recruitmentMessageId,
          recruitment_channel_id: pending.recruitmentChannelId,
        });

        if (status === 'CONFIRMED') {
          await reactRecruitmentMessageConfirmed(interaction.guild, pending.recruitmentChannelId, pending.recruitmentMessageId);
        }

        await interaction.editReply(`ID de jogo substituído com sucesso. Novo vínculo: **${pending.newGameId}**. Status: **${getStatusLabel(status)}**.`);
      } catch (err) {
        console.error(err);
        await interaction.editReply({ content: 'Ocorreu um erro ao atualizar. Tente novamente.' }).catch(() => {});
      }
    });

    collector.on('end', () => {
      pendingReplaceByMessageId.delete(dmMessage.id);
    });

    return;
  }

  const existingMember = await findByGuildAndAccount(guildDoc.guild_id, gameId);
  if (existingMember?.discord_user && existingMember.discord_user !== message.author.id) {
    const dm = await sendRecruitmentDm(message.author, { content: 'ID do jogo já está vinculado a outro usuário.' });
    if (!dm) await message.reply(DM_FAILED_CHANNEL_MESSAGE).catch(() => {});
    else await message.react('☑').catch(() => {});
    return;
  }
  if (existingMember?.status === 'CONFIRMED') {
    const dm = await sendRecruitmentDm(message.author, { content: 'ID do jogo já está confirmado.' });
    if (!dm) await message.reply(DM_FAILED_CHANNEL_MESSAGE).catch(() => {});
    else await message.react('☑').catch(() => {});
    return;
  }

  const { status } = await linkDiscordToGameId({
    guildId: guildDoc.guild_id,
    accountId: gameId,
    discordUserId: message.author.id,
    roles: memberRoles,
    recruitment_message_id: message.id,
    recruitment_channel_id: message.channelId,
  });

  if (status === 'CONFIRMED') {
    await reactRecruitmentMessageConfirmed(message.guild, message.channelId, message.id);
  }

  const dm = await sendRecruitmentDm(
    message.author,
    { content: `ID de jogo registrado com sucesso. Status: **${getStatusLabel(status)}**.\nEm breve um dos oficiais da guilda irá lhe enviar um invite no jogo.` }
  );
  if (!dm) await message.reply(DM_FAILED_CHANNEL_MESSAGE).catch(() => {});
  else await message.react('☑').catch(() => {});
}

/**
 * Se o usuário responder a uma mensagem mencionando o bot e tiver alguma role em comum com o bot,
 * pergunta que tipo de mensagem é (Recrutamento ou Notificação) com botões; ao clicar, salva na propriedade correspondente (override sem confirmação).
 */
export async function handleBotMentionRecruitmentMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.guildId || !message.guild) return;
  const clientUser = message.client.user;
  if (!clientUser || !message.mentions.users.has(clientUser.id)) return;

  const repliedToId = message.reference?.messageId;
  if (!repliedToId) return;

  const guildDoc = await Guild.findOne({ discord_server_id: message.guildId }).exec();
  if (!guildDoc) return;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!userSharesRoleWithBot(message.guild, member)) return;

  const repliedToMessage = await message.channel.messages.fetch(repliedToId).catch(() => null);
  if (!repliedToMessage) return;

  const payload = messageToRecruitmentPayload(repliedToMessage);
  const hasContent =
    (payload.content?.trim?.()?.length ?? 0) > 0 ||
    (payload.embeds?.length ?? 0) > 0 ||
    (payload.components?.length ?? 0) > 0 ||
    (payload.attachment_urls?.length ?? 0) > 0;
  if (!hasContent) return;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MSG_TYPE_RECRUITMENT).setLabel('Recrutamento').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(MSG_TYPE_NOTIFICATION).setLabel('Notificação').setStyle(ButtonStyle.Secondary)
  );
  const reply = await message.reply({
    content: 'Que tipo de mensagem é essa? (a mensagem respondida será salva; pode sobrescrever a qualquer momento.)',
    components: [row],
  }).catch(() => null);
  if (!reply) return;

  pendingMessageTypeByMessageId.set(reply.id, {
    discordServerId: message.guildId,
    payload,
    userId: message.author.id,
  });
}

/**
 * Trata o clique no botão Recrutamento ou Notificação: salva o payload em recruitment_message ou notification_message (override sem confirmação).
 * Retorna true se a interação foi tratada.
 */
export async function handleMessageTypeChoiceButton(
  interaction: MessageComponentInteraction
): Promise<boolean> {
  const customId = interaction.customId;
  if (customId !== MSG_TYPE_RECRUITMENT && customId !== MSG_TYPE_NOTIFICATION) return false;

  const messageId = interaction.message.id;
  const pending = pendingMessageTypeByMessageId.get(messageId);
  pendingMessageTypeByMessageId.delete(messageId);

  if (!pending || pending.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'Esta escolha expirou ou não é sua. Responda de novo à mensagem mencionando o bot.',
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !userSharesRoleWithBot(guild, member as Parameters<typeof userSharesRoleWithBot>[1])) {
    await interaction.reply({
      content: 'Apenas usuários com alguma role em comum com o bot podem usar esta ação.',
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  const field = customId === MSG_TYPE_RECRUITMENT ? 'recruitment_message' : 'notification_message';
  const label = customId === MSG_TYPE_RECRUITMENT ? 'recruitment_message' : 'notification_message';

  await Guild.findOneAndUpdate(
    { discord_server_id: pending.discordServerId },
    { $set: { [field]: pending.payload } }
  ).exec();

  await interaction.update({
    content: `Salvo em **${label}**. (pode sobrescrever respondendo outra mensagem e escolhendo de novo.)`,
    components: [],
  }).catch(() => {});

  return true;
}
