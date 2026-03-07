import { GuildMember, PartialGuildMember } from 'discord.js';
import { Guild } from '../models/Guild';
import { pendingGameIdByUser } from '../utils/pendingDm';

export async function handleGuildMemberAdd(member: GuildMember | PartialGuildMember): Promise<void> {
  const discordServerId = member.guild?.id;
  if (!discordServerId) return;

  const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
  if (!guildDoc) return;

  try {
    const dm = await member.createDM();
    await dm.send(
      "**Esgoto do WvW** — Olá! Este servidor está vinculado a uma guilda do Guild Wars 2. Por favor, informe seu **ID de jogo** (ex.: SeuNome.1234) por aqui para que possamos te reconhecer."
    );
    pendingGameIdByUser.set(member.id, discordServerId);
  } catch {
    // User may have DMs disabled - ignore
  }
}
