import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ActionRowBuilder,
} from 'discord.js';
import { Guild } from '../models/Guild';
import { userSharesRoleWithBot } from '../utils/roleCheck';

const SELECT_MEMBER_ROLE_ID = 'set_member_role_select';
const MAX_SELECT_OPTIONS = 25;

function getGuildRoleOptions(
  discordGuild: { id: string; roles: { cache: Map<string, { id: string; name: string }> } },
  currentRoleId?: string
) {
  const roles = Array.from(discordGuild.roles.cache.values())
    .filter((r) => r.id !== discordGuild.id)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, MAX_SELECT_OPTIONS);
  return roles.map((r) => ({
    label: r.name ?? r.id,
    value: r.id,
    description: r.id === currentRoleId ? 'Atual' : undefined,
  }));
}

export const setMemberRoleCommand = new SlashCommandBuilder()
  .setName('role-membro')
  .setDescription('[ADM] Defina a role de membro da guilda.')
  .toJSON();

export async function handleSetMemberRoleCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId || !interaction.guild) {
    await interaction.reply({
      content: 'Este comando só pode ser usado em um servidor.',
      ephemeral: true,
    });
    return;
  }

  if (!userSharesRoleWithBot(interaction.guild, interaction.member as Parameters<typeof userSharesRoleWithBot>[1])) {
    await interaction.reply({
      content: 'Você não tem permissão para executar este comando.',
      ephemeral: true,
    });
    return;
  }

  const guildDoc = await Guild.findOne({ where: { discord_server_id: discordServerId } });
  if (!guildDoc) {
    await interaction.reply({
      content: 'Este servidor ainda não possui uma guilda configurada. Use `/configurar` primeiro.',
      ephemeral: true,
    });
    return;
  }

  const options = getGuildRoleOptions(interaction.guild, guildDoc.member_role ?? undefined);
  if (options.length === 0) {
    await interaction.reply({
      content: 'Não há roles disponíveis neste servidor (além de @everyone).',
      ephemeral: true,
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_MEMBER_ROLE_ID)
    .setPlaceholder('Selecione a role de membro')
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  await interaction.reply({
    content: 'Selecione a role que representa **membro da guilda** (será salva em `guild.member_role`):',
    components: [row],
    ephemeral: true,
  });
}

export async function handleSetMemberRoleSelect(
  interaction: StringSelectMenuInteraction
): Promise<boolean> {
  if (interaction.customId !== SELECT_MEMBER_ROLE_ID) return false;

  const discordServerId = interaction.guildId;
  if (!discordServerId || !interaction.guild) {
    await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (!userSharesRoleWithBot(interaction.guild, interaction.member as Parameters<typeof userSharesRoleWithBot>[1])) {
    await interaction.reply({
      content: 'Você não tem permissão para esta ação.',
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  const roleId = interaction.values[0];
  if (!roleId) {
    await interaction.reply({ content: 'Nenhuma role selecionada.', ephemeral: true }).catch(() => {});
    return true;
  }

  const guildDoc = await Guild.findOne({ where: { discord_server_id: discordServerId } });
  if (!guildDoc) {
    await interaction.reply({ content: 'Guilda não encontrada para este servidor.', ephemeral: true }).catch(() => {});
    return true;
  }

  const role = interaction.guild.roles.cache.get(roleId);
  const roleName = role?.name ?? roleId;

  await Guild.update({ member_role: roleId }, { where: { discord_server_id: discordServerId } });

  await interaction.update({
    content: `Role de membro selecionada: **${roleName}**.`,
    components: [],
  }).catch(() => {});

  return true;
}
