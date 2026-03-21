import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ChannelType,
  StringSelectMenuOptionBuilder,
  LabelBuilder,
} from 'discord.js';
import { Guild } from '../models/Guild';
import { searchGuildByName } from '../services/gw2Api';
import { getGuildMembers } from '../services/gw2GuildMembers';
import { upsertFromSetup } from '../services/guildMemberService';
import { userSharesRoleWithBot } from '../utils/roleCheck';

const MODAL_ID = 'setup_modal';
const SETUP_RECRUITMENT_CHANNEL_ID = 'setup_recruitment_channel';
const SETUP_NOTIFY_CHANNEL_ID = 'setup_notify_channel';
const SETUP_BASE_ROLE_SELECT_ID = 'setup_base_role';
const INPUT_API_KEY = 'setup_api_key';

const MAX_SELECT_OPTIONS = 25;

/** Armazena canal de notificação escolhido antes de abrir o modal: key = guildId:userId */
const pendingNotifyChannel = new Map<string, string>();
/** Armazena roles escolhidas antes de abrir o modal: key = guildId:userId */
const pendingRoles = new Map<string, string[]>();
/** Armazena nome da guilda informado no comando para usar no submit do modal: key = guildId:userId */
const pendingGuildName = new Map<string, string>();

export const setupCommand = new SlashCommandBuilder()
  .setName('configurar')
  .setDescription('[ADM] Configura o nome da guilda e a chave de API do Guild Wars 2 para este servidor.')
  .addStringOption((opt) =>
    opt
      .setName('guilda')
      .setDescription('Digite o nome da guilda')
      .setRequired(true)
  )
  .toJSON();

function buildSetupModal(
  title: string,
  interaction: ChatInputCommandInteraction,
  apiKeyPlaceholder: string,
  currentNotifyChannelId?: string,
  currentRoleIds: string[] = []
): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle(title);

  const keyInput = new TextInputBuilder()
    .setCustomId(INPUT_API_KEY)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(apiKeyPlaceholder ? 'Deixe em branco para não alterar' : 'Cole sua chave de API')
    .setRequired(!apiKeyPlaceholder)
    .setMaxLength(128);
  if (!apiKeyPlaceholder) keyInput.setMinLength(64);

  const keyLabel = new LabelBuilder()
    .setLabel("Chave da API do Guild Wars 2")
    .setTextInputComponent(keyInput);
      
    const textChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
    const channels = interaction.guild?.channels.cache.filter((c) => textChannelTypes.includes(c.type as ChannelType)) ?? [];

    const recroutmentChannelSelect = new StringSelectMenuBuilder()
      .setCustomId(SETUP_RECRUITMENT_CHANNEL_ID)
      .setPlaceholder('Selecione o canal de recrutamento')
      .addOptions(
        Array.from(channels.values()).map((ch) => ({
          label: ch.name ?? ch.id,
          value: ch.id,
        }))
      );

    const recruitmentChannelLabel = new LabelBuilder()
      .setLabel("Selecione o canal de recrutamento")
      .setStringSelectMenuComponent(recroutmentChannelSelect);

    const notifyChannelSelect = new StringSelectMenuBuilder()
      .setCustomId(SETUP_NOTIFY_CHANNEL_ID)
      .setPlaceholder('Selecione o canal para notificações')
      .addOptions(
        Array.from(channels.values()).map((ch) => ({
          label: ch.name ?? ch.id,
          value: ch.id,
        }))
      );

    const notifyChannelLabel = new LabelBuilder()
      .setLabel("Selecione o canal para notificações")
      .setStringSelectMenuComponent(notifyChannelSelect);

  const baseOptions = getGuildRoleOptions(interaction.guild!, currentRoleIds);
  const baseRoleSelect = new StringSelectMenuBuilder()
    .setCustomId(SETUP_BASE_ROLE_SELECT_ID)
    .setMinValues(1)
    .setMaxValues(2)
    .setPlaceholder('Roles do usuário no Discord (para notificações)')
    .addOptions(...baseOptions);
    
  const baseRoleLabel = new LabelBuilder()
    .setLabel("Selecione as Roles")
    .setStringSelectMenuComponent(baseRoleSelect);

  modal.addLabelComponents(keyLabel, recruitmentChannelLabel, notifyChannelLabel, baseRoleLabel);

  return modal;
}

/** Retorna opções de roles do servidor (exclui @everyone), no máximo MAX_SELECT_OPTIONS. */
function getGuildRoleOptions(
  discordGuild: { id: string; roles: { cache: Map<string, { id: string; name: string }> } },
  currentValues: string[] = []
) {
  const roles = Array.from(discordGuild.roles.cache.values())
    .filter((r) => r.id !== discordGuild.id)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, MAX_SELECT_OPTIONS);
  return roles.map((r) => ({
    label: r.name ?? r.id,
    value: r.id,
    description: currentValues.includes(r.id) ? 'Selecionado' : undefined,
  }));
}

