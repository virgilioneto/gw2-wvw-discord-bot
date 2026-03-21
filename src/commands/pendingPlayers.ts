import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Guild } from '../models/Guild';
import { findPendingWvwMembers } from '../services/guildMemberService';
import { userSharesRoleWithBot } from '../utils/roleCheck';

export const pendingPlayersCommand = new SlashCommandBuilder()
  .setName('jogadores-pendente')
  .setDescription('[ADM] Mostra jogadores que não definiram a guilda como WvW no jogo.')
  .toJSON();

export async function handlePendingPlayersCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
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

  const guildDoc = await Guild.findOne({ where: { discord_server_id: discordServerId } });
  if (!guildDoc) {
    await interaction.reply({
      content: 'Este servidor ainda não possui uma guilda configurada. Use `/setup` primeiro.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildRoleIds = Array.isArray(guildDoc.notification_roles) ? guildDoc.notification_roles : [];
  const members = await findPendingWvwMembers(guildDoc.guild_id, guildRoleIds);

  const lines: string[] = [];
  for (const m of members) {
    if (!m.discord_user) continue;
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
