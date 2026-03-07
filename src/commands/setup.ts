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
} from 'discord.js';
import { Guild } from '../models/Guild';
import { GuildMember } from '../models/GuildMember';
import { searchGuildByName } from '../services/gw2Api';
import { getGuildMembers } from '../services/gw2GuildMembers';

const MODAL_ID = 'setup_modal';
const SETUP_CHANNEL_SELECT_ID = 'setup_notify_channel';
const SETUP_BASE_ROLE_SELECT_ID = 'setup_base_role';
const SETUP_WVW_ROLE_SELECT_ID = 'setup_wvw_role';
const INPUT_GUILD_NAME = 'setup_guild_name';
const INPUT_API_KEY = 'setup_api_key';
const INPUT_DM_NOTIFY = 'setup_dm_notify';

const MAX_SELECT_OPTIONS = 25;

/** Armazena canal de notificação escolhido antes de abrir o modal: key = guildId:userId */
const pendingNotifyChannel = new Map<string, string>();
/** Armazena role base escolhida antes de abrir o modal: key = guildId:userId */
const pendingBaseRole = new Map<string, string>();
/** Armazena role WvW escolhida antes de abrir o modal: key = guildId:userId */
const pendingWvwRole = new Map<string, string>();

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configura o nome da guilda e a chave de API do Guild Wars 2 para este servidor.')
  .toJSON();

function buildSetupModal(title: string, guildName: string, apiKeyPlaceholder: string, dmNotifyPlayer: boolean = true) {
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle(title);

  const nameInput = new TextInputBuilder()
    .setCustomId(INPUT_GUILD_NAME)
    .setLabel('Nome da guilda')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nome exato da guilda no jogo')
    .setRequired(true)
    .setMaxLength(256);
  if (guildName) nameInput.setValue(guildName);

  const keyInput = new TextInputBuilder()
    .setCustomId(INPUT_API_KEY)
    .setLabel('Chave de API (Guild Wars 2)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(apiKeyPlaceholder ? 'Deixe em branco para não alterar' : 'Cole sua chave de API')
    .setRequired(!apiKeyPlaceholder)
    .setMaxLength(128);
  if (!apiKeyPlaceholder) keyInput.setMinLength(64);

  const dmNotifyInput = new TextInputBuilder()
    .setCustomId(INPUT_DM_NOTIFY)
    .setLabel('Notificar Jogador via DM')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('sim ou não')
    .setRequired(false)
    .setMaxLength(10);
  dmNotifyInput.setValue(dmNotifyPlayer ? 'sim' : 'não');

  const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
  const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput);
  const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(dmNotifyInput);
  modal.addComponents(row1, row2, row3);
  return modal;
}

/** Retorna opções de roles do servidor (exclui @everyone), no máximo MAX_SELECT_OPTIONS. */
function getGuildRoleOptions(
  discordGuild: { id: string; roles: { cache: Map<string, { id: string; name: string }> } },
  currentValue?: string
) {
  const roles = Array.from(discordGuild.roles.cache.values())
    .filter((r) => r.id !== discordGuild.id)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, MAX_SELECT_OPTIONS);
  return roles.map((r) => ({
    label: r.name ?? r.id,
    value: r.id,
    description: r.id === currentValue ? 'Selecionado atualmente' : undefined,
  }));
}

/** Monta a mensagem com os dois dropdowns de roles (base e WvW). */
function buildRoleSelectRows(
  discordGuild: { id: string; roles: { cache: Map<string, { id: string; name: string }> } },
  currentBaseRoleId?: string,
  currentWvwRoleId?: string
) {
  const baseOptions = getGuildRoleOptions(discordGuild, currentBaseRoleId);
  const wvwOptions = getGuildRoleOptions(discordGuild, currentWvwRoleId);
  const baseMenu = new StringSelectMenuBuilder()
    .setCustomId(SETUP_BASE_ROLE_SELECT_ID)
    .setPlaceholder('Role base do usuário no Discord')
    .addOptions([{ label: 'Nenhuma', value: '__none__', description: 'Não atribuir role base' }, ...baseOptions].slice(0, MAX_SELECT_OPTIONS));
  const wvwMenu = new StringSelectMenuBuilder()
    .setCustomId(SETUP_WVW_ROLE_SELECT_ID)
    .setPlaceholder('Role do jogador de WvW')
    .addOptions([{ label: 'Nenhuma', value: '__none__', description: 'Não atribuir role WvW' }, ...wvwOptions].slice(0, MAX_SELECT_OPTIONS));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(baseMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(wvwMenu),
  ];
}

