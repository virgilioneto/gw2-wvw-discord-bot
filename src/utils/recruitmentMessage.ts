import type { Guild } from 'discord.js';

const WHITE_CHECK_MARK = '✅';

/**
 * Reacts with :white_check_mark: on the recruitment channel message when a guild member
 * becomes CONFIRMED. Call this whenever status is updated to CONFIRMED and the member
 * has recruitment_message_id and recruitment_channel_id.
 */
export async function reactRecruitmentMessageConfirmed(
  guild: Guild | null,
  channelId: string,
  messageId: string
): Promise<void> {
  if (!guild) return;
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.react(WHITE_CHECK_MARK).catch(() => {});
    }
  } catch {
    // ignore
  }
}
