import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ChannelType,
  LabelBuilder,
  AutocompleteInteraction,
  ApplicationCommandOptionChoiceData,
  Guild as DiscordGuild,
} from 'discord.js';
import { Guild } from '../models/Guild';
import { searchGuildByName } from '../services/gw2Api';
import { getGuildMembers } from '../services/gw2GuildMembers';
import { upsertFromSetup } from '../services/guildMemberService';
import { userSharesRoleWithBot } from '../utils/roleCheck';

const MODAL_ID = 'setup_modal';
/** Nomes das opções slash (autocomplete) — equivalentes aos antigos customIds do modal. */
const SETUP_RECRUITMENT_CHANNEL_ID = 'setup_recruitment_channel';
const SETUP_NOTIFY_CHANNEL_ID = 'setup_notify_channel';
const SETUP_BASE_ROLE_SELECT_ID = 'setup_base_role';
const SETUP_BASE_ROLE_2_ID = 'setup_base_role_2';
const INPUT_API_KEY = 'setup_api_key';

const MAX_AUTOCOMPLETE = 25;
const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** Canal de recrutamento escolhido no slash antes do modal: key = guildId:userId */
const pendingRecruitmentChannel = new Map<string, string>();
/** Canal de notificação escolhido no slash antes do modal: key = guildId:userId */
const pendingNotifyChannel = new Map<string, string>();
/** Roles escolhidas no slash antes do modal: key = guildId:userId */
const pendingRoles = new Map<string, string[]>();
/** Nome da guilda informado no comando para usar no submit do modal: key = guildId:userId */
const pendingGuildName = new Map<string, string>();

