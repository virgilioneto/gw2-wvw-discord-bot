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
import { GuildMember } from '../models/GuildMember';

const MODAL_ID = 'join_modal';
const INPUT_GAME_ID = 'join_game_id';

export const joinCommand = new SlashCommandBuilder()
  .setName('join')
  .setDescription('Informe ou atualize seu ID de jogo (Guild Wars 2) para este servidor.')
  .toJSON();

async function showJoinModal(interaction: ChatInputCommandInteraction, currentGameId: string) {
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

export async function handleJoinCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
    return;
  }

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc) {
    await interaction.reply({
      content: 'Este servidor ainda não possui uma guilda configurada. Peça a um administrador para usar `/setup`.',
      ephemeral: true,
    });
    return;
  }

  const existing = await GuildMember.findOne({
    guild_id: guildDoc.guild_id,
    discord_user: interaction.user.id,
  }).exec();

  await showJoinModal(interaction, existing?.account_id ?? '');
}

export async function handleJoinModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
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

  const gameId = interaction.fields.getTextInputValue(INPUT_GAME_ID).trim();
  if (!gameId) {
    await interaction.reply({ content: 'Informe um ID de jogo válido.', ephemeral: true });
    return;
  }

  const member = interaction.guild?.members.resolve(interaction.user.id) ?? (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null));
  const hasBaseRole = !!guildDoc.base_discord_role && (member?.roles.cache.has(guildDoc.base_discord_role) ?? false);
  const hasWvwRole = !!guildDoc.wvw_discord_role && (member?.roles.cache.has(guildDoc.wvw_discord_role) ?? false);

  // Desvincula este usuário de qualquer outro account_id nesta guilda
  await GuildMember.updateMany(
    { guild_id: guildDoc.guild_id, discord_user: interaction.user.id },
    { $set: { discord_user: '' } }
  ).exec();

  await GuildMember.findOneAndUpdate(
    { guild_id: guildDoc.guild_id, account_id: gameId },
    {
      $set: {
        discord_user: interaction.user.id,
        status: 'PENDING',
        joined_at: new Date(),
        base_discord_role: hasBaseRole,
        wvw_discord_role: hasWvwRole,
      },
    },
    { upsert: true, new: true }
  ).exec();

  await interaction.reply({ content: 'Seu ID de jogo foi registrado/atualizado com sucesso. Status: **PENDING**.', ephemeral: true });
}
