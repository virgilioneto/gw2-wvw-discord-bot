import type { GuildMemberStatus } from '../models/GuildMember';

/**
 * Mapa do status do banco para o texto exibido ao usuário em português.
 * O banco continua usando os valores em inglês; apenas a apresentação é traduzida.
 */
export const STATUS_LABELS_PT: Record<GuildMemberStatus, string> = {
  PENDING_GUILD_DATA: 'Aguardando dados da guilda',
  PENDING_DISCORD_DATA: 'Aguardando dados do Discord',
  CONFIRMED: 'Confirmado',
};

export function getStatusLabel(status: GuildMemberStatus): string {
  return STATUS_LABELS_PT[status] ?? status;
}