export async function handleSetupCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  try {
    const key = getPendingKey(interaction);
    if (!key || !interaction.guild) return false;
    if (!userSharesRoleWithBot(interaction.guild, interaction.member as Parameters<typeof userSharesRoleWithBot>[1])) {
      await interaction.reply({
        content: 'Você não tem permissão para executar este comando',
        ephemeral: true,
      }).catch(() => {});
      return false;
    }
    const guildName = interaction.options.getString('guilda', true).trim();
    if (!guildName) {
      await interaction.reply({ content: 'Informe o nome da guilda no parâmetro **guilda**.', ephemeral: true }).catch(() => {});
      return false;
    }
    pendingGuildName.set(key, guildName);
    const existing = await Guild.findOne({ where: { discord_server_id: interaction.guildId! } });
    const modal = buildSetupModal(
      existing ? 'Alterar Guild' : 'Configurar guilda',
      interaction,
      existing?.api_key ? '••••••••' : '',
      existing?.notify_channel ?? '',
      existing?.notification_roles ?? []
    );
    await interaction.showModal(modal);
  } catch (error) {
    console.error(error);
    return false;
  }
  return true;
}

export async function handleSetupModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId !== MODAL_ID) return;

  const discordServerId = interaction.guildId;
  const guild = interaction.guild;
  if (!discordServerId || !guild) {
    await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true });
    return;
  }
  if (!userSharesRoleWithBot(guild, interaction.member as Parameters<typeof userSharesRoleWithBot>[1])) {
    await interaction.reply({
      content: 'Você não tem permissão para executar este comando',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const pendingKey = `${discordServerId}:${interaction.user.id}`;
  const guildName = pendingGuildName.get(pendingKey)?.trim() ?? '';
  pendingGuildName.delete(pendingKey);

  let apiKey = interaction.fields.getTextInputValue(INPUT_API_KEY).trim();
  let roleIds = interaction.fields.getStringSelectValues(SETUP_BASE_ROLE_SELECT_ID) ?? [];
  let recruitmentChannelId = interaction.fields.getStringSelectValues(SETUP_RECRUITMENT_CHANNEL_ID)?.[0] ?? '';
  let notifyChannelId = interaction.fields.getStringSelectValues(SETUP_NOTIFY_CHANNEL_ID)?.[0] ?? '';

  const existingGuild = await Guild.findOne({ where: { discord_server_id: discordServerId } });
  if (existingGuild && !apiKey) {
    apiKey = existingGuild.api_key;
  }

  if (!guildName) {
    await interaction.editReply({ content: 'Nome da guilda não encontrado. Use o comando novamente com o parâmetro **guilda**.' });
    return;
  }
  if (!apiKey) {
    await interaction.editReply({ content: 'Informe a chave de API.' });
    return;
  }

  const guildIdFromSearch = await searchGuildByName(guildName);
  if (!guildIdFromSearch) {
    await interaction.editReply({ content: `Nenhuma guilda encontrada com o nome: **${guildName}**. Verifique o nome e tente novamente.` });
    return;
  }

  const membersResult = await getGuildMembers(guildIdFromSearch, apiKey);
  if (!membersResult.ok) {
    await interaction.editReply({
      content: `Erro: **${membersResult.error}**`,
    });
    return;
  }

  const guildId = guildIdFromSearch;

  pendingNotifyChannel.delete(pendingKey);
  pendingRoles.delete(pendingKey);

  const filteredRoles = roleIds.filter((id) => id !== '__none__');
  if (existingGuild) {
    await existingGuild.update({
      guild_id: guildId,
      name: guildName,
      api_key: apiKey,
      ...(recruitmentChannelId ? { recruitment_channel: recruitmentChannelId } : {}),
      ...(notifyChannelId ? { notify_channel: notifyChannelId } : {}),
      notification_roles: filteredRoles,
    });
  } else {
    await Guild.create({
      guild_id: guildId,
      discord_server_id: discordServerId,
      name: guildName,
      api_key: apiKey,
      recruitment_channel: recruitmentChannelId || '',
      notify_channel: notifyChannelId || '',
      notification_roles: filteredRoles,
    });
  }

  for (const m of membersResult.members) {
    await upsertFromSetup(guildId, m);
  }

  const channelInfo = notifyChannelId && interaction.guild
    ? interaction.guild.channels.cache.get(notifyChannelId)?.name
    : null;
  const channelText = channelInfo ? ` Canal de notificações: **#${channelInfo}**.` : '';

  await interaction.editReply({
    content: `Guilda **${guildName}** configurada com sucesso. ${membersResult.members.length} membro(s) sincronizado(s).${channelText}`,
  });
}

function getPendingKey(interaction: ChatInputCommandInteraction): string {
  const discordServerId = interaction.guildId;
  return discordServerId ? `${discordServerId}:${interaction.user.id}` : '';
}

function getPendingKeyFromInteraction(interaction: { guildId: string | null; user: { id: string } }): string {
  return interaction.guildId && interaction.user ? `${interaction.guildId}:${interaction.user.id}` : '';
}

/** Armazena as escolhas dos selects do setup (canal e roles) quando o usuário interage com eles no modal. */
export async function handleSetupSelectMenu(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const key = getPendingKeyFromInteraction(interaction);
  if (!key) return false;
  if (interaction.customId === SETUP_NOTIFY_CHANNEL_ID) {
    const value = interaction.values[0];
    if (value) pendingNotifyChannel.set(key, value);
    await interaction.deferUpdate().catch(() => {});
    return true;
  }
  if (interaction.customId === SETUP_BASE_ROLE_SELECT_ID) {
    pendingRoles.set(key, interaction.values.filter((v) => v !== '__none__'));
    await interaction.deferUpdate().catch(() => {});
    return true;
  }
  return false;
}
