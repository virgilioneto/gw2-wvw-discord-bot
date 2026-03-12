import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Guild } from '../models/Guild';
import { GuildMember, type GuildMemberStatus } from '../models/GuildMember';
import { getStatusLabel } from '../constants/statusLabels';
import { GAME_ID_REGEX } from '../events/messageCreate';

export const manualIncludeCommand = new SlashCommandBuilder()
  .setName('inclusão-manual')
  .setDescription('Vincula manualmente usuários do Discord a IDs de jogo (ex.: usuario=Nome.1234, outro=Outro.4321).')
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
    });
    return;
  }

  const discordServerId = interaction.guildId;
  if (!discordServerId || !interaction.guild) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
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

  const guildRoleIds = Array.isArray(guildDoc.roles) ? guildDoc.roles : [];
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

    const existingDiscordUser = await GuildMember.findOne({
      guild_id: guildDoc.guild_id,
      discord_user: memberInfo.id,
    }).exec();
    if (existingDiscordUser && existingDiscordUser.account_id !== gameId) {
      errors.push(`**${username}** (${memberInfo.displayName}): já vinculado a outro ID (${existingDiscordUser.account_id}).`);
      continue;
    }

    const existingMember = await GuildMember.findOne({ guild_id: guildDoc.guild_id, account_id: gameId }).exec();
    if (existingMember?.discord_user && existingMember.discord_user !== memberInfo.id) {
      errors.push(`**${gameId}**: já está vinculado a outro usuário no Discord.`);
      continue;
    }
    if (existingMember?.status === 'CONFIRMED') {
      errors.push(`**${gameId}**: já está confirmado.`);
      continue;
    }

    let status: GuildMemberStatus = 'PENDING_GUILD_DATA';
    if (existingMember) {
      status = existingMember.status === 'PENDING_DISCORD_DATA' ? 'CONFIRMED' : existingMember.status;
    }
    await GuildMember.findOneAndUpdate(
      { guild_id: guildDoc.guild_id, account_id: gameId },
      {
        $set: {
          discord_user: memberInfo.id,
          status,
          roles: memberRoles,
        },
      },
      { upsert: true, new: true }
    ).exec();

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