export async function handleSetupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Servidor não disponível.', ephemeral: true });
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
        'Você precisa de uma destas permissões no servidor para usar este comando: **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**.',
      ephemeral: true,
    });
    return;
  }

  const textChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  const channels = guild.channels.cache.filter((c) => textChannelTypes.includes(c.type as ChannelType));
  const channelList = Array.from(channels.values()).slice(0, MAX_SELECT_OPTIONS);

  if (channelList.length === 0) {
    const existing = await Guild.findOne({ discord_server_id: discordServerId }).exec();
    const rows = buildRoleSelectRows(
      guild,
      existing?.base_discord_role || undefined,
      existing?.wvw_discord_role || undefined
    );
    await interaction.reply({
      content:
        '**Configurar guilda** — Selecione a **role base do usuário** e a **role do jogador de WvW**. Em seguida, preencha o formulário com o nome da guilda e a chave de API.',
      components: rows,
      ephemeral: true,
    });
    return;
  }

  const existing = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  const currentNotifyChannelId = existing?.notify_channel ?? '';

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(SETUP_CHANNEL_SELECT_ID)
    .setPlaceholder('Selecione o canal para notificações')
    .addOptions(
      channelList.map((ch) => ({
        label: ch.name ?? ch.id,
        value: ch.id,
        description: ch.id === currentNotifyChannelId ? 'Canal atual de notificações' : undefined,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  await interaction.reply({
    content:
      '**Configurar guilda** — Selecione o canal onde as notificações devem ser enviadas. Em seguida, escolha as roles e preencha o formulário com o nome da guilda e a chave de API.',
    components: [row],
    ephemeral: true,
  });
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
  const notifyChannelId = pendingNotifyChannel.get(pendingKey) ?? '';
  const baseDiscordRole = pendingBaseRole.get(pendingKey) ?? '';
  const wvwDiscordRole = pendingWvwRole.get(pendingKey) ?? '';

  await Guild.findOneAndUpdate(
    { discord_server_id: discordServerId },
    {
      $set: {
        guild_id: guildId,
        discord_server_id: discordServerId,
        name: guildName,
        api_key: apiKey,
        ...(notifyChannelId ? { notify_channel: notifyChannelId } : {}),
        base_discord_role: baseDiscordRole,
        wvw_discord_role: wvwDiscordRole,
        dm_notify_player: dmNotifyPlayer,
      },
    },
    { upsert: true, new: true }
  ).exec();

  pendingNotifyChannel.delete(pendingKey);
  pendingBaseRole.delete(pendingKey);
  pendingWvwRole.delete(pendingKey);

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
          discord_user: '',
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

export async function handleSetupChannelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== SETUP_CHANNEL_SELECT_ID) return;

  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true }).catch(() => {});
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
        'Você precisa de uma destas permissões no servidor: **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const channelId = interaction.values[0];
  if (!channelId) {
    await interaction.reply({ content: 'Nenhum canal selecionado.', ephemeral: true }).catch(() => {});
    return;
  }

  pendingNotifyChannel.set(`${discordServerId}:${interaction.user.id}`, channelId);

  const existing = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  const rows = buildRoleSelectRows(
    interaction.guild!,
    existing?.base_discord_role || undefined,
    existing?.wvw_discord_role || undefined
  );

  await interaction.update({
    content:
      '**Configurar guilda** — Selecione a **role base do usuário** e a **role do jogador de WvW**. Depois, preencha o formulário com o nome da guilda e a chave de API.',
    components: rows,
  });
}

function getPendingKey(interaction: StringSelectMenuInteraction): string {
  const discordServerId = interaction.guildId;
  return discordServerId ? `${discordServerId}:${interaction.user.id}` : '';
}

async function tryShowSetupModalAfterRoles(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const key = getPendingKey(interaction);
  if (!key || !interaction.guild) return false;
  const baseId = pendingBaseRole.get(key);
  const wvwId = pendingWvwRole.get(key);
  if (baseId === undefined || wvwId === undefined) return false;
  const existing = await Guild.findOne({ discord_server_id: interaction.guildId }).exec();
  const modal = buildSetupModal(
    existing ? 'Atualizar configuração da guilda' : 'Configurar guilda (Esgoto do WvW)',
    existing?.name ?? '',
    existing?.api_key ? '••••••••' : '',
    existing?.dm_notify_player ?? true
  );
  await interaction.showModal(modal);
  return true;
}

export async function handleSetupBaseRoleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== SETUP_BASE_ROLE_SELECT_ID) return;

  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true }).catch(() => {});
    return;
  }

  const permissions = interaction.memberPermissions;
  const allowed =
    permissions?.has(PermissionFlagsBits.ManageRoles) ||
    permissions?.has(PermissionFlagsBits.ManageChannels) ||
    permissions?.has(PermissionFlagsBits.ManageGuild) ||
    permissions?.has(PermissionFlagsBits.Administrator);
  if (!allowed) {
    await interaction
      .reply({
        content:
          'Você precisa de uma destas permissões no servidor: **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**.',
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  const value = interaction.values[0];
  pendingBaseRole.set(`${discordServerId}:${interaction.user.id}`, value === '__none__' ? '' : value);

  if (await tryShowSetupModalAfterRoles(interaction)) return;

  const existing = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  const rows = buildRoleSelectRows(
    interaction.guild!,
    value === '__none__' ? '' : value,
    existing?.wvw_discord_role || undefined
  );
  await interaction.update({
    content: '**Configurar guilda** — Role base selecionada. Selecione a **role do jogador de WvW** e depois preencha o formulário.',
    components: rows,
  });
}

export async function handleSetupWvwRoleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== SETUP_WVW_ROLE_SELECT_ID) return;

  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true }).catch(() => {});
    return;
  }

  const permissions = interaction.memberPermissions;
  const allowed =
    permissions?.has(PermissionFlagsBits.ManageRoles) ||
    permissions?.has(PermissionFlagsBits.ManageChannels) ||
    permissions?.has(PermissionFlagsBits.ManageGuild) ||
    permissions?.has(PermissionFlagsBits.Administrator);
  if (!allowed) {
    await interaction
      .reply({
        content:
          'Você precisa de uma destas permissões no servidor: **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**.',
        ephemeral: true,
      })
      .catch(() => {});
    return;
  }

  const value = interaction.values[0];
  pendingWvwRole.set(`${discordServerId}:${interaction.user.id}`, value === '__none__' ? '' : value);

  if (await tryShowSetupModalAfterRoles(interaction)) return;

  const existing = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  const rows = buildRoleSelectRows(
    interaction.guild!,
    existing?.base_discord_role || undefined,
    value === '__none__' ? '' : value
  );
  await interaction.update({
    content: '**Configurar guilda** — Role WvW selecionada. Selecione a **role base do usuário** e depois preencha o formulário.',
    components: rows,
  });
}
