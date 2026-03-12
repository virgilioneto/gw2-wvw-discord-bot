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
  PermissionFlagsBits,
  StringSelectMenuOptionBuilder,
  LabelBuilder,
} from 'discord.js';
import { Guild } from '../models/Guild';
import { GuildMember } from '../models/GuildMember';
import { searchGuildByName } from '../services/gw2Api';
import { getGuildMembers } from '../services/gw2GuildMembers';

const MODAL_ID = 'setup_modal';
const SETUP_CHANNEL_SELECT_ID = 'setup_notify_channel';
const SETUP_BASE_ROLE_SELECT_ID = 'setup_base_role';
const INPUT_GUILD_NAME = 'setup_guild_name';
const INPUT_API_KEY = 'setup_api_key';
const INPUT_DM_NOTIFY = 'setup_dm_notify';

const MAX_SELECT_OPTIONS = 25;

/** Armazena canal de notificação escolhido antes de abrir o modal: key = guildId:userId */
const pendingNotifyChannel = new Map<string, string>();
/** Armazena roles escolhidas antes de abrir o modal: key = guildId:userId */
const pendingRoles = new Map<string, string[]>();

export const setupCommand = new SlashCommandBuilder()
  .setName('configurar')
  .setDescription('Configura o nome da guilda e a chave de API do Guild Wars 2 para este servidor.')
  .toJSON();

function buildSetupModal(
  title: string,
  interaction: ChatInputCommandInteraction,
  guildName: string,
  apiKeyPlaceholder: string,
  dmNotifyPlayer: boolean = true,
  currentNotifyChannelId?: string,
  currentRoleIds: string[] = []
): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle(title);

  const nameInput = new TextInputBuilder()
    .setCustomId(INPUT_GUILD_NAME)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nome exato da guilda no jogo')
    .setRequired(true)
    .setMaxLength(256);
  if (guildName) nameInput.setValue(guildName);
  
  const nameLabel = new LabelBuilder()
    .setLabel("Nome da Guilda")
    .setTextInputComponent(nameInput);
  
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
  
  const notifyDMSelect = new StringSelectMenuBuilder()
    .setCustomId(INPUT_DM_NOTIFY)
    .setPlaceholder('Escolha uma opção')
    .setRequired(true)
    .addOptions(
      new StringSelectMenuOptionBuilder()
      .setLabel('Não')
      .setValue('false'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Sim')
        .setDescription('O bot enviará DM se o jogador não definir a guilda como WvW no jogo.')
        .setValue('true'),
    );

    const notifyDMLabel = new LabelBuilder()
      .setLabel("Enviar notificação via DM?")
      .setStringSelectMenuComponent(notifyDMSelect);
      
    const textChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
    const channels = interaction.guild?.channels.cache.filter((c) => textChannelTypes.includes(c.type as ChannelType)) ?? [];
    const channelSelect = new StringSelectMenuBuilder()
      .setCustomId(SETUP_CHANNEL_SELECT_ID)
      .setPlaceholder('Selecione o canal para notificações')
      .addOptions(
        Array.from(channels.values()).map((ch) => ({
          label: ch.name ?? ch.id,
          value: ch.id,
        }))
      );

    const channelLabel = new LabelBuilder()
      .setLabel("Selecione o canal para notificações")
      .setStringSelectMenuComponent(channelSelect);

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

  modal.addLabelComponents(nameLabel, keyLabel, notifyDMLabel, channelLabel, baseRoleLabel);

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
    const existing = await Guild.findOne({ discord_server_id: interaction.guildId }).exec();
    const modal = buildSetupModal(
      existing ? 'Alterar Guild' : 'Configurar guilda',
      interaction,
      existing?.name ?? '',
      existing?.api_key ? '••••••••' : '',
      existing?.dm_notify_player ?? true,
      existing?.notify_channel ?? '',
      existing?.roles ?? []
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
  if (!discordServerId) {
    await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true });
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
        'Você precisa de uma destas permissões no servidor para usar o setup: **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildName = interaction.fields.getTextInputValue(INPUT_GUILD_NAME).trim();
  let apiKey = interaction.fields.getTextInputValue(INPUT_API_KEY).trim();
  let roleIds = interaction.fields.getStringSelectValues(SETUP_BASE_ROLE_SELECT_ID) ?? [];
  let notifyChannelId = interaction.fields.getStringSelectValues(SETUP_CHANNEL_SELECT_ID)?.[0] ?? '';

  let dmNotifyPlayer = true;
  try {
    const dmNotifyRaw = interaction.fields.getTextInputValue(INPUT_DM_NOTIFY)?.trim().toLowerCase() ?? 'sim';
    dmNotifyPlayer = /^(sim|s|yes|true|1)$/i.test(dmNotifyRaw);
  } catch {
    // Modal antigo sem o campo: mantém true
  }

  const existingGuild = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (existingGuild && !apiKey) {
    apiKey = existingGuild.api_key;
  }

  if (!guildName) {
    await interaction.editReply({ content: 'Informe o nome da guilda.' });
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

  const pendingKey = `${discordServerId}:${interaction.user.id}`;

  await Guild.findOneAndUpdate(
    { discord_server_id: discordServerId },
    {
      $set: {
        guild_id: guildId,
        discord_server_id: discordServerId,
        name: guildName,
        api_key: apiKey,
        ...(notifyChannelId ? { notify_channel: notifyChannelId } : {}),
        roles: roleIds.filter((id) => id !== '__none__'),
        dm_notify_player: dmNotifyPlayer,
      },
    },
    { upsert: true, new: true }
  ).exec();

  pendingNotifyChannel.delete(pendingKey);
  pendingRoles.delete(pendingKey);

  for (const m of membersResult.members) {
    const joinedAt = m.joined ? new Date(m.joined) : new Date();
    await GuildMember.findOneAndUpdate(
      { guild_id: guildId, account_id: m.name },
      {
        $set: {
          account_id: m.name,
          guild_id: guildId,
          wvw_member: m.wvw_member,
          joined_at: joinedAt,
        },
        $setOnInsert: {
          status: 'PENDING_DISCORD_DATA',
        },
      },
      { upsert: true }
    ).exec();
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
  if (interaction.customId === SETUP_CHANNEL_SELECT_ID) {
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
