import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Guild } from '../models/Guild';
import { syncMembersForGuild } from '../services/syncGuildMembers';

const SETUP_PERMISSIONS =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.Administrator;

export const syncCommand = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Sincroniza os membros da guilda com a API do Guild Wars 2 (mesmo processo do job).')
  .setDefaultMemberPermissions(SETUP_PERMISSIONS)
  .toJSON();

export async function handleSyncCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
    return;
  }

  const permissions = interaction.memberPermissions;
  const allowed =
    permissions?.has(PermissionFlagsBits.ManageRoles) ||
    permissions?.has(PermissionFlagsBits.ManageChannels) ||
    permissions?.has(PermissionFlagsBits.ManageGuild) ||
    permissions?.has(PermissionFlagsBits.Administrator);
  if (!allowed) {
    await interaction.reply({
      content:
        'Você precisa de uma destas permissões no servidor para usar o sync: **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**.',
      ephemeral: true,
    });
    return;
  }

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc) {
    await interaction.reply({
      content: 'Este servidor ainda não possui uma guilda configurada. Use `/setup` primeiro.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await syncMembersForGuild(guildDoc.guild_id, guildDoc.api_key);

  if (!result.ok) {
    await interaction.editReply({ content: `Erro ao sincronizar: **${result.error}**` });
    return;
  }

  await interaction.editReply({
    content: `Sincronização concluída para **${guildDoc.name}**.\n` +
      `• ${result.pendingGuildDataCount} membro(s) com dados da Guilda pendentes.\n` +
      `• ${result.pendingDiscordDataCount} membro(s) com dados do Discord pendentes.\n` +
      `• ${result.confirmedCount} membro(s) confirmados.`,
  });
}
