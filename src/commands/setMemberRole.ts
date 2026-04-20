import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ApplicationCommandOptionChoiceData,
} from 'discord.js';
import { Guild } from '../models/Guild';
import { userSharesRoleWithBot } from '../utils/roleCheck';

/** Nome da opção slash (autocomplete); antes era o customId do StringSelectMenu. */
export const SELECT_MEMBER_ROLE_ID = 'set_member_role_select';

const MAX_AUTOCOMPLETE = 25;

function truncateChoiceName(name: string, max = 100): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

function roleAutocompleteChoices(
  discordGuild: { id: string; roles: { cache: Map<string, { id: string; name: string }> } },
  focused: string
): ApplicationCommandOptionChoiceData[] {
  const q = focused.trim().toLowerCase();
  let roles = Array.from(discordGuild.roles.cache.values()).filter((r) => r.id !== discordGuild.id);
  roles.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  if (q) roles = roles.filter((r) => (r.name ?? '').toLowerCase().includes(q));
  else roles = roles.slice(0, MAX_AUTOCOMPLETE);
  return roles.slice(0, MAX_AUTOCOMPLETE).map((r) => ({
    name: truncateChoiceName(r.name ?? r.id),
    value: r.id,
  }));
}

export const setMemberRoleCommand = new SlashCommandBuilder()
  .setName('role-membro')
  .setDescription('[ADM] Defina a role de membro da guilda.')
  .addStringOption((opt) =>
    opt
      .setName(SELECT_MEMBER_ROLE_ID)
      .setDescription('Busque pelo nome da role (até 25 resultados)')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .toJSON();

export async function handleSetMemberRoleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (!interaction.guild || focused.name !== SELECT_MEMBER_ROLE_ID) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  const choices = roleAutocompleteChoices(interaction.guild, focused.value);
  await interaction.respond(choices).catch(() => {});
}

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

  const roleId = interaction.options.getString(SELECT_MEMBER_ROLE_ID, true);
  const role = interaction.guild.roles.cache.get(roleId);
  if (!role || role.id === interaction.guild.id) {
    await interaction.reply({
      content: 'Role inválida ou indisponível. Escolha outra opção na lista de autocomplete.',
      ephemeral: true,
    });
    return;
  }

  await Guild.update({ member_role: roleId }, { where: { discord_server_id: discordServerId } });

  await interaction.reply({
    content: `Role de membro definida: **${role.name}**.`,
    ephemeral: true,
  });
}
