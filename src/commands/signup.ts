import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { Guild } from '../models/Guild';
import { getStatusLabel } from '../constants/statusLabels';
import {
  linkDiscordToGameId,
  findByGuildAndAccount,
  findByGuildAndDiscordUser,
} from '../services/guildMemberService';

const MODAL_ID = 'signup_modal';
const INPUT_GAME_ID = 'signup_game_id';

export const signupCommand = new SlashCommandBuilder()
  .setName('registrar')
  .setDescription('Informe ou atualize seu ID de jogo (Guild Wars 2) para este servidor.')
  .toJSON();

async function showSignupModal(interaction: ChatInputCommandInteraction, currentGameId: string) {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Vincular ID do jogo');

  const gameIdInput = new TextInputBuilder()
    .setCustomId(INPUT_GAME_ID)
    .setLabel('ID do jogo (ex.: SeuNome.1234)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('SeuNome.1234')
    .setRequired(true)
    .setMaxLength(64);

  if (currentGameId) {
    gameIdInput.setValue(currentGameId);
  }

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(gameIdInput);
  modal.addComponents(row);
  await interaction.showModal(modal);
}

export async function handleSignupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
    return;
  }

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc) {
    await interaction.reply({
      content: 'Este servidor ainda não possui uma guilda configurada. Peça a um administrador para usar `/configurar`.',
      ephemeral: true,
    });
    return;
  }

  const member = interaction.guild?.members.resolve(interaction.user.id) ?? (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null));
  const guildRoleIds = Array.isArray(guildDoc.notification_roles) ? guildDoc.notification_roles : [];
  const hasNotificationRole = guildRoleIds.some((roleId) => member?.roles.cache.has(roleId));
  if (!hasNotificationRole) {
    await interaction.reply({
      content: 'Você não possui nenhuma das roles de notificação configuradas para usar este comando.',
      ephemeral: true,
    });
    return;
  }

  const existing = await findByGuildAndDiscordUser(guildDoc.guild_id, interaction.user.id);

  await showSignupModal(interaction, existing?.account_id ?? '');
}

export async function handleSignupModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  try {
    if (interaction.customId !== MODAL_ID) return;

    const discordServerId = interaction.guildId;
    if (!discordServerId) {
      await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true });
      return;
    }

    const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
    if (!guildDoc) {
      await interaction.reply({ content: 'Guilda não encontrada para este servidor.', ephemeral: true });
      return;
    }

    const member = interaction.guild?.members.resolve(interaction.user.id) ?? (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null));
    const guildRoleIds = Array.isArray(guildDoc.notification_roles) ? guildDoc.notification_roles : [];
    const hasNotificationRole = guildRoleIds.some((roleId) => member?.roles.cache.has(roleId));
    if (!hasNotificationRole) {
      await interaction.reply({
        content: 'Você não possui nenhuma das roles de notificação configuradas para usar este comando.',
        ephemeral: true,
      });
      return;
    }

    const gameId = interaction.fields.getTextInputValue(INPUT_GAME_ID).trim();
    if (!gameId) {
      await interaction.reply({ content: 'Informe um ID de jogo válido.', ephemeral: true });
      return;
    }

    const existingDiscordUser = await findByGuildAndDiscordUser(guildDoc.guild_id, interaction.user.id);
    if (existingDiscordUser) {
      await interaction.reply({ content: `Você já está vinculado a outro ID de jogo (${existingDiscordUser.account_id}).`, ephemeral: true });
      return;
    }
    const existingMember = await findByGuildAndAccount(guildDoc.guild_id, gameId);

    if (existingMember?.discord_user && existingMember.discord_user !== interaction.user.id) {
      await interaction.reply({ content: 'ID do jogo já está vinculado a outro usuário.', ephemeral: true });
      return;
    }
    if (existingMember?.status === 'CONFIRMED') {
      await interaction.reply({ content: 'ID do jogo já está confirmado.', ephemeral: true });
      return;
    }

    const { updated, status } = await linkDiscordToGameId({
      guildId: guildDoc.guild_id,
      accountId: gameId,
      discordUserId: interaction.user.id,
      roles: guildRoleIds.filter((roleId) => member?.roles.cache.has(roleId) ?? false),
    });

    if (status === 'CONFIRMED') {
      const recruitmentContent = guildDoc.recruitment_message?.content?.trim();
      if (recruitmentContent) {
        // mesma regra de notificação do comando /atualizar (via DM)
        await interaction.user.send(recruitmentContent).catch(() => {});
      }
    }

    await interaction.reply({ content: `Seu ID de jogo foi registrado/atualizado com sucesso. Status: **${getStatusLabel(status)}**.`, ephemeral: true });
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: 'Ocorreu um erro ao processar o ID de jogo.', ephemeral: true });
    return;
  }
}
