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
import { searchGuildByName } from '../services/gw2Api';
import { getGuildMembers } from '../services/gw2GuildMembers';

const MODAL_ID = 'setup_modal';
const INPUT_GUILD_NAME = 'setup_guild_name';
const INPUT_API_KEY = 'setup_api_key';

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configura o nome da guilda e a chave de API do Guild Wars 2 para este servidor.')
  .toJSON();

function buildSetupModal(title: string, guildName: string, apiKeyPlaceholder: string) {
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

  const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
  const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput);
  modal.addComponents(row1, row2);
  return modal;
}

export async function handleSetupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
    return;
  }

  const existing = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  const guildName = existing?.name ?? '';
  const apiKeyPlaceholder = existing?.api_key ? '••••••••' : '';

  const modal = buildSetupModal(
    existing ? 'Atualizar configuração da guilda' : 'Configurar guilda (Esgoto do WvW)',
    guildName,
    apiKeyPlaceholder
  );
  await interaction.showModal(modal);
}

export async function handleSetupModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId !== MODAL_ID) return;

  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Servidor não encontrado.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildName = interaction.fields.getTextInputValue(INPUT_GUILD_NAME).trim();
  let apiKey = interaction.fields.getTextInputValue(INPUT_API_KEY).trim();

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

  await Guild.findOneAndUpdate(
    { discord_server_id: discordServerId },
    {
      $set: {
        guild_id: guildId,
        discord_server_id: discordServerId,
        name: guildName,
        api_key: apiKey,
      },
    },
    { upsert: true, new: true }
  ).exec();

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

  await interaction.editReply({
    content: `Guilda **${guildName}** configurada com sucesso. ${membersResult.members.length} membro(s) sincronizado(s).`,
  });
}
