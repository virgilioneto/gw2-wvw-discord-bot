import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Guild } from '../models/Guild';
import { GuildMember } from '../models/GuildMember';

const SETUP_PERMISSIONS =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.Administrator;

export const pendingPlayersCommand = new SlashCommandBuilder()
  .setName('jogadores-pendente')
  .setDescription('Mostra jogadores que não definiram a guilda como WvW no jogo.')
  .setDefaultMemberPermissions(SETUP_PERMISSIONS)
  .toJSON();

export async function handlePendingPlayersCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordServerId = interaction.guildId;
  if (!discordServerId) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ephemeral: true });
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

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc) {
    await interaction.reply({
      content: 'Este servidor ainda não possui uma guilda configurada. Use `/setup` primeiro.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildRoleIds = Array.isArray(guildDoc.roles) ? guildDoc.roles : [];
  const members = await GuildMember.find({
    guild_id: guildDoc.guild_id,
    status: 'CONFIRMED',
    wvw_member: false,
    roles: { $in: guildRoleIds },
  })
    .exec();

  const lines: string[] = [];
  for (const m of members) {
    let discordName: string;
    try {
      const user = await interaction.client.users.fetch(m.discord_user);
      discordName = user.globalName ?? user.username;
    } catch {
      discordName = m.discord_user;
    }
    lines.push(`- ${m.account_id} - ${discordName}`);
  }

  const header = `**Jogadores pendentes (sem WvW atribuído) — ${guildDoc.name}**\n
ID no Jogo - Nome no Discord\n`;
  const maxContentLength = 2000 - 50;
  let content = header + (lines.length ? lines.join('\n') : '_Nenhum jogador pendente._');

  if (content.length > 2000) {
    const firstChunkLines: string[] = [];
    let len = header.length;
    for (const line of lines) {
      if (len + line.length + 1 > maxContentLength) break;
      firstChunkLines.push(line);
      len += line.length + 1;
    }
    content = header + firstChunkLines.join('\n');
    await interaction.editReply({ content });
    const remaining = lines.slice(firstChunkLines.length);
    for (let i = 0; i < remaining.length; i += 40) {
      const chunk = remaining.slice(i, i + 40).join('\n');
      await interaction.followUp({ content: chunk, ephemeral: true });
    }
    return;
  }

  await interaction.editReply({ content });
}
