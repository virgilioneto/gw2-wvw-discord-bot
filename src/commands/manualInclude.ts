import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Guild } from '../models/Guild';
import { getStatusLabel } from '../constants/statusLabels';
import { GAME_ID_REGEX } from '../constants/gameId';
import { reactRecruitmentMessageConfirmed } from '../utils/recruitmentMessage';
import { userSharesRoleWithBot } from '../utils/roleCheck';
import {
  linkDiscordToGameId,
  findByGuildAndAccount,
  findByGuildAndDiscordUser,
} from '../services/guildMemberService';

export const manualIncludeCommand = new SlashCommandBuilder()
  .setName('inclusão-manual')
  .setDescription('[ADM] Vincula usuários Discord a IDs de jogo: usuario=Nome.1234, ...')
  .addStringOption((opt) =>
    opt
      .setName('lista')
      .setDescription('Lista no formato: usuario1=GameId.1234, usuario2=GameId.4321')
      .setRequired(true)
  )
  .toJSON();

function parseList(listRaw: string): { username: string; gameId: string }[] {
  const pairs: { username: string; gameId: string }[] = [];
  const parts = listRaw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const username = part.slice(0, idx).trim();
    const gameId = part.slice(idx + 1).trim();
    if (username && gameId && GAME_ID_REGEX.test(gameId)) {
      pairs.push({ username, gameId });
    }
  }
  return pairs;
}

function findMemberByUsername(
  guild: { members: { cache: Map<string, { id: string, displayName: string; user: { username: string } }> } },
  username: string
): { id: string; displayName: string; username: string } | null {
  const lower = username.toLowerCase();
  for (const [, member] of guild.members.cache) {
    if (member.displayName.toLowerCase() === lower || member.user.username.toLowerCase() === lower) {
      return { id: member.id, displayName: member.displayName, username: member.user.username };
    }
  }
  return null;
}

export async function handleManualIncludeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
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

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc) {
    await interaction.reply({
      content: 'Este servidor ainda não possui uma guilda configurada. Use `/configurar` primeiro.',
      ephemeral: true,
    });
    return;
  }

  const listRaw = interaction.options.getString('lista', true).trim();
  const pairs = parseList(listRaw);
  if (pairs.length === 0) {
    await interaction.reply({
      content: 'Nenhum par válido encontrado. Use o formato: **usuario=Nome.1234**, separando por vírgula. O ID deve ser no formato Nome.1234.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await interaction.guild.members.fetch();
  } catch {
    // cache might be partial
  }

  const guildRoleIds = Array.isArray(guildDoc.notification_roles) ? guildDoc.notification_roles : [];
  const results: string[] = [];
  const errors: string[] = [];

  for (const { username, gameId } of pairs) {
    const memberInfo = findMemberByUsername(interaction.guild, username);
    if (!memberInfo) {
      errors.push(`**${username}**: usuário não encontrado no servidor.`);
      continue;
    }

    const member = interaction.guild.members.cache.get(memberInfo.id);
    const memberRoles = member ? guildRoleIds.filter((roleId) => member.roles.cache.has(roleId)) : [];

    const existingDiscordUser = await findByGuildAndDiscordUser(guildDoc.guild_id, memberInfo.id);
    if (existingDiscordUser && existingDiscordUser.account_id !== gameId) {
      errors.push(`**${username}** (${memberInfo.displayName}): já vinculado a outro ID (${existingDiscordUser.account_id}).`);
      continue;
    }

    const existingMember = await findByGuildAndAccount(guildDoc.guild_id, gameId);
    if (existingMember?.status === 'CONFIRMED') {
      errors.push(`**${gameId}**: já está confirmado.`);
      continue;
    }

    const { updated, status } = await linkDiscordToGameId({
      guildId: guildDoc.guild_id,
      accountId: gameId,
      discordUserId: memberInfo.id,
      roles: memberRoles,
    });

    if (status === 'CONFIRMED' && updated.recruitment_message_id && updated.recruitment_channel_id) {
      await reactRecruitmentMessageConfirmed(interaction.guild, updated.recruitment_channel_id, updated.recruitment_message_id);
    }

    results.push(`**${username}** → ${gameId}: ${getStatusLabel(status)}`);
  }

  const successText = results.length ? `\n\nIncluídos:\n${results.join('\n')}` : '';
  const errorText = errors.length ? `\n\nErros:\n${errors.join('\n')}` : '';
  const summary =
    results.length === 0 && errors.length === 0
      ? 'Nenhum par válido processado. Use o formato: usuario=Nome.1234'
      : `${results.length} vinculado(s).${successText}${errorText}`;

  await interaction.editReply({ content: summary });
}
