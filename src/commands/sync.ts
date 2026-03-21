import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Guild } from '../models/Guild';
import { syncMembersForGuild, applyPostSyncActions } from '../services/syncGuildMembers';
import { userSharesRoleWithBot } from '../utils/roleCheck';

export const syncCommand = new SlashCommandBuilder()
  .setName('atualizar')
  .setDescription('[ADM] Sincroniza membros da guilda com a API do Guild Wars 2.')
  .toJSON();

export async function handleSyncCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId || !interaction.guild) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
    return;
  }
  if (!userSharesRoleWithBot(interaction.guild, interaction.member as Parameters<typeof userSharesRoleWithBot>[1])) {
    await interaction.reply({
      content: 'Você não tem permissão para executar este comando',
      ephemeral: true,
    });
    return;
  }

  const guildDoc = await Guild.findOne({ where: { discord_server_id: discordServerId } });
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

  const guild = interaction.guild;
  if (guild) {
    await applyPostSyncActions(guild, guildDoc, result);
  }

  await interaction.editReply({
    content: `Sincronização concluída para **${guildDoc.name}**.\n` +
      `• ${result.pendingGuildDataCount} membro(s) com dados da Guilda pendentes.\n` +
      `• ${result.pendingDiscordDataCount} membro(s) com dados do Discord pendentes.\n` +
      `• ${result.confirmedCount} membro(s) confirmados.`,
  });
}
