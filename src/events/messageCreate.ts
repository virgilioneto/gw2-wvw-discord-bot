import {
  Message,
  User,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageComponentInteraction,
} from 'discord.js';
import { Guild, type IGuild } from '../models/Guild';
import { pendingGameIdByUser } from '../utils/pendingDm';
import { getStatusLabel } from '../constants/statusLabels';
import { reactRecruitmentMessageConfirmed } from '../utils/recruitmentMessage';
import { GAME_ID_REGEX } from '../constants/gameId';
import {
  linkDiscordToGameId,
  findByGuildAndAccount,
  findByGuildAndDiscordUser,
  removeMember,
} from '../services/guildMemberService';

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
    { content: `ID de jogo registrado com sucesso. Status: **${getStatusLabel(status)}**.` }
  );
  if (!dm) await message.reply(DM_FAILED_CHANNEL_MESSAGE).catch(() => {});
  else await message.react('☑').catch(() => {});
}