export const setupCommand = new SlashCommandBuilder()
  .setName('configurar')
  .setDescription('[ADM] Configura o nome da guilda e a chave de API do Guild Wars 2 para este servidor.')
  .addStringOption((opt) =>
    opt.setName('guilda').setDescription('Digite o nome da guilda').setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName(SETUP_RECRUITMENT_CHANNEL_ID)
      .setDescription('Canal de recrutamento (busque pelo nome; até 25 resultados)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName(SETUP_NOTIFY_CHANNEL_ID)
      .setDescription('Canal de notificações (busque pelo nome; até 25 resultados)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName(SETUP_BASE_ROLE_SELECT_ID)
      .setDescription('Role para notificações (1ª; busque pelo nome)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName(SETUP_BASE_ROLE_2_ID)
      .setDescription('Role para notificações (2ª, opcional)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .toJSON();

function truncateChoiceName(name: string, max = 100): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

function channelAutocompleteChoices(
  guild: DiscordGuild,
  focused: string
): ApplicationCommandOptionChoiceData[] {
  const q = focused.trim().toLowerCase();
  let list = Array.from(guild.channels.cache.values()).filter((c) =>
    TEXT_CHANNEL_TYPES.includes(c.type as ChannelType)
  );
  list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  if (q) list = list.filter((c) => (c.name ?? '').toLowerCase().includes(q));
  else list = list.slice(0, MAX_AUTOCOMPLETE);
  return list.slice(0, MAX_AUTOCOMPLETE).map((c) => ({
    name: truncateChoiceName(`#${c.name ?? c.id}`),
    value: c.id,
  }));
}

function roleAutocompleteChoices(
  guild: DiscordGuild,
  focused: string
): ApplicationCommandOptionChoiceData[] {
  const q = focused.trim().toLowerCase();
  let roles = Array.from(guild.roles.cache.values()).filter((r) => r.id !== guild.id);
  roles.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  if (q) roles = roles.filter((r) => (r.name ?? '').toLowerCase().includes(q));
  else roles = roles.slice(0, MAX_AUTOCOMPLETE);
  return roles.slice(0, MAX_AUTOCOMPLETE).map((r) => ({
    name: truncateChoiceName(r.name ?? r.id),
    value: r.id,
  }));
}

export async function handleSetupAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  const focused = interaction.options.getFocused(true);
  let choices: ApplicationCommandOptionChoiceData[] = [];
  switch (focused.name) {
    case SETUP_RECRUITMENT_CHANNEL_ID:
    case SETUP_NOTIFY_CHANNEL_ID:
      choices = channelAutocompleteChoices(interaction.guild, focused.value);
      break;
    case SETUP_BASE_ROLE_SELECT_ID:
    case SETUP_BASE_ROLE_2_ID:
      choices = roleAutocompleteChoices(interaction.guild, focused.value);
      break;
    default:
      choices = [];
  }
  await interaction.respond(choices).catch(() => {});
}

function buildSetupModal(title: string, apiKeyPlaceholder: string): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle(title);

  const keyInput = new TextInputBuilder()
    .setCustomId(INPUT_API_KEY)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(apiKeyPlaceholder ? 'Deixe em branco para não alterar' : 'Cole sua chave de API')
    .setRequired(!apiKeyPlaceholder)
    .setMaxLength(128);
  if (!apiKeyPlaceholder) keyInput.setMinLength(64);

  const keyLabel = new LabelBuilder()
    .setLabel('Chave da API do Guild Wars 2')
    .setTextInputComponent(keyInput);

  modal.addLabelComponents(keyLabel);
  return modal;
}

function isTextChannel(guild: DiscordGuild, id: string): boolean {
  const ch = guild.channels.cache.get(id);
  return ch !== undefined && TEXT_CHANNEL_TYPES.includes(ch.type as ChannelType);
}

function isAssignableRole(guild: DiscordGuild, id: string): boolean {
  const r = guild.roles.cache.get(id);
  return r !== undefined && r.id !== guild.id;
}

export async function handleSetupCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  try {
    const key = getPendingKey(interaction);
    if (!key || !interaction.guild) return false;
    if (!userSharesRoleWithBot(interaction.guild, interaction.member as Parameters<typeof userSharesRoleWithBot>[1])) {
      await interaction
        .reply({
          content: 'Você não tem permissão para executar este comando',
          ephemeral: true,
        })
        .catch(() => {});
      return false;
    }
    const guildName = interaction.options.getString('guilda', true).trim();
    if (!guildName) {
      await interaction
        .reply({ content: 'Informe o nome da guilda no parâmetro **guilda**.', ephemeral: true })
        .catch(() => {});
      return false;
    }

    const recruitId = interaction.options.getString(SETUP_RECRUITMENT_CHANNEL_ID);
    const notifyId = interaction.options.getString(SETUP_NOTIFY_CHANNEL_ID);
    const roleId1 = interaction.options.getString(SETUP_BASE_ROLE_SELECT_ID);
    const roleId2 = interaction.options.getString(SETUP_BASE_ROLE_2_ID);

    if (recruitId && !isTextChannel(interaction.guild, recruitId)) {
      await interaction
        .reply({ content: 'Canal de recrutamento inválido. Escolha uma opção da lista de autocomplete.', ephemeral: true })
        .catch(() => {});
      return false;
    }
    if (notifyId && !isTextChannel(interaction.guild, notifyId)) {
      await interaction
        .reply({ content: 'Canal de notificações inválido. Escolha uma opção da lista de autocomplete.', ephemeral: true })
        .catch(() => {});
      return false;
    }

    const roleList = [roleId1, roleId2].filter((x): x is string => Boolean(x));
    if (roleList.length !== new Set(roleList).size) {
      await interaction
        .reply({ content: 'Não use a mesma role nos dois campos de notificação.', ephemeral: true })
        .catch(() => {});
      return false;
    }
    for (const rid of roleList) {
      if (!isAssignableRole(interaction.guild, rid)) {
        await interaction
          .reply({ content: 'Uma das roles de notificação é inválida. Escolha opções da lista de autocomplete.', ephemeral: true })
          .catch(() => {});
        return false;
      }
    }

    pendingGuildName.set(key, guildName);
    if (recruitId) pendingRecruitmentChannel.set(key, recruitId);
    else pendingRecruitmentChannel.delete(key);
    if (notifyId) pendingNotifyChannel.set(key, notifyId);
    else pendingNotifyChannel.delete(key);
    if (roleList.length) pendingRoles.set(key, roleList);
    else pendingRoles.delete(key);

    const existing = await Guild.findOne({ where: { discord_server_id: interaction.guildId! } });
    const modal = buildSetupModal(existing ? 'Alterar Guild' : 'Configurar guilda', existing?.api_key ? '••••••••' : '');
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

  const existingGuild = await Guild.findOne({ where: { discord_server_id: discordServerId } });
  if (existingGuild && !apiKey) {
    apiKey = existingGuild.api_key;
  }

  let recruitmentChannelId = pendingRecruitmentChannel.has(pendingKey)
    ? pendingRecruitmentChannel.get(pendingKey)!
    : (existingGuild?.recruitment_channel ?? '');
  pendingRecruitmentChannel.delete(pendingKey);

  let notifyChannelId = pendingNotifyChannel.has(pendingKey)
    ? pendingNotifyChannel.get(pendingKey)!
    : (existingGuild?.notify_channel ?? '');
  pendingNotifyChannel.delete(pendingKey);

  let roleIds = pendingRoles.has(pendingKey) ? pendingRoles.get(pendingKey)! : (existingGuild?.notification_roles ?? []);
  pendingRoles.delete(pendingKey);

  const filteredRoles = roleIds.filter((id) => id !== '__none__');

  if (!guildName) {
    await interaction.editReply({ content: 'Nome da guilda não encontrado. Use o comando novamente com o parâmetro **guilda**.' });
    return;
  }
  if (!apiKey) {
    await interaction.editReply({ content: 'Informe a chave de API.' });
    return;
  }
  if (!existingGuild && filteredRoles.length === 0) {
    await interaction.editReply({
      content:
        'Para a primeira configuração, informe pelo menos uma **role de notificação** nas opções do comando (antes de abrir o modal).',
    });
    return;
  }

  const guildIdFromSearch = await searchGuildByName(guildName);
  if (!guildIdFromSearch) {
    await interaction.editReply({
      content: `Nenhuma guilda encontrada com o nome: **${guildName}**. Verifique o nome e tente novamente.`,
    });
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
